-- ROLLBACK for 20261128000000_drafts.sql. Run by hand, then:
--   supabase migration repair --db-url "$DB_URL" --status reverted 20261128000000
--
-- Moves drafts back into public.stacks (status 'draft', same ids), restores apply_stack_edit() and removes
-- publish_draft(). A draft that breaks the stack rules (over a limit, which the drafts table allows) can't go back
-- into public.stacks: it stays in public.drafts, still owner-only, and the table is kept until it's empty. The
-- notice reports how many moved and how many stayed.

begin;

do $$
declare
  r     record;
  moved int := 0;
  kept  int := 0;
begin
  for r in select * from public.drafts order by created_at loop
    begin
      insert into public.stacks (id, author_id, title, description, sections, status, style, visibility, location, edit_of, forked_from_id, created_at, updated_at)
      values (r.id, r.owner_id, coalesce(r.content->>'title', ''), coalesce(r.content->>'description', ''),
              coalesce(r.content->'sections', '[]'::jsonb), 'draft', coalesce(r.content->>'style', 'numbered'),
              coalesce(r.content->>'visibility', 'public'), coalesce(r.content->>'location', ''), r.edit_of, r.remixed_from,
              r.created_at, r.updated_at);
      insert into public.stack_tags (stack_id, tag)
      select r.id, left(btrim(t), 40) from jsonb_array_elements_text(coalesce(r.content->'tags', '[]'::jsonb)) t where btrim(t) <> ''
      on conflict do nothing;
      delete from public.drafts where id = r.id;
      moved := moved + 1;
    exception when others then
      kept := kept + 1;
    end;
  end loop;
  raise notice 'drafts moved back to public.stacks: %, kept in public.drafts (over the stack rules): %', moved, kept;
end $$;

drop function if exists public.publish_draft(uuid, text, jsonb, text[], text, text, text, text);

-- apply_stack_edit as in 20261008000000_share_update_rules.
create or replace function public.apply_stack_edit(
  p_id          uuid,
  p_title       text,
  p_description text,
  p_sections    jsonb,
  p_share       boolean default false,
  p_note        text default ''
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  st    stacks;
  descr text := btrim(coalesce(p_description, ''));
  note  text := btrim(coalesce(p_note, ''));
  shared timestamptz;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select * into st from stacks where id = p_id and author_id = uid and status = 'published' for update;
  if not found then
    raise exception 'stack not found' using errcode = 'P0002';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'add a title' using errcode = '22023';
  end if;
  if char_length(descr) > 300 then
    raise exception 'descriptions are limited to 300 characters' using errcode = '22023';
  end if;
  if char_length(note) > 40 then
    raise exception 'update notes are limited to 40 characters' using errcode = '22023';
  end if;
  if p_share then
    if btrim(p_title) = st.title and descr = coalesce(st.description, '')
       and (select n.sections from public.normalize_sections(coalesce(p_sections, '[]'::jsonb)) n) = st.sections then
      raise exception 'change something before sharing an update' using errcode = '22023';
    end if;
    if st.visibility <> 'public' then
      raise exception 'only public stacks can share updates' using errcode = '22023';
    end if;
    if st.shared_at is not null and st.shared_at > now() - interval '7 days' then
      raise exception 'you can share an update once every 7 days' using errcode = '22023';
    end if;
  end if;

  update stacks
     set title = btrim(p_title),
         description = descr,
         sections = coalesce(p_sections, '[]'::jsonb),
         shared_at = case when p_share then now() else shared_at end,
         update_note = case when p_share then note else update_note end,
         profile_position = case when p_share then null else profile_position end
   where id = p_id
  returning shared_at into shared;

  delete from stacks where edit_of = p_id and author_id = uid;
  return shared;
end;
$$;

-- The drafts table goes once nothing is left in it.
do $$
begin
  if not exists (select 1 from public.drafts) then
    drop table public.drafts;
    drop function if exists public.drafts_before_write();
  end if;
end $$;

commit;
