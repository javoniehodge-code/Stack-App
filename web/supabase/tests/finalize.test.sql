-- Regression tests for 20261130000000_finalize.sql. Run only on a disposable test database that has it applied
-- (never on live). Everything runs in one transaction and is rolled back.
--   psql "host=/tmp port=55433 dbname=<test db> user=postgres" -v ON_ERROR_STOP=1 -f web/supabase/tests/finalize.test.sql

begin;

insert into auth.users (id, email) values ('f3f3f3f3-0000-4000-8000-0000000000a1', 'finalize.a@stack.test');
insert into public.profiles (id, handle, name) values ('f3f3f3f3-0000-4000-8000-0000000000a1', 'finalizea', 'Finalize A');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'f3f3f3f3-0000-4000-8000-0000000000a1', true);

create function pg_temp.draft(n int) returns uuid language sql as $$
  insert into public.drafts (id, content) values (('f3f3f3f3-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid, '{}') returning id $$;
create function pg_temp.picks() returns jsonb language sql as $$ select '[{"label":"","lines":[{"text":"A pick","format":"num"}]}]'::jsonb $$;
-- Whether publishing draft n with these choices is refused with a message containing `msg`.
create function pg_temp.refused(n int, emoji text, color text, place boolean, cats text[], msg text) returns boolean language plpgsql as $$
declare d uuid := pg_temp.draft(n);
begin
  perform public.publish_draft(d, 'T', pg_temp.picks(), null, 'numbered', '', 'public', 'CDMX', emoji, color, place, cats);
  return false;
exception when invalid_parameter_value then
  return sqlerrm like '%' || msg || '%';
end $$;

-- 1. All four choices are kept on the published Stack.
do $$
declare r public.stacks;
begin
  perform public.publish_draft(pg_temp.draft(1), 'Late-night tacos', pg_temp.picks(), null, 'numbered', '', 'public', 'CDMX',
    '🌮', 'oklch(84% 0.12 40)', true, array['Food & Drink', 'Travel & Places']);
  select * into r from public.stacks where id = 'f3f3f3f3-0000-4000-8000-000000000001';
  if r.theme_emoji <> '🌮' or r.theme_color <> 'oklch(84% 0.12 40)' or not r.is_place or r.location <> 'CDMX'
     or r.categories <> array['Food & Drink', 'Travel & Places'] then
    raise exception 'FAIL 1: the choices came back as % % % % %', r.theme_emoji, r.theme_color, r.is_place, r.location, r.categories;
  end if;
end $$;

-- 2. Not about a place: the city isn't kept.
do $$ begin
  perform public.publish_draft(pg_temp.draft(2), 'Books', pg_temp.picks(), null, 'numbered', '', 'public', 'Somewhere',
    '📖', 'oklch(84% 0.09 260)', false, array['Learning']);
  if (select location || '|' || is_place from public.stacks where id = 'f3f3f3f3-0000-4000-8000-000000000002') <> '|false' then
    raise exception 'FAIL 2: a Stack that isn''t about a place kept its city';
  end if;
end $$;

-- 3. Only the listed emoji, colours and categories; at most 2 different categories.
do $$ begin
  if not pg_temp.refused(3, '🦄', null, false, null, 'theme emoji')
     or not pg_temp.refused(4, null, 'red', false, null, 'theme colours')
     or not pg_temp.refused(5, null, null, false, array['Pets'], 'from the list')
     or not pg_temp.refused(6, null, null, false, array['Learning', 'Technology', 'Food & Drink'], 'up to 2')
     or not pg_temp.refused(7, null, null, false, array['Learning', 'Learning'], 'up to 2') then
    raise exception 'FAIL 3: an invalid choice was accepted';
  end if;
  if not exists (select 1 from public.drafts where id = 'f3f3f3f3-0000-4000-8000-000000000003') then
    raise exception 'FAIL 3: a refused publish removed the draft';
  end if;
end $$;

-- 4. An older app version's call, without the choices, still publishes (no theme, not a place, no categories).
do $$ begin
  perform public.publish_draft(p_id => pg_temp.draft(8), p_title => 'Old app', p_sections => pg_temp.picks(), p_tags => null,
    p_style => 'numbered', p_description => '', p_visibility => 'public', p_location => '');
  if (select coalesce(theme_emoji, '-') || '|' || is_place || '|' || cardinality(categories) from public.stacks where id = 'f3f3f3f3-0000-4000-8000-000000000008') <> '-|false|0' then
    raise exception 'FAIL 4: a publish without the choices didn''t work as before';
  end if;
end $$;
reset role;

-- 5. The table itself refuses invalid values, whatever writes them.
do $$ begin
  begin
    update public.stacks set categories = array['Pets'] where id = 'f3f3f3f3-0000-4000-8000-000000000001';
    raise exception 'FAIL 5: an unlisted category was stored';
  exception when check_violation then null;
  end;
  begin
    update public.stacks set theme_color = 'blue' where id = 'f3f3f3f3-0000-4000-8000-000000000001';
    raise exception 'FAIL 5: an unlisted colour was stored';
  exception when check_violation then null;
  end;
end $$;

select 'all finalize checks passed' as result;
rollback;
