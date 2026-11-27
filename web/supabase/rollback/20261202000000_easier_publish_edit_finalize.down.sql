-- Rollback for 20261202000000_easier_publish_edit_finalize.sql. Run by hand, then mark the migration reverted:
--   supabase migration repair --status reverted 20261202000000
-- Puts back check_publishable as in 20261201000000_publish_checks (a category, and a city for a place Stack, are
-- required again) and apply_stack_edit as in 20261129000000_pick_model (without the Finalize choices). Choices
-- already saved on Stacks stay.

begin;

-- What every publish needs (see the top). p_place: whether it's about a place; p_city: its city, trimmed.
create or replace function public.check_publishable(p_title text, p_sections jsonb, p_categories text[], p_place boolean, p_city text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  n      record;
  titled int;
begin
  if char_length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'add a title' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_categories, '{}')) = 0 then
    raise exception 'pick at least 1 category' using errcode = '22023';
  end if;
  if p_place and btrim(coalesce(p_city, '')) = '' then
    raise exception 'add a city to publish this place stack' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_city, ''))) > 80 then
    raise exception 'locations are limited to 80 characters' using errcode = '22023';
  end if;
  -- normalize_sections drops empty picks and sections, so a titled section that went missing had no items.
  select * into n from public.normalize_sections(coalesce(p_sections, '[]'::jsonb));
  if n.line_count = 0 then
    raise exception 'add at least one item' using errcode = '22023';
  end if;
  select count(*) into titled from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) x
   where jsonb_typeof(x) = 'object' and nullif(public.one_line(x ->> 'label'), '') is not null;
  if titled > (select count(*) from jsonb_array_elements(n.sections) x where x ->> 'label' is not null) then
    raise exception 'a section has no items: add one or remove the section' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.check_publishable(text, jsonb, text[], boolean, text) from public, anon, authenticated;

drop function if exists public.apply_stack_edit(uuid, text, text, jsonb, boolean, text, text, text, boolean, text, text[]);

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
  descr text := public.one_line(p_description);
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
  if char_length(descr) > 160 then
    raise exception 'descriptions are limited to 160 characters' using errcode = '22023';
  end if;
  if char_length(note) > 40 then
    raise exception 'update notes are limited to 40 characters' using errcode = '22023';
  end if;
  if p_share then
    if public.one_line(p_title) = st.title and descr = coalesce(st.description, '')
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

  delete from drafts where edit_of = p_id and owner_id = uid;
  delete from stacks where edit_of = p_id and author_id = uid;
  return shared;
end;
$$;

revoke execute on function public.apply_stack_edit(uuid, text, text, jsonb, boolean, text) from public, anon;
grant execute on function public.apply_stack_edit(uuid, text, text, jsonb, boolean, text) to authenticated;

commit;

notify pgrst, 'reload schema';
