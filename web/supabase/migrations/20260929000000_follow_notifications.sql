-- "started following you" notifications.
--
-- One per follower per person: unfollowing and following again doesn't
-- notify twice. Written only by the trigger, like the other notifications.

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('comment', 'reply', 'mention', 'like', 'save', 'fork', 'follow'));

create unique index if not exists notifications_follow_uniq on public.notifications (recipient_id, actor_id)
  where type = 'follow';

create or replace function public.notify_on_follow()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.follower_id <> new.followee_id then
    insert into notifications (recipient_id, actor_id, type)
    values (new.followee_id, new.follower_id, 'follow')
    on conflict do nothing;
  end if;
  return null;
end;
$$;

create trigger follows_notify after insert on public.follows
  for each row execute function public.notify_on_follow();

revoke execute on function public.notify_on_follow() from public, anon, authenticated;

-- Last 30 days of follows, already marked read.
insert into public.notifications (recipient_id, actor_id, type, created_at, read_at)
select f.followee_id, f.follower_id, 'follow', f.created_at, now()
  from public.follows f
 where f.created_at > now() - interval '30 days'
on conflict do nothing;
