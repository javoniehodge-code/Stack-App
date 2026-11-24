-- Email-code sign-in (Party Mode Task 1a).
--
-- * New accounts no longer get a profile automatically. After someone verifies their email code for the first
--   time, they choose a display name and a username; create_profile() makes the profile then. Until that
--   happens there is no profile row, so nobody can find the account by handle, in listings or through the API.
-- * Usernames: 3–30 characters of a–z, 0–9, dot and underscore, not starting or ending with a dot or underscore,
--   and not one of the names the app uses for its own pages (the spec's list plus today's top-level routes).
--   The rule is a table constraint, so it also applies when a profile's handle is edited. Existing handles
--   (stackapp, knicksin5) already meet it.
-- * Existing profiles and accounts are not changed.

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
    's', 'u', 'create', 'profile', 'notifications', 'auth'
  ]);
$$;

alter table public.profiles drop constraint if exists profiles_handle_check;
alter table public.profiles add constraint profiles_handle_check check (
  handle ~ '^[a-z0-9._]{3,30}$'
  and handle !~ '^[._]'
  and handle !~ '[._]$'
  and not public.handle_is_reserved(handle)
);

-- No more automatic profiles.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();

-- Whether a username can be chosen right now: valid, not reserved and not taken. For the live hint while typing;
-- create_profile() checks again.
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
     and not exists (select 1 from public.profiles where handle = p_handle);
$$;

revoke execute on function public.handle_available(text) from public, anon;
grant execute on function public.handle_available(text) to authenticated;

-- Creates the signed-in user's profile with the name and username they chose. Safe to retry: if this account
-- already has a profile, it is returned unchanged.
create or replace function public.create_profile(p_name text, p_handle text)
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid    uuid := auth.uid();
  nm     text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  h      text := lower(btrim(regexp_replace(coalesce(p_handle, ''), '^@', '')));
  result public.profiles;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select * into result from public.profiles where id = uid;
  if found then
    return result;
  end if;
  if char_length(nm) < 1 or char_length(nm) > 50 then
    raise exception 'name must be 1 to 50 characters' using errcode = '22023', hint = 'name';
  end if;
  if h !~ '^[a-z0-9._]{3,30}$' or h ~ '^[._]' or h ~ '[._]$' then
    raise exception 'invalid username' using errcode = '22023', hint = 'handle_invalid';
  end if;
  if public.handle_is_reserved(h) then
    raise exception 'reserved username' using errcode = '22023', hint = 'handle_reserved';
  end if;
  begin
    insert into public.profiles (id, handle, name) values (uid, h, nm) returning * into result;
  exception when unique_violation then
    -- Two requests for the same account at once: return the profile the other one made.
    select * into result from public.profiles where id = uid;
    if found then
      return result;
    end if;
    raise exception 'username taken' using errcode = '23505', hint = 'handle_taken';
  end;
  return result;
end;
$$;

revoke execute on function public.create_profile(text, text) from public, anon;
grant execute on function public.create_profile(text, text) to authenticated;
