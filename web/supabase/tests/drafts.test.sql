-- Regression tests for 20261128000000_drafts.sql. Run only on a disposable test database that has it applied
-- (never on live). Everything runs in one transaction and is rolled back.
--   psql "host=/tmp port=55433 dbname=<test db> user=postgres" -v ON_ERROR_STOP=1 -f web/supabase/tests/drafts.test.sql

begin;

-- Two people, A and B, and A's published stack S.
insert into auth.users (id, email) values
  ('d1d1d1d1-0000-4000-8000-0000000000a1', 'drafts.a@stack.test'),
  ('d1d1d1d1-0000-4000-8000-0000000000b1', 'drafts.b@stack.test');
insert into public.profiles (id, handle, name) values
  ('d1d1d1d1-0000-4000-8000-0000000000a1', 'draftsa', 'Drafts A'),
  ('d1d1d1d1-0000-4000-8000-0000000000b1', 'draftsb', 'Drafts B');
insert into public.stacks (id, author_id, title, sections, status) values
  ('d1d1d1d1-0000-4000-8000-0000000000c1', 'd1d1d1d1-0000-4000-8000-0000000000a1', 'Published S',
   '[{"label":"","lines":[{"text":"One","link":null,"format":"num"}]}]', 'published'),
  ('d1d1d1d1-0000-4000-8000-0000000000c2', 'd1d1d1d1-0000-4000-8000-0000000000b1', 'B''s stack',
   '[{"label":"","lines":[{"text":"One","link":null,"format":"num"}]}]', 'published');

-- As A.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1d1d1d1-0000-4000-8000-0000000000a1', true);

-- 1. A save is an upsert on the app's own id: saving the same id twice keeps one draft with the latest content.
insert into public.drafts (id, content, step) values ('d1d1d1d1-0000-4000-8000-0000000000d1', '{"title":"First"}', 'title')
  on conflict (id) do update set content = excluded.content, step = excluded.step;
insert into public.drafts (id, content, step) values ('d1d1d1d1-0000-4000-8000-0000000000d1', '{"title":"Second"}', 'build')
  on conflict (id) do update set content = excluded.content, step = excluded.step;
do $$ begin
  if (select count(*) from public.drafts where id = 'd1d1d1d1-0000-4000-8000-0000000000d1') <> 1
     or (select content->>'title' || '|' || step from public.drafts where id = 'd1d1d1d1-0000-4000-8000-0000000000d1') <> 'Second|build'
     or (select owner_id from public.drafts where id = 'd1d1d1d1-0000-4000-8000-0000000000d1') <> 'd1d1d1d1-0000-4000-8000-0000000000a1' then
    raise exception 'FAIL 1: a repeated save made a second draft or lost the latest content';
  end if;
end $$;

-- 2. A draft can be incomplete or over a limit (checked only at publish).
insert into public.drafts (id, content) values ('d1d1d1d1-0000-4000-8000-0000000000d2',
  jsonb_build_object('title', repeat('x', 500), 'sections', jsonb_build_array(jsonb_build_object('label', repeat('y', 300), 'lines', '[]'::jsonb))));
-- ...but not huge.
do $$ begin
  begin
    insert into public.drafts (id, content) values ('d1d1d1d1-0000-4000-8000-0000000000d3', jsonb_build_object('title', repeat(md5(random()::text), 20000)));
    raise exception 'FAIL 2: a draft over the size cap was accepted';
  exception when check_violation then null;
  end;
end $$;

-- 3. Edits drafts: one per published stack, only for your own published stacks; the owner and target stay fixed.
insert into public.drafts (id, content, edit_of) values ('d1d1d1d1-0000-4000-8000-0000000000e1', '{"title":"Edit S"}', 'd1d1d1d1-0000-4000-8000-0000000000c1');
do $$ begin
  begin
    insert into public.drafts (id, content, edit_of) values ('d1d1d1d1-0000-4000-8000-0000000000e2', '{}', 'd1d1d1d1-0000-4000-8000-0000000000c1');
    raise exception 'FAIL 3: a second edits draft for the same stack was accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.drafts (id, content, edit_of) values ('d1d1d1d1-0000-4000-8000-0000000000e3', '{}', 'd1d1d1d1-0000-4000-8000-0000000000c2');
    raise exception 'FAIL 3: an edits draft for someone else''s stack was accepted';
  exception when no_data_found then null;
  end;
  update public.drafts set edit_of = null, created_at = now() - interval '9 days' where id = 'd1d1d1d1-0000-4000-8000-0000000000e1';
  if (select edit_of from public.drafts where id = 'd1d1d1d1-0000-4000-8000-0000000000e1') is distinct from 'd1d1d1d1-0000-4000-8000-0000000000c1'
     or (select created_at < now() - interval '1 day' from public.drafts where id = 'd1d1d1d1-0000-4000-8000-0000000000e1') then
    raise exception 'FAIL 3: an update changed what a draft edits or when it was made';
  end if;
end $$;

-- 4. publish_draft publishes under the draft's id and removes the draft; a repeat returns the same stack.
do $$
declare r1 uuid; r2 uuid;
begin
  r1 := public.publish_draft('d1d1d1d1-0000-4000-8000-0000000000d1', '  Second  ', '[{"label":"","lines":[{"text":"A pick","link":null,"format":"num"}]}]', array['Food'], 'numbered', 'About it', 'unlisted', '');
  r2 := public.publish_draft('d1d1d1d1-0000-4000-8000-0000000000d1', 'Second', '[{"label":"","lines":[{"text":"A pick","link":null,"format":"num"}]}]', array['Food'], 'numbered', 'About it', 'unlisted', '');
  if r1 <> 'd1d1d1d1-0000-4000-8000-0000000000d1' or r2 <> r1 then
    raise exception 'FAIL 4: publish_draft did not return the draft''s id both times';
  end if;
  if (select count(*) from public.stacks where id = r1 and status = 'published' and title = 'Second' and visibility = 'unlisted') <> 1
     or (select count(*) from public.stacks where author_id = 'd1d1d1d1-0000-4000-8000-0000000000a1' and status = 'published') <> 2
     or exists (select 1 from public.drafts where id = r1)
     or (select count(*) from public.stack_tags where stack_id = r1) <> 1 then
    raise exception 'FAIL 4: publishing made the wrong stacks, kept the draft, or lost its tags';
  end if;
end $$;

-- 5. Publishing checks the stack's rules: an over-limit or untitled draft isn't published and is kept.
do $$ begin
  begin
    perform public.publish_draft('d1d1d1d1-0000-4000-8000-0000000000d2', repeat('x', 500), '[{"label":"","lines":[{"text":"A pick","link":null,"format":"num"}]}]', null);
    raise exception 'FAIL 5: an over-limit title was published';
  exception when others then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.publish_draft('d1d1d1d1-0000-4000-8000-0000000000d2', '   ', '[{"label":"","lines":[{"text":"A pick","link":null,"format":"num"}]}]', null);
    raise exception 'FAIL 5: an untitled draft was published';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.publish_draft('d1d1d1d1-0000-4000-8000-0000000000e1', 'Edit S', '[{"label":"","lines":[{"text":"A pick","link":null,"format":"num"}]}]', null);
    raise exception 'FAIL 5: an edits draft was published as a new stack';
  exception when invalid_parameter_value then null;
  end;
  if not exists (select 1 from public.drafts where id = 'd1d1d1d1-0000-4000-8000-0000000000d2')
     or exists (select 1 from public.stacks where id = 'd1d1d1d1-0000-4000-8000-0000000000d2') then
    raise exception 'FAIL 5: a refused publish removed the draft or made a stack';
  end if;
end $$;

-- 6. apply_stack_edit removes the stack's edits draft.
do $$ begin
  perform public.apply_stack_edit('d1d1d1d1-0000-4000-8000-0000000000c1', 'Published S, edited', '', '[{"label":"","lines":[{"text":"One","link":null,"format":"num"}]}]');
  if exists (select 1 from public.drafts where edit_of = 'd1d1d1d1-0000-4000-8000-0000000000c1') then
    raise exception 'FAIL 6: applying an edit left its edits draft behind';
  end if;
end $$;

-- 7. Someone else's drafts can't be read, changed, removed, overwritten or published.
select set_config('request.jwt.claim.sub', 'd1d1d1d1-0000-4000-8000-0000000000b1', true);
do $$
declare n int;
begin
  if exists (select 1 from public.drafts where id = 'd1d1d1d1-0000-4000-8000-0000000000d2') then
    raise exception 'FAIL 7: B can read A''s draft';
  end if;
  update public.drafts set content = '{"title":"hijack"}' where id = 'd1d1d1d1-0000-4000-8000-0000000000d2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 7: B changed A''s draft'; end if;
  delete from public.drafts where id = 'd1d1d1d1-0000-4000-8000-0000000000d2';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL 7: B removed A''s draft'; end if;
  begin
    insert into public.drafts (id, content) values ('d1d1d1d1-0000-4000-8000-0000000000d2', '{"title":"hijack"}')
      on conflict (id) do update set content = excluded.content;
    raise exception 'FAIL 7: B overwrote A''s draft through an upsert';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.drafts (id, owner_id, content) values ('d1d1d1d1-0000-4000-8000-0000000000d4', 'd1d1d1d1-0000-4000-8000-0000000000a1', '{}');
    raise exception 'FAIL 7: B made a draft owned by A';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.publish_draft('d1d1d1d1-0000-4000-8000-0000000000d2', 'Mine now', '[{"label":"","lines":[{"text":"A pick","link":null,"format":"num"}]}]', null);
    raise exception 'FAIL 7: B published A''s draft';
  exception when no_data_found then null;
  end;
end $$;
reset role;

-- 8. Signed out: no access at all.
set local role anon;
do $$ begin
  begin
    perform 1 from public.drafts limit 1;
    raise exception 'FAIL 8: signed-out visitors can read drafts';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.publish_draft('d1d1d1d1-0000-4000-8000-0000000000d2', 'x', '[]', null);
    raise exception 'FAIL 8: signed-out visitors can call publish_draft';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- 9. At most 200 drafts per person; saving one of them again still works at the cap.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'd1d1d1d1-0000-4000-8000-0000000000b1', true);
insert into public.drafts (id, content) select gen_random_uuid(), '{}' from generate_series(1, 200);
do $$
declare some_id uuid;
begin
  select id into some_id from public.drafts limit 1;
  insert into public.drafts (id, content) values (some_id, '{"title":"again"}') on conflict (id) do update set content = excluded.content;
  begin
    insert into public.drafts (id, content) values (gen_random_uuid(), '{}');
    raise exception 'FAIL 9: a 201st draft was accepted';
  exception when program_limit_exceeded then null;
  end;
end $$;
reset role;

select 'all drafts checks passed' as result;
rollback;
