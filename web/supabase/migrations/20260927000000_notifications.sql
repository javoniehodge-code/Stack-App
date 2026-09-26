-- Notifications: likes, saves, comments and forks on your stacks.
--
-- Rows are written only by the triggers below (security definer); clients can
-- read their own rows and set read_at on them, nothing else. Deleted stacks,
-- comments, forks or actors null out their reference instead of removing the
-- notification, so the app can show "no longer available".

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.profiles (id) on delete cascade,
  actor_id     uuid references public.profiles (id) on delete set null,
  type         text not null check (type in ('comment', 'like', 'save', 'fork')),
  stack_id     uuid references public.stacks (id) on delete set null,
  comment_id   uuid references public.comments (id) on delete set null,
  fork_id      uuid references public.stacks (id) on delete set null,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  -- Snapshot of the recipient's stack title, for when the stack is deleted.
  metadata     jsonb not null default '{}'::jsonb
);

-- Feed of one person's notifications, newest first (keyset pagination).
create index notifications_recipient_idx on public.notifications (recipient_id, created_at desc, id desc);
-- Same, per type, for the filter chips.
create index notifications_recipient_type_idx on public.notifications (recipient_id, type, created_at desc, id desc);
-- Unread count for the tab badge.
create index notifications_unread_idx on public.notifications (recipient_id) where read_at is null;

-- One notification per like/save per person per stack (unlike + like again
-- doesn't notify twice), one per comment and one per fork.
create unique index notifications_like_save_uniq on public.notifications (recipient_id, actor_id, type, stack_id)
  where type in ('like', 'save');
create unique index notifications_comment_uniq on public.notifications (comment_id) where type = 'comment';
create unique index notifications_fork_uniq on public.notifications (fork_id) where type = 'fork';

alter table public.notifications enable row level security;

create policy "read own notifications" on public.notifications
  for select using (recipient_id = auth.uid());
create policy "mark own notifications read" on public.notifications
  for update using (recipient_id = auth.uid()) with check (recipient_id = auth.uid());

revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- ─────────────────────────────────────────────────────────────
-- Triggers
-- ─────────────────────────────────────────────────────────────

-- Notifies the author of `p_stack` about `p_type` by `p_actor`, unless they
-- are the same person or the stack isn't published.
create or replace function public.notify_stack_author(
  p_type text, p_actor uuid, p_stack uuid, p_comment uuid default null, p_fork uuid default null, p_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  st record;
begin
  select id, author_id, title into st from stacks where id = p_stack and status = 'published';
  if st.id is null or p_actor is null or st.author_id = p_actor then
    return;
  end if;
  insert into notifications (recipient_id, actor_id, type, stack_id, comment_id, fork_id, created_at, metadata)
  values (st.author_id, p_actor, p_type, st.id, p_comment, p_fork, p_at, jsonb_build_object('stack_title', st.title))
  on conflict do nothing;
end;
$$;

create or replace function public.notify_on_like_or_save()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform notify_stack_author(tg_argv[0], new.user_id, new.stack_id);
  return null;
end;
$$;

create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform notify_stack_author('comment', new.author_id, new.stack_id, new.id);
  return null;
end;
$$;

-- A fork notifies once, when it is first published.
create or replace function public.notify_on_fork()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.forked_from_id is not null and new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    perform notify_stack_author('fork', new.author_id, new.forked_from_id, null, new.id);
  end if;
  return null;
end;
$$;

create trigger likes_notify after insert on public.likes
  for each row execute function public.notify_on_like_or_save('like');
create trigger saves_notify after insert on public.saves
  for each row execute function public.notify_on_like_or_save('save');
create trigger comments_notify after insert on public.comments
  for each row execute function public.notify_on_comment();
create trigger stacks_fork_notify after insert or update of status on public.stacks
  for each row execute function public.notify_on_fork();

revoke execute on function public.notify_stack_author(text, uuid, uuid, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.notify_on_like_or_save() from public, anon, authenticated;
revoke execute on function public.notify_on_comment() from public, anon, authenticated;
revoke execute on function public.notify_on_fork() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- Backfill the last 30 days, already marked read so the badge starts at zero.
-- ─────────────────────────────────────────────────────────────
insert into public.notifications (recipient_id, actor_id, type, stack_id, comment_id, fork_id, created_at, read_at, metadata)
select s.author_id, a.actor_id, a.type, s.id, a.comment_id, a.fork_id, a.created_at, now(), jsonb_build_object('stack_title', s.title)
  from (
    select 'like'::text as type, l.user_id as actor_id, l.stack_id, null::uuid as comment_id, null::uuid as fork_id, l.created_at
      from public.likes l
    union all
    select 'save', v.user_id, v.stack_id, null, null, v.created_at from public.saves v
    union all
    select 'comment', c.author_id, c.stack_id, c.id, null, c.created_at from public.comments c
    union all
    select 'fork', f.author_id, f.forked_from_id, null, f.id, coalesce(f.published_at, f.created_at)
      from public.stacks f
     where f.forked_from_id is not null and f.status = 'published'
  ) a
  join public.stacks s on s.id = a.stack_id and s.status = 'published'
 where a.created_at > now() - interval '30 days'
   and a.actor_id <> s.author_id
on conflict do nothing;
