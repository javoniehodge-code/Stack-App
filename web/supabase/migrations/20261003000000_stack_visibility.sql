-- Stack visibility: public, unlisted or private.
--
-- * public: on your profile, in feeds, search and Explore (every existing stack).
-- * unlisted: opens from its link for anyone (not blocked), but is left out of
--   feeds, search, Explore and other people's view of your profile. People who
--   follow someone who reposted it see the repost in Following.
-- * private: only the author can read it (and its comments, likes and reposts).
--
-- Row-level security enforces private. Unlisted is a listing rule, so the
-- listing functions below and the app's feed/profile queries filter on
-- visibility = 'public'.

alter table public.stacks
  add column if not exists visibility text not null default 'public'
  check (visibility in ('public', 'unlisted', 'private'));

create index if not exists stacks_author_visibility_idx on public.stacks (author_id, visibility);

-- Row-level security: private stacks are the author's only. Policies on likes,
-- saves, reposts and comments check the stack through this policy, so they
-- follow it (nobody else can like, comment on or repost a private stack).
drop policy "published stacks are public; drafts are private" on public.stacks;
create policy "published stacks are public; drafts are private" on public.stacks for select
  using ((status = 'published' and visibility <> 'private' and not public.is_blocked_with(author_id))
         or author_id = auth.uid());

-- True when the signed-in person can open the stack by its link (for security definer functions).
create or replace function public.can_open_stack(s public.stacks)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select s.author_id = auth.uid()
      or (s.status = 'published' and s.visibility <> 'private' and not is_blocked_with(s.author_id));
$$;

grant execute on function public.can_open_stack(public.stacks) to anon, authenticated;

-- Create or update a stack. Same as before plus p_visibility; leaving it out
-- keeps the draft's visibility (public for new stacks).
drop function if exists public.save_stack(uuid, text, jsonb, text[], text, uuid, text, text);

create function public.save_stack(
  p_id          uuid,
  p_title       text,
  p_sections    jsonb,
  p_tags        text[],
  p_status      text,
  p_forked_from uuid default null,
  p_style       text default 'numbered',
  p_description text default null,
  p_visibility  text default null
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
  if char_length(descr) > 500 then
    raise exception 'descriptions are limited to 500 characters' using errcode = '22023';
  end if;
  if p_forked_from is not null and not exists (
    select 1 from stacks s where s.id = p_forked_from and s.status = 'published' and can_open_stack(s)
  ) then
    p_forked_from := null;
  end if;

  if p_id is null then
    insert into stacks (author_id, title, description, sections, status, forked_from_id, style, visibility)
    values (uid, coalesce(p_title, ''), coalesce(descr, ''), coalesce(p_sections, '[]'::jsonb), p_status, p_forked_from,
            coalesce(p_style, 'numbered'), coalesce(p_visibility, 'public'))
    returning id into sid;
  else
    update stacks
       set title = coalesce(p_title, ''),
           description = coalesce(descr, description),
           sections = coalesce(p_sections, '[]'::jsonb),
           status = p_status,
           style = coalesce(p_style, style),
           visibility = coalesce(p_visibility, visibility),
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

revoke execute on function public.save_stack(uuid, text, jsonb, text[], text, uuid, text, text, text) from public, anon;
grant execute on function public.save_stack(uuid, text, jsonb, text[], text, uuid, text, text, text) to authenticated;

-- Change who can see one of your stacks (published or draft).
create or replace function public.set_stack_visibility(p_id uuid, p_visibility text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_visibility not in ('public', 'unlisted', 'private') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;
  update stacks set visibility = p_visibility where id = p_id and author_id = auth.uid();
  if not found then
    raise exception 'stack not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function public.set_stack_visibility(uuid, text) from public, anon;
grant execute on function public.set_stack_visibility(uuid, text) to authenticated;

-- Listings (security definer, so they filter explicitly): public stacks only.
create or replace function public.search_stacks(q text)
returns setof public.stacks
language sql
stable
security definer
set search_path = public
as $$
  select s.*
    from stacks s
    join profiles p on p.id = s.author_id
   where s.status = 'published'
     and s.visibility = 'public'
     and not is_blocked_with(s.author_id)
     and btrim(coalesce(q, '')) <> ''
     and (
       s.title ilike '%' || btrim(q) || '%'
       or p.name ilike '%' || btrim(q) || '%'
       or ('@' || p.handle) ilike '%' || btrim(q) || '%'
       or exists (select 1 from stack_tags t where t.stack_id = s.id and t.tag ilike '%' || btrim(q) || '%')
     )
   order by s.likes_count desc, s.published_at desc
   limit 50;
$$;

create or replace function public.explore_categories(cats text[])
returns table (name text, titles text[], total int)
language sql
stable
security definer
set search_path = public
as $$
  select c.name,
         coalesce((
           select array_agg(x.title) from (
             select s.title from stacks s
              where s.status = 'published'
                and s.visibility = 'public'
                and not is_blocked_with(s.author_id)
                and exists (select 1 from stack_tags t where t.stack_id = s.id and lower(t.tag) = lower(c.name))
              order by s.likes_count desc
              limit 2) x
         ), '{}'),
         (select count(*)::int from stacks s
           where s.status = 'published'
             and s.visibility = 'public'
             and not is_blocked_with(s.author_id)
             and exists (select 1 from stack_tags t where t.stack_id = s.id and lower(t.tag) = lower(c.name)))
    from unnest(cats) with ordinality as c(name, ord)
   order by c.ord;
$$;

-- Colour dots: any stack the caller can open (unlisted ones show on their own page).
create or replace function public.stack_categories(ids uuid[], cats text[])
returns table (stack_id uuid, category text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (s.id) s.id, c.name
    from stacks s
    join stack_tags t on t.stack_id = s.id
    join unnest(cats) with ordinality as c(name, ord) on lower(c.name) = lower(t.tag)
   where s.id = any(ids) and s.status = 'published' and can_open_stack(s)
   order by s.id, c.ord;
$$;

-- Forks: anything the caller can open by link (so unlisted stacks can be forked, private ones can't).
create or replace function public.fork_template(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', s.id,
           'title', s.title,
           'description', s.description,
           'sections', s.sections,
           'style', s.style,
           'tags', coalesce((select jsonb_agg(t.tag order by t.tag) from stack_tags t where t.stack_id = s.id), '[]'::jsonb))
    from stacks s
   where s.id = p_id and s.status = 'published' and can_open_stack(s);
$$;

-- Following feed: public stacks by people you follow, plus their reposts
-- (row-level security already hides private stacks).
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
    select s.id as stack_id, s.published_at as activity_at, null::uuid as reposter_id, ''::text as note
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
