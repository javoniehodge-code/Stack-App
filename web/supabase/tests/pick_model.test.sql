-- Regression tests for 20261129000000_pick_model.sql. Run only on a disposable test database that has it applied
-- (never on live). Everything runs in one transaction and is rolled back.
--   psql "host=/tmp port=55433 dbname=<test db> user=postgres" -v ON_ERROR_STOP=1 -f web/supabase/tests/pick_model.test.sql

begin;

-- What a stack's sections become when saved.
create function pg_temp.norm(p jsonb) returns jsonb language sql as $$ select n.sections from public.normalize_sections(p) n $$;
-- Whether saving these sections is refused with a message containing `msg`.
create function pg_temp.refused(p jsonb, msg text) returns boolean language plpgsql as $$
begin
  perform public.normalize_sections(p);
  return false;
exception when invalid_parameter_value then
  return sqlerrm like '%' || msg || '%';
end $$;
-- One section holding these picks.
create function pg_temp.one(lines jsonb) returns jsonb language sql as $$ select jsonb_build_array(jsonb_build_object('label', '', 'lines', lines)) $$;
-- n picks with headings.
create function pg_temp.picks(n int) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('text', 'Pick ' || i, 'format', 'num')), '[]'::jsonb) from generate_series(1, n) i $$;

-- 1. A full pick keeps its id, heading, subheading, link, link name, format and tags; line breaks become spaces.
do $$
declare got jsonb;
begin
  got := pg_temp.norm(pg_temp.one(jsonb_build_array(jsonb_build_object(
    'id', 'AAAAAAAA-0000-4000-8000-000000000001', 'text', E'Café\nRegina', 'note', E'Iced coffee\r\nand a patio.',
    'link', 'https://example.com/regina', 'linkName', 'Menu', 'format', 'bullet', 'tags', jsonb_build_array('Coffee', E'Outdoor\nseating', '$')))));
  if got -> 0 -> 'lines' -> 0 <> '{"id":"aaaaaaaa-0000-4000-8000-000000000001","text":"Café Regina","note":"Iced coffee and a patio.","link":"https://example.com/regina","linkName":"Menu","links":[{"url":"https://example.com/regina","name":"Menu"}],"format":"bullet","tags":["Coffee","Outdoor seating","$"]}'::jsonb then
    raise exception 'FAIL 1: a full pick came back as %', got -> 0 -> 'lines' -> 0;
  end if;
end $$;

-- 2. Every pick gets a stable id: a good one is kept; a missing, malformed or repeated one is replaced.
do $$
declare got jsonb; ids text[];
begin
  got := pg_temp.norm(pg_temp.one(jsonb_build_array(
    jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000001', 'text', 'Kept'),
    jsonb_build_object('text', 'No id'),
    jsonb_build_object('id', 'k12', 'text', 'Malformed'),
    jsonb_build_object('id', 'aaaaaaaa-0000-4000-8000-000000000001', 'text', 'Repeated'))));
  select array_agg(l ->> 'id') into ids from jsonb_array_elements(got -> 0 -> 'lines') l;
  if ids[1] <> 'aaaaaaaa-0000-4000-8000-000000000001' or cardinality(array(select distinct unnest(ids))) <> 4
     or exists (select 1 from unnest(ids) i where i !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    raise exception 'FAIL 2: pick ids came back as %', ids;
  end if;
end $$;

-- 3. Pick limits: heading 80, subheading 100, 3 tags of up to 20 characters, one price.
do $t$ begin
  if pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', repeat('h', 80), 'note', repeat('s', 100),
       'tags', jsonb_build_array(repeat('t', 20), 'Free', 'Brunch')))), '')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', repeat('h', 81)))), 'headings are limited to 80')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', 'x', 'note', repeat('s', 101)))), 'subheadings are limited to 100')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', 'x', 'tags', jsonb_build_array('a', 'b', 'c', 'd')))), 'at most 3 tags')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', 'x', 'tags', jsonb_build_array(repeat('t', 21))))), 'tags are limited to 20')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', 'x', 'tags', jsonb_build_array('$', '$$')))), 'one price tag') then
    raise exception 'FAIL 3: a pick limit was not applied as expected';
  end if;
  -- Blank and repeated tags (in any case) are dropped, so they don't count.
  if pg_temp.norm(pg_temp.one(jsonb_build_array(jsonb_build_object('text', 'x', 'tags', jsonb_build_array('Brunch', ' ', 'brunch', 'BRUNCH', 'Free', 'Solo-friendly'))))) -> 0 -> 'lines' -> 0 -> 'tags'
     <> '["Brunch","Free","Solo-friendly"]'::jsonb then
    raise exception 'FAIL 3: blank or repeated tags were kept';
  end if;
end $t$;

-- 4. An empty pick is dropped; a pick with anything in it needs a heading; paragraphs and bold lines are refused.
do $$ begin
  if jsonb_array_length(pg_temp.norm(pg_temp.one(jsonb_build_array(jsonb_build_object('text', '  ', 'tags', '[]'::jsonb), jsonb_build_object('text', 'Real'))) ) -> 0 -> 'lines') <> 1
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', '', 'note', 'Only a subheading'))), 'needs a heading')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', '', 'link', 'https://example.com'))), 'needs a heading')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', '', 'tags', '["Free"]'::jsonb))), 'needs a heading')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', 'A paragraph', 'format', 'text'))), 'paragraphs and bold lines')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', 'Bold', 'format', 'bold'))), 'paragraphs and bold lines') then
    raise exception 'FAIL 4: empty, heading-less or paragraph picks were not handled';
  end if;
end $$;

-- 4b. Up to 2 links per pick, each with an optional name; the first is also kept as `link` and `linkName`.
do $$
declare got jsonb;
begin
  got := pg_temp.norm(pg_temp.one(jsonb_build_array(jsonb_build_object('text', 'Two links', 'links', jsonb_build_array(
    jsonb_build_object('url', 'https://fuunji.jp', 'name', 'Menu'), jsonb_build_object('url', 'https://tsuta.jp'), jsonb_build_object('url', 'https://fuunji.jp')))))) -> 0 -> 'lines' -> 0;
  if got -> 'links' <> '[{"url":"https://fuunji.jp","name":"Menu"},{"url":"https://tsuta.jp"}]'::jsonb or got ->> 'link' <> 'https://fuunji.jp' or got ->> 'linkName' <> 'Menu' then
    raise exception 'FAIL 4b: two links (one repeated) came back as %', got;
  end if;
  if not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', 'x', 'links', jsonb_build_array(
       jsonb_build_object('url', 'https://a.com'), jsonb_build_object('url', 'https://b.com'), jsonb_build_object('url', 'https://c.com'))))), 'at most 2 links')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', 'x', 'links', jsonb_build_array(jsonb_build_object('url', 'javascript:alert(1)'))))), 'http(s) URLs')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', 'x', 'links', jsonb_build_array(jsonb_build_object('url', 'https://a.com', 'name', repeat('n', 41)))))), 'link names are limited to 40')
     or not pg_temp.refused(pg_temp.one(jsonb_build_array(jsonb_build_object('text', '', 'links', jsonb_build_array(jsonb_build_object('url', 'https://a.com'))))), 'needs a heading') then
    raise exception 'FAIL 4b: a link rule was not applied';
  end if;
  -- An older line's single link becomes its one link.
  if pg_temp.norm(pg_temp.one('[{"text":"Old","link":"https://old.com","linkName":"Old site"}]'::jsonb)) -> 0 -> 'lines' -> 0 -> 'links' <> '[{"url":"https://old.com","name":"Old site"}]'::jsonb then
    raise exception 'FAIL 4b: an older single link was not kept';
  end if;
end $$;

-- 5. Stack limits: 15 picks, 5 titled sections with titles up to 40 characters (picks outside any section are fine).
do $$
declare five jsonb;
begin
  select jsonb_agg(jsonb_build_object('label', repeat('S', 39) || i, 'lines', pg_temp.picks(1))) into five from generate_series(1, 5) i;
  if pg_temp.refused(pg_temp.one(pg_temp.picks(15)), '')
     or not pg_temp.refused(pg_temp.one(pg_temp.picks(16)), 'at most 15 items')
     or pg_temp.refused(pg_temp.one(pg_temp.picks(1)) || five, '')
     or not pg_temp.refused(five || jsonb_build_array(jsonb_build_object('label', 'Sixth', 'lines', pg_temp.picks(1))), 'at most 5 sections')
     or not pg_temp.refused(jsonb_build_array(jsonb_build_object('label', repeat('S', 41), 'lines', pg_temp.picks(1))), 'section titles are limited to 40') then
    raise exception 'FAIL 5: a stack limit was not applied as expected';
  end if;
end $$;

-- Someone with a published stack, for the checks that write stacks.
insert into auth.users (id, email) values ('e2e2e2e2-0000-4000-8000-0000000000a1', 'picks.a@stack.test');
insert into public.profiles (id, handle, name) values ('e2e2e2e2-0000-4000-8000-0000000000a1', 'picksa', 'Picks A');
insert into public.stacks (id, author_id, title, sections, status) values
  ('e2e2e2e2-0000-4000-8000-0000000000c1', 'e2e2e2e2-0000-4000-8000-0000000000a1', 'Published', pg_temp.one(pg_temp.picks(2)), 'published');

-- 6. Descriptions: up to 160 characters; titles and descriptions lose line breaks.
do $$ begin
  update public.stacks set title = E'Late-night\ntacos', description = repeat('d', 160) where id = 'e2e2e2e2-0000-4000-8000-0000000000c1';
  if (select title from public.stacks where id = 'e2e2e2e2-0000-4000-8000-0000000000c1') <> 'Late-night tacos' then
    raise exception 'FAIL 6: a line break stayed in the title';
  end if;
  begin
    update public.stacks set description = repeat('d', 161) where id = 'e2e2e2e2-0000-4000-8000-0000000000c1';
    raise exception 'FAIL 6: a 161-character description was accepted';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- 7. A stack published under the old limits keeps its content, and changes that don't touch it still work.
alter table public.stacks disable trigger stacks_before_write;
update public.stacks set sections = pg_temp.one(pg_temp.picks(30) || '[{"text":"An old paragraph","format":"text"}]'::jsonb), description = repeat('d', 300)
 where id = 'e2e2e2e2-0000-4000-8000-0000000000c1';
alter table public.stacks enable trigger stacks_before_write;
do $$ begin
  update public.stacks set visibility = 'unlisted' where id = 'e2e2e2e2-0000-4000-8000-0000000000c1';
  update public.stacks set likes_count = likes_count + 1 where id = 'e2e2e2e2-0000-4000-8000-0000000000c1';
  if (select jsonb_array_length(sections -> 0 -> 'lines') || '|' || visibility from public.stacks where id = 'e2e2e2e2-0000-4000-8000-0000000000c1') <> '31|unlisted' then
    raise exception 'FAIL 7: an older stack lost content, or a change to it was refused';
  end if;
end $$;
update public.stacks set visibility = 'public', sections = pg_temp.one(pg_temp.picks(2)), description = '' where id = 'e2e2e2e2-0000-4000-8000-0000000000c1';

-- 8. publish_draft and apply_stack_edit use the same rules.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'e2e2e2e2-0000-4000-8000-0000000000a1', true);
insert into public.drafts (id, content) values ('e2e2e2e2-0000-4000-8000-0000000000d1', '{}');
do $$ begin
  begin
    perform public.publish_draft('e2e2e2e2-0000-4000-8000-0000000000d1', 'T', pg_temp.one(pg_temp.picks(1)), null, 'numbered', repeat('d', 161));
    raise exception 'FAIL 8: publish_draft accepted a 161-character description';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.publish_draft('e2e2e2e2-0000-4000-8000-0000000000d1', 'T', pg_temp.one(pg_temp.picks(16)), null);
    raise exception 'FAIL 8: publish_draft accepted 16 picks';
  exception when invalid_parameter_value then null;
  end;
  if not exists (select 1 from public.drafts where id = 'e2e2e2e2-0000-4000-8000-0000000000d1') then
    raise exception 'FAIL 8: a refused publish removed the draft';
  end if;
  perform public.publish_draft('e2e2e2e2-0000-4000-8000-0000000000d1', 'T',
    pg_temp.one('[{"id":"bbbbbbbb-0000-4000-8000-000000000001","text":"Tagged","tags":["Must-do"]}]'::jsonb), null, 'numbered', repeat('d', 160));
  if (select sections -> 0 -> 'lines' -> 0 ->> 'id' || '|' || (sections -> 0 -> 'lines' -> 0 -> 'tags' ->> 0) from public.stacks where id = 'e2e2e2e2-0000-4000-8000-0000000000d1')
     <> 'bbbbbbbb-0000-4000-8000-000000000001|Must-do' then
    raise exception 'FAIL 8: the published pick lost its id or tag';
  end if;
  begin
    perform public.apply_stack_edit('e2e2e2e2-0000-4000-8000-0000000000c1', 'T', repeat('d', 161), pg_temp.one(pg_temp.picks(1)));
    raise exception 'FAIL 8: apply_stack_edit accepted a 161-character description';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.apply_stack_edit('e2e2e2e2-0000-4000-8000-0000000000c1', 'T', '', pg_temp.one('[{"text":"P","format":"text"}]'::jsonb));
    raise exception 'FAIL 8: apply_stack_edit accepted a paragraph';
  exception when invalid_parameter_value then null;
  end;
  perform public.apply_stack_edit('e2e2e2e2-0000-4000-8000-0000000000c1', 'Edited', repeat('d', 160), pg_temp.one(pg_temp.picks(15)));
  if (select line_count from public.stacks where id = 'e2e2e2e2-0000-4000-8000-0000000000c1') <> 15 then
    raise exception 'FAIL 8: an edit within the limits was not applied';
  end if;
end $$;
reset role;

select 'all pick model checks passed' as result;
rollback;
