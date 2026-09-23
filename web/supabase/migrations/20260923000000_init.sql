-- Stack: initial schema
--
-- Stacks are short lists: a title, optional subsections, and lines of at most
-- 120 characters, each with an optional link. Tags are private search metadata
-- — they are never readable by anyone but the author; search goes through
-- security-definer functions that only return matching stacks.

-- ─────────────────────────────────────────────────────────────
-- Profiles
-- ─────────────────────────────────────────────────────────────
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  handle      text not null unique check (handle ~ '^[a-z0-9._]{2,30}$'),
  name        text not null check (char_length(btrim(name)) between 1 and 50),
  bio         text not null default '' check (char_length(bio) <= 160),
  created_at  timestamptz not null default now()
);

-- New auth users get a profile with a generated, unique handle.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  base   text;
  candidate text;
  display text;
begin
  base := lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-zA-Z0-9._]', '', 'g'));
  if char_length(base) < 2 then base := 'user'; end if;
  base := left(base, 24);
  candidate := base;
  while exists (select 1 from public.profiles where handle = candidate) loop
    candidate := base || floor(random() * 10000)::int::text;
  end loop;
  display := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, 'New user'), '@', 1));
  insert into public.profiles (id, handle, name) values (new.id, candidate, left(display, 50));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- Stacks
-- ─────────────────────────────────────────────────────────────
create table public.stacks (
  id              uuid primary key default gen_random_uuid(),
  author_id       uuid not null references public.profiles (id) on delete cascade,
  title           text not null default '' check (char_length(title) <= 120),
  -- [{ "label": text|null, "lines": [{ "text": text, "link": text|null }] }]
  sections        jsonb not null default '[]'::jsonb,
  style           text not null default 'numbered' check (style in ('numbered', 'bulleted')),
  status          text not null default 'draft' check (status in ('draft', 'published')),
  forked_from_id  uuid references public.stacks (id) on delete set null,
  line_count      int not null default 0,
  likes_count     int not null default 0,
  saves_count     int not null default 0,
  forks_count     int not null default 0,
  comments_count  int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  published_at    timestamptz,
  constraint published_is_complete check (
    status = 'draft'
    or (char_length(btrim(title)) > 0 and line_count > 0 and published_at is not null)
  )
);

create index stacks_published_idx on public.stacks (published_at desc) where status = 'published';
create index stacks_author_idx on public.stacks (author_id, status);
create index stacks_forked_from_idx on public.stacks (forked_from_id);

-- Validates and normalizes `sections`, and returns the number of lines.
create or replace function public.normalize_sections(p jsonb, out sections jsonb, out line_count int)
language plpgsql
immutable
as $$
declare
  sec   jsonb;
  ln    jsonb;
  lbl   text;
  txt   text;
  lnk   text;
  lines jsonb;
begin
  sections := '[]'::jsonb;
  line_count := 0;
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'sections must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p) > 30 then
    raise exception 'a stack can have at most 30 subsections' using errcode = '22023';
  end if;
  for sec in select * from jsonb_array_elements(p) loop
    lbl := nullif(btrim(coalesce(sec ->> 'label', '')), '');
    if char_length(lbl) > 60 then
      raise exception 'subsection labels are limited to 60 characters' using errcode = '22023';
    end if;
    lines := '[]'::jsonb;
    for ln in select * from jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) loop
      txt := btrim(coalesce(ln ->> 'text', ''));
      lnk := nullif(btrim(coalesce(ln ->> 'link', '')), '');
      continue when txt = '';
      if char_length(txt) > 120 then
        raise exception 'lines are limited to 120 characters' using errcode = '22023';
      end if;
      if lnk is not null and (lnk !~* '^https?://[^\s]+$' or char_length(lnk) > 2048) then
        raise exception 'links must be http(s) URLs' using errcode = '22023';
      end if;
      lines := lines || jsonb_build_array(jsonb_build_object('text', txt, 'link', lnk));
      line_count := line_count + 1;
    end loop;
    continue when jsonb_array_length(lines) = 0;
    sections := sections || jsonb_build_array(jsonb_build_object('label', lbl, 'lines', lines));
  end loop;
  if line_count > 200 then
    raise exception 'a stack can have at most 200 lines' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.stacks_before_write()
returns trigger
language plpgsql
as $$
declare
  n record;
begin
  select * into n from public.normalize_sections(new.sections);
  new.sections := n.sections;
  new.line_count := n.line_count;
  new.title := btrim(new.title);
  new.updated_at := now();
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

create trigger stacks_before_write
  before insert or update of title, sections, status on public.stacks
  for each row execute function public.stacks_before_write();

-- Private search tags.
create table public.stack_tags (
  stack_id  uuid not null references public.stacks (id) on delete cascade,
  tag       text not null check (char_length(tag) between 1 and 40),
  primary key (stack_id, tag)
);
create unique index stack_tags_ci_idx on public.stack_tags (stack_id, lower(tag));
create index stack_tags_tag_idx on public.stack_tags (lower(tag));

-- ─────────────────────────────────────────────────────────────
-- Social: likes, saves, follows, reposts, comments
-- ─────────────────────────────────────────────────────────────
create table public.likes (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  stack_id   uuid not null references public.stacks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, stack_id)
);

create table public.saves (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  stack_id   uuid not null references public.stacks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, stack_id)
);
create index saves_user_idx on public.saves (user_id, created_at desc);

create table public.follows (
  follower_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index follows_followee_idx on public.follows (followee_id);

create table public.reposts (
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  stack_id   uuid not null references public.stacks (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, stack_id)
);

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  stack_id   uuid not null references public.stacks (id) on delete cascade,
  author_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);
create index comments_stack_idx on public.comments (stack_id, created_at);

-- ─────────────────────────────────────────────────────────────
-- Denormalized counters
-- ─────────────────────────────────────────────────────────────
create or replace function public.bump_stack_counter()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  col   text := tg_argv[0];
  delta int  := case when tg_op = 'INSERT' then 1 else -1 end;
  sid   uuid := case when tg_op = 'INSERT' then new.stack_id else old.stack_id end;
begin
  execute format('update public.stacks set %I = greatest(%I + $1, 0) where id = $2', col, col)
    using delta, sid;
  return null;
end;
$$;

create trigger likes_count after insert or delete on public.likes
  for each row execute function public.bump_stack_counter('likes_count');
create trigger saves_count after insert or delete on public.saves
  for each row execute function public.bump_stack_counter('saves_count');
create trigger comments_count after insert or delete on public.comments
  for each row execute function public.bump_stack_counter('comments_count');

-- A fork counts once it is published.
create or replace function public.bump_forks_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.forked_from_id is not null and new.status = 'published'
     and (tg_op = 'INSERT' or old.status is distinct from 'published') then
    update public.stacks set forks_count = forks_count + 1 where id = new.forked_from_id;
  end if;
  return null;
end;
$$;

create trigger stacks_forks_count
  after insert or update of status on public.stacks
  for each row execute function public.bump_forks_count();

-- ─────────────────────────────────────────────────────────────
-- Row level security
-- ─────────────────────────────────────────────────────────────
alter table public.profiles   enable row level security;
alter table public.stacks     enable row level security;
alter table public.stack_tags enable row level security;
alter table public.likes      enable row level security;
alter table public.saves      enable row level security;
alter table public.follows    enable row level security;
alter table public.reposts    enable row level security;
alter table public.comments   enable row level security;

create policy "profiles are public" on public.profiles for select using (true);
create policy "update own profile" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

create policy "published stacks are public; drafts are private" on public.stacks for select
  using (status = 'published' or author_id = auth.uid());
create policy "delete own stacks" on public.stacks for delete
  using (author_id = auth.uid());

create policy "authors read their tags" on public.stack_tags for select
  using (exists (select 1 from public.stacks s where s.id = stack_id and s.author_id = auth.uid()));

create policy "read own likes" on public.likes for select using (user_id = auth.uid());
create policy "like published stacks" on public.likes for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.stacks s where s.id = stack_id and s.status = 'published'));
create policy "unlike" on public.likes for delete using (user_id = auth.uid());

create policy "read own saves" on public.saves for select using (user_id = auth.uid());
create policy "save published stacks" on public.saves for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.stacks s where s.id = stack_id and s.status = 'published'));
create policy "unsave" on public.saves for delete using (user_id = auth.uid());

create policy "follows are public" on public.follows for select using (true);
create policy "follow" on public.follows for insert with check (follower_id = auth.uid());
create policy "unfollow" on public.follows for delete using (follower_id = auth.uid());

create policy "reposts are public" on public.reposts for select using (
  exists (select 1 from public.stacks s where s.id = stack_id and s.status = 'published'));
create policy "repost published stacks" on public.reposts for insert with check (
  user_id = auth.uid()
  and exists (select 1 from public.stacks s where s.id = stack_id and s.status = 'published'));
create policy "undo repost" on public.reposts for delete using (user_id = auth.uid());

create policy "comments on published stacks are public" on public.comments for select using (
  exists (select 1 from public.stacks s where s.id = stack_id and s.status = 'published'));
create policy "comment on published stacks" on public.comments for insert with check (
  author_id = auth.uid()
  and exists (select 1 from public.stacks s where s.id = stack_id and s.status = 'published'));
create policy "delete own comments" on public.comments for delete using (author_id = auth.uid());

-- Clients never write stacks, tags or counters directly: they go through
-- save_stack(), which validates ownership and keeps tags in sync.
revoke insert, update on public.stacks from anon, authenticated;
revoke insert, update, delete on public.stack_tags from anon, authenticated;
revoke update on public.profiles from anon, authenticated;
grant update (handle, name, bio) on public.profiles to authenticated;

-- ─────────────────────────────────────────────────────────────
-- RPCs
-- ─────────────────────────────────────────────────────────────

-- Create or update one of the caller's stacks. Only drafts can be edited;
-- publishing a draft keeps its id. Returns the stack id.
create or replace function public.save_stack(
  p_id          uuid,
  p_title       text,
  p_sections    jsonb,
  p_tags        text[],
  p_status      text,
  p_forked_from uuid default null,
  p_style       text default 'numbered'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  sid uuid;
  t   text;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'published') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_forked_from is not null and not exists (
    select 1 from stacks where id = p_forked_from and status = 'published'
  ) then
    p_forked_from := null;
  end if;

  if p_id is null then
    insert into stacks (author_id, title, sections, status, forked_from_id, style)
    values (uid, coalesce(p_title, ''), coalesce(p_sections, '[]'::jsonb), p_status, p_forked_from, coalesce(p_style, 'numbered'))
    returning id into sid;
  else
    update stacks
       set title = coalesce(p_title, ''),
           sections = coalesce(p_sections, '[]'::jsonb),
           status = p_status,
           style = coalesce(p_style, style),
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

-- Published stacks matching a query on title, author name/handle, or private tags.
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

-- For each category: up to two sample titles and a count of published stacks tagged with it.
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
                and exists (select 1 from stack_tags t where t.stack_id = s.id and lower(t.tag) = lower(c.name))
              order by s.likes_count desc
              limit 2) x
         ), '{}'),
         (select count(*)::int from stacks s
           where s.status = 'published'
             and exists (select 1 from stack_tags t where t.stack_id = s.id and lower(t.tag) = lower(c.name)))
    from unnest(cats) with ordinality as c(name, ord)
   order by c.ord;
$$;

-- The first of `cats` that each published stack is tagged with (used for colour dots).
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
   where s.id = any(ids) and s.status = 'published'
   order by s.id, c.ord;
$$;

-- What a fork starts from: the source's content and tags.
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
           'sections', s.sections,
           'style', s.style,
           'tags', coalesce((select jsonb_agg(t.tag order by t.tag) from stack_tags t where t.stack_id = s.id), '[]'::jsonb))
    from stacks s
   where s.id = p_id and s.status = 'published';
$$;

revoke execute on function public.save_stack(uuid, text, jsonb, text[], text, uuid, text) from public, anon;
grant execute on function public.save_stack(uuid, text, jsonb, text[], text, uuid, text) to authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.bump_stack_counter() from public, anon, authenticated;
revoke execute on function public.bump_forks_count() from public, anon, authenticated;
