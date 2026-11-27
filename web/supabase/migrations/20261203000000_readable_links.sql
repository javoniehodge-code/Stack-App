-- Readable links (agreed Nov 27): a Stack's address is /{username}/{slug} and a profile's is /{username}. Old
-- /s/{id} and /u/{username} addresses forward to them, and so do addresses with a username someone used to have.
--
-- * past_handles: every username a person has given up, kept for them for good (D-1), so their old links keep
--   working and nobody else can take it. Switching back to one of your own old usernames is allowed.
--     - A trigger on profiles records the old username when it changes, and refuses a username someone else used
--       to have ("that username isn't available", the same error as a reserved one).
--     - handle_available() (the live hint while typing) says no to those too.
--     - current_handle() turns an old username into the current one, for the forwarding. Anyone can ask, since
--       profiles are public.
-- * handle_is_reserved(): also the app's file names (favicon.ico and the like), which a username with a dot could
--   otherwise match. No existing username is affected.

begin;

-- Names the app uses for its own pages. Keep in sync with RESERVED_HANDLES in web/src/lib/handles.ts.
create or replace function public.handle_is_reserved(h text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select lower(h) = any (array[
    'explore', 'me', 'new', 'drafts', 'inbox', 'settings', 'help', 'terms', 'privacy', 'buckets', 'login',
    'signup', 'api', 'admin', 'about', 'support', 'stack',
    -- current top-level routes, while they exist
    's', 'u', 'create', 'profile', 'notifications', 'auth',
    -- the app's files at the top level (a username can contain a dot)
    'favicon.ico', 'robots.txt', 'sitemap.xml', 'manifest.json', 'manifest.webmanifest', 'icon.png', 'apple-icon.png'
  ]);
$$;

create table if not exists public.past_handles (
  handle     text primary key,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  retired_at timestamptz not null default now()
);
create index if not exists past_handles_user on public.past_handles (user_id);
alter table public.past_handles enable row level security;
revoke all on public.past_handles from public, anon, authenticated;

create or replace function public.profiles_handle_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.past_handles p where p.handle = new.handle and p.user_id <> new.id) then
    raise exception 'that username isn''t available' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and new.handle is distinct from old.handle then
    insert into public.past_handles (handle, user_id) values (old.handle, old.id) on conflict (handle) do nothing;
    -- Back to one of your own old usernames: it's current again.
    delete from public.past_handles where handle = new.handle and user_id = new.id;
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_handle_history() from public, anon, authenticated;

drop trigger if exists profiles_handle_history on public.profiles;
create trigger profiles_handle_history
  before insert or update of handle on public.profiles
  for each row execute function public.profiles_handle_history();

-- As in 20261125000000_email_code_sign_in, and not someone else's old username.
create or replace function public.handle_available(p_handle text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_handle ~ '^[a-z0-9._]{3,30}$'
     and p_handle !~ '^[._]'
     and p_handle !~ '[._]$'
     and not public.handle_is_reserved(p_handle)
     and not exists (select 1 from public.profiles where handle = p_handle)
     and not exists (select 1 from public.past_handles where handle = p_handle and user_id is distinct from auth.uid());
$$;
revoke execute on function public.handle_available(text) from public, anon;
grant execute on function public.handle_available(text) to authenticated;

-- An old username's current one (null if it was never anyone's), for forwarding old links.
create or replace function public.current_handle(p_handle text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select pr.handle from public.past_handles p join public.profiles pr on pr.id = p.user_id where p.handle = lower(p_handle);
$$;
revoke execute on function public.current_handle(text) from public;
grant execute on function public.current_handle(text) to anon, authenticated;

commit;

notify pgrst, 'reload schema';
