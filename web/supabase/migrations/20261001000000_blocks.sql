-- Blocking, two-way: if either person blocked the other, neither sees the
-- other's profile, stacks or comments (on anyone's stack), and they can't
-- follow each other or notify each other. Nothing is deleted except follows
-- and notifications between the two, so unblocking brings comments back.
--
-- The rule lives in one helper, is_blocked_with(), used by the row-level
-- security policies below, so every query gets it. Functions that bypass RLS
-- (security definer) check it explicitly.

create table public.blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index blocks_blocked_idx on public.blocks (blocked_id, blocker_id);

alter table public.blocks enable row level security;
create policy "read own blocks" on public.blocks for select using (blocker_id = auth.uid());
create policy "block" on public.blocks for insert with check (blocker_id = auth.uid());
create policy "unblock" on public.blocks for delete using (blocker_id = auth.uid());

-- True when the signed-in person and `other` have blocked each other in either direction.
create or replace function public.is_blocked_with(other uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and other is not null and exists (
    select 1 from blocks b
     where (b.blocker_id = auth.uid() and b.blocked_id = other)
        or (b.blocker_id = other and b.blocked_id = auth.uid())
  );
$$;

-- True when a and b have blocked each other in either direction (for triggers).
create or replace function public.blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from blocks x
     where (x.blocker_id = a and x.blocked_id = b) or (x.blocker_id = b and x.blocked_id = a)
  );
$$;

revoke execute on function public.blocked_between(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_blocked_with(uuid) to anon, authenticated;

-- Row-level security: same policies as before, plus the block rule.
drop policy "profiles are public" on public.profiles;
create policy "profiles are public" on public.profiles for select
  using (not public.is_blocked_with(id));

drop policy "published stacks are public; drafts are private" on public.stacks;
create policy "published stacks are public; drafts are private" on public.stacks for select
  using ((status = 'published' and not public.is_blocked_with(author_id)) or author_id = auth.uid());

drop policy "comments on published stacks are public" on public.comments;
create policy "comments on published stacks are public" on public.comments for select using (
  not public.is_blocked_with(author_id)
  and exists (select 1 from public.stacks s where s.id = stack_id and s.status = 'published'));

drop policy "follow" on public.follows;
create policy "follow" on public.follows for insert
  with check (follower_id = auth.uid() and not public.is_blocked_with(followee_id));

-- Blocking removes follows and notifications between the two, both ways.
create or replace function public.on_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from follows
   where (follower_id = new.blocker_id and followee_id = new.blocked_id)
      or (follower_id = new.blocked_id and followee_id = new.blocker_id);
  delete from notifications
   where (recipient_id = new.blocker_id and actor_id = new.blocked_id)
      or (recipient_id = new.blocked_id and actor_id = new.blocker_id);
  return null;
end;
$$;

create trigger blocks_after_insert after insert on public.blocks
  for each row execute function public.on_block();

-- No new notifications between blocked people (mentions, replies, likes…).
create or replace function public.notifications_skip_blocked()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.actor_id is not null and blocked_between(new.recipient_id, new.actor_id) then
    return null;
  end if;
  return new;
end;
$$;

create trigger notifications_skip_blocked before insert on public.notifications
  for each row execute function public.notifications_skip_blocked();

-- Replies: a reply into a thread started by someone blocked with the replier
-- becomes a plain comment. Replaces the version from comment_replies.
create or replace function public.comments_before_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  par record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select id, stack_id, parent_id into par from comments where id = new.parent_id;
  if par.id is null or par.stack_id <> new.stack_id then
    new.parent_id := null;
    return new;
  elsif par.parent_id is not null then
    new.parent_id := par.parent_id;
  end if;
  if blocked_between(new.author_id, (select author_id from comments where id = new.parent_id)) then
    new.parent_id := null;
  end if;
  return new;
end;
$$;

revoke execute on function public.on_block() from public, anon, authenticated;
revoke execute on function public.notifications_skip_blocked() from public, anon, authenticated;
revoke execute on function public.comments_before_insert() from public, anon, authenticated;

-- Security definer functions skip RLS, so they apply the rule themselves.
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
                and not is_blocked_with(s.author_id)
                and exists (select 1 from stack_tags t where t.stack_id = s.id and lower(t.tag) = lower(c.name))
              order by s.likes_count desc
              limit 2) x
         ), '{}'),
         (select count(*)::int from stacks s
           where s.status = 'published'
             and not is_blocked_with(s.author_id)
             and exists (select 1 from stack_tags t where t.stack_id = s.id and lower(t.tag) = lower(c.name)))
    from unnest(cats) with ordinality as c(name, ord)
   order by c.ord;
$$;

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
   where s.id = p_id and s.status = 'published' and not is_blocked_with(s.author_id);
$$;

-- Your blocked accounts, for the Unblock list (their profiles are hidden from you).
create or replace function public.my_blocks()
returns table (id uuid, handle text, name text, blocked_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.handle, p.name, b.created_at
    from blocks b
    join profiles p on p.id = b.blocked_id
   where b.blocker_id = auth.uid()
   order by b.created_at desc;
$$;

revoke execute on function public.my_blocks() from public, anon;
grant execute on function public.my_blocks() to authenticated;
