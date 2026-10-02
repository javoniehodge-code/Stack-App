-- Editing published stacks, sharing updates, and hiding follower counts.
--
-- * A published stack can be edited by its author. Unsaved edits live in a
--   draft row that points at the stack (edit_of) until the author saves them.
-- * apply_stack_edit() writes the edits to the stack. With p_share it also puts
--   the stack back into the feed with an optional note of up to 40 characters.
--   Only public stacks can share an update, at most once every 7 days.
-- * feed_at is when a stack last entered the feed (published or shared). Feeds
--   are ordered by it.
-- * profiles.show_follow_counts: whether a profile shows its follower and
--   following counts. Off by default.

alter table public.stacks
  add column if not exists edit_of uuid references public.stacks (id) on delete cascade,
  add column if not exists shared_at timestamptz,
  add column if not exists update_note text not null default '' check (char_length(update_note) <= 40),
  add column if not exists feed_at timestamptz generated always as (coalesce(shared_at, published_at)) stored;

alter table public.stacks drop constraint if exists stacks_edit_is_draft;
alter table public.stacks add constraint stacks_edit_is_draft check (edit_of is null or status = 'draft');

-- One set of unsaved edits per stack.
create unique index if not exists stacks_edit_of_uniq on public.stacks (edit_of) where edit_of is not null;
create index if not exists stacks_feed_idx on public.stacks (feed_at desc) where status = 'published';

-- save_stack: same as before, plus p_edit_of to keep unsaved edits to a published stack as a draft.
-- Such a draft can't be published; its edits are saved with apply_stack_edit().
drop function if exists public.save_stack(uuid, text, jsonb, text[], text, uuid, text, text, text, text);

create function public.save_stack(
  p_id          uuid,
  p_title       text,
  p_sections    jsonb,
  p_tags        text[],
  p_status      text,
  p_forked_from uuid default null,
  p_style       text default 'numbered',
  p_description text default null,
  p_visibility  text default null,
  p_location    text default null,
  p_edit_of     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  sid  uuid;
  t    text;
  descr text := btrim(p_description);
  loc  text := btrim(p_location);
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'published') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_visibility is not null and p_visibility not in ('public', 'unlisted', 'private') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;
  if char_length(descr) > 300 then
    raise exception 'descriptions are limited to 300 characters' using errcode = '22023';
  end if;
  if char_length(loc) > 80 then
    raise exception 'locations are limited to 80 characters' using errcode = '22023';
  end if;
  if p_forked_from is not null and not exists (
    select 1 from stacks s where s.id = p_forked_from and s.status = 'published' and can_open_stack(s)
  ) then
    p_forked_from := null;
  end if;

  if p_edit_of is not null then
    if p_status <> 'draft' then
      raise exception 'edits to a published stack are saved, not published' using errcode = '22023';
    end if;
    if not exists (select 1 from stacks s where s.id = p_edit_of and s.author_id = uid and s.status = 'published') then
      raise exception 'stack not found' using errcode = 'P0002';
    end if;
    -- Keep writing to the existing edits draft, if there is one.
    if p_id is null then
      select s.id into p_id from stacks s where s.edit_of = p_edit_of and s.author_id = uid;
    end if;
  end if;

  if p_id is null then
    insert into stacks (author_id, title, description, sections, status, forked_from_id, style, visibility, location, edit_of)
    values (uid, coalesce(p_title, ''), coalesce(descr, ''), coalesce(p_sections, '[]'::jsonb), p_status, p_forked_from,
            coalesce(p_style, 'numbered'), coalesce(p_visibility, 'public'), coalesce(loc, ''), p_edit_of)
    returning id into sid;
  else
    if p_status = 'published' and exists (select 1 from stacks s where s.id = p_id and s.edit_of is not null) then
      raise exception 'edits to a published stack are saved, not published' using errcode = '22023';
    end if;
    update stacks
       set title = coalesce(p_title, ''),
           description = coalesce(descr, description),
           sections = coalesce(p_sections, '[]'::jsonb),
           status = p_status,
           style = coalesce(p_style, style),
           visibility = coalesce(p_visibility, visibility),
           location = coalesce(loc, location),
           forked_from_id = coalesce(p_forked_from, forked_from_id)
     where id = p_id and author_id = uid and status = 'draft'
    returning id into sid;
    if sid is null then
      raise exception 'draft not found' using errcode = 'P0002';
    end if;
    delete from stack_tags where stack_id = sid;
  end if;

  if p_tags is not null then
    if array_length(p_tags, 1) > 20 then
      raise exception 'a stack can have at most 20 tags' using errcode = '22023';
    end if;
    foreach t in array p_tags loop
      t := btrim(regexp_replace(t, '^#', ''));
      continue when t = '';
      insert into stack_tags (stack_id, tag) values (sid, left(t, 40))
      on conflict do nothing;
    end loop;
  end if;
  return sid;
end;
$$;

revoke execute on function public.save_stack(uuid, text, jsonb, text[], text, uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.save_stack(uuid, text, jsonb, text[], text, uuid, text, text, text, text, uuid) to authenticated;

-- Saves edits to one of your published stacks and removes its edits draft. With p_share, the stack
-- goes back into the feed with p_note. Returns when it was last shared.
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
         update_note = case when p_share then note else update_note end
   where id = p_id
  returning shared_at into shared;

  delete from stacks where edit_of = p_id and author_id = uid;
  return shared;
end;
$$;

revoke execute on function public.apply_stack_edit(uuid, text, text, jsonb, boolean, text) from public, anon;
grant execute on function public.apply_stack_edit(uuid, text, text, jsonb, boolean, text) to authenticated;

-- following_feed: same as before, with a shared update counting as the stack's latest activity.
create or replace function public.following_feed(p_offset int default 0, p_limit int default 20)
returns table (stack_id uuid, activity_at timestamptz, reposter_id uuid, note text)
language sql
stable
set search_path = public
as $$
  with fol as (
    select followee_id from follows where follower_id = auth.uid()
  ),
  events as (
    select s.id as stack_id, coalesce(s.shared_at, s.published_at) as activity_at, null::uuid as reposter_id, ''::text as note
      from stacks s
     where s.status = 'published' and s.visibility = 'public' and s.author_id in (select followee_id from fol)
    union all
    select r.stack_id, r.created_at, r.user_id, r.note
      from reposts r
      join stacks s on s.id = r.stack_id and s.status = 'published'
     where r.user_id in (select followee_id from fol)
       and s.author_id <> auth.uid()
  ),
  latest as (
    select distinct on (stack_id) * from events order by stack_id, activity_at desc
  )
  select stack_id, activity_at, reposter_id, note
    from latest
   order by activity_at desc, stack_id desc
  offset greatest(p_offset, 0)
   limit least(greatest(p_limit, 1), 50);
$$;

-- Follower and following counts on profiles are hidden unless the person turns them on.
alter table public.profiles add column if not exists show_follow_counts boolean not null default false;
grant update (show_follow_counts) on public.profiles to authenticated;
