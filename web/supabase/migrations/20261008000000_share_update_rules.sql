-- Rules from docs/user-flows/edit-stack.md for sharing an update:
-- * Publish & Share Update is only allowed when the stack actually changed.
-- * A shared update moves the stack to the top of the author's profile (pinned stacks stay first).
-- Update notes stop showing 7 days after sharing; the app hides them by date, so no change is needed here.

-- apply_stack_edit: same as before, with both rules. Sharing clears profile_position, so the stack leaves any
-- manual order and sorts first among the newest by feed_at, as if newly published.
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

