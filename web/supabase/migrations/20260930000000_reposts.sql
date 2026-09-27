-- Reposts: an optional note, a count on each stack, "reposted" notifications,
-- and a Following feed that mixes stacks and reposts from people you follow.
--
-- * reposts.note: up to 500 characters, like descriptions and comments. Notes
--   can't be edited; undo and repost again instead.
-- * You can't repost your own stack.
-- * stacks.reposts_count is kept up to date like likes_count and saves_count.
-- * One "reposted" notification per person per stack, so undo + repost again
--   doesn't notify twice (it only updates the note shown).
-- * following_feed(): each stack shows once, at its most recent activity
--   (published by someone you follow, or reposted by someone you follow).

alter table public.reposts
  add column if not exists note text not null default ''
  check (char_length(note) <= 500);

create index if not exists reposts_user_created_idx on public.reposts (user_id, created_at desc);

drop policy if exists "repost published stacks" on public.reposts;
create policy "repost published stacks" on public.reposts for insert with check (
  user_id = auth.uid()
  and exists (
    select 1 from public.stacks s
     where s.id = stack_id and s.status = 'published' and s.author_id <> auth.uid()
  ));

-- Counter
alter table public.stacks add column if not exists reposts_count int not null default 0;

update public.stacks s
   set reposts_count = r.n
  from (select stack_id, count(*)::int as n from public.reposts group by stack_id) r
 where r.stack_id = s.id;

create trigger reposts_count after insert or delete on public.reposts
  for each row execute function public.bump_stack_counter('reposts_count');

-- Notifications
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('comment', 'reply', 'mention', 'like', 'save', 'fork', 'follow', 'repost'));

create unique index if not exists notifications_repost_uniq on public.notifications (recipient_id, actor_id, stack_id)
  where type = 'repost';

create or replace function public.notify_on_repost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  st record;
begin
  select id, author_id, title into st from stacks where id = new.stack_id and status = 'published';
  if st.id is null or st.author_id = new.user_id then
    return null;
  end if;
  insert into notifications (recipient_id, actor_id, type, stack_id, metadata)
  values (st.author_id, new.user_id, 'repost', st.id, jsonb_build_object('stack_title', st.title, 'note', new.note))
  on conflict (recipient_id, actor_id, stack_id) where type = 'repost'
  do update set metadata = excluded.metadata;
  return null;
end;
$$;

create trigger reposts_notify after insert on public.reposts
  for each row execute function public.notify_on_repost();

revoke execute on function public.notify_on_repost() from public, anon, authenticated;

-- Last 30 days of reposts, already marked read.
insert into public.notifications (recipient_id, actor_id, type, stack_id, created_at, read_at, metadata)
select s.author_id, r.user_id, 'repost', s.id, r.created_at, now(), jsonb_build_object('stack_title', s.title, 'note', r.note)
  from public.reposts r
  join public.stacks s on s.id = r.stack_id and s.status = 'published'
 where r.created_at > now() - interval '30 days'
   and s.author_id <> r.user_id
on conflict do nothing;

-- Following feed: one row per stack, newest activity first. Runs as the
-- caller, so the usual row-level security applies.
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
     where s.status = 'published' and s.author_id in (select followee_id from fol)
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

revoke execute on function public.following_feed(int, int) from public, anon;
grant execute on function public.following_feed(int, int) to authenticated;
