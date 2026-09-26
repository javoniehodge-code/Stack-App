-- Comment replies and @mentions, with notifications for both.
--
-- * comments.parent_id: the comment being replied to. Threads are one level
--   deep: replying to a reply attaches to that reply's parent. Deleting a
--   comment keeps its replies (they become top-level).
-- * Notification types 'reply' and 'mention'. On each new comment every
--   person gets at most one notification, in this order of priority:
--   reply (to their comment) > mention (@handle) > comment (on their stack).
--   Nobody is notified about their own comment.

alter table public.comments
  add column if not exists parent_id uuid references public.comments (id) on delete set null;
create index if not exists comments_parent_idx on public.comments (parent_id);

-- Keep threads one level deep and on the same stack.
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
  elsif par.parent_id is not null then
    new.parent_id := par.parent_id;
  end if;
  return new;
end;
$$;

create trigger comments_before_insert
  before insert on public.comments
  for each row execute function public.comments_before_insert();

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type in ('comment', 'reply', 'mention', 'like', 'save', 'fork'));

-- One notification per person per comment, whatever its type.
drop index if exists public.notifications_comment_uniq;
create unique index notifications_comment_uniq on public.notifications (recipient_id, comment_id)
  where type in ('comment', 'reply', 'mention');

-- Replaces the comment trigger function from the notifications migration.
create or replace function public.notify_on_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  st      record;
  parent_author uuid;
  mentioned uuid[];
  meta    jsonb;
begin
  select id, author_id, title into st from stacks where id = new.stack_id and status = 'published';
  if st.id is null then
    return null;
  end if;
  meta := jsonb_build_object('stack_title', st.title);

  -- 1. Reply: the author of the comment being replied to.
  if new.parent_id is not null then
    select author_id into parent_author from comments where id = new.parent_id;
    if parent_author is not null and parent_author <> new.author_id then
      insert into notifications (recipient_id, actor_id, type, stack_id, comment_id, metadata)
      values (parent_author, new.author_id, 'reply', st.id, new.id, meta)
      on conflict do nothing;
    end if;
  end if;

  -- 2. Mentions: up to 10 distinct @handles that belong to real people.
  select array_agg(p.id) into mentioned
    from (
      select distinct lower(m[1]) as handle
        from regexp_matches(new.body, '(?:^|[^a-zA-Z0-9._])@([a-zA-Z0-9._]{2,30})', 'g') as m
       limit 10
    ) h
    join profiles p on p.handle = rtrim(h.handle, '.');
  if mentioned is not null then
    insert into notifications (recipient_id, actor_id, type, stack_id, comment_id, metadata)
    select r, new.author_id, 'mention', st.id, new.id, meta
      from unnest(mentioned) as r
     where r <> new.author_id
    on conflict do nothing;
  end if;

  -- 3. Comment: the stack's author, unless already notified above.
  if st.author_id <> new.author_id then
    insert into notifications (recipient_id, actor_id, type, stack_id, comment_id, metadata)
    values (st.author_id, new.author_id, 'comment', st.id, new.id, meta)
    on conflict do nothing;
  end if;
  return null;
end;
$$;

revoke execute on function public.comments_before_insert() from public, anon, authenticated;
revoke execute on function public.notify_on_comment() from public, anon, authenticated;
