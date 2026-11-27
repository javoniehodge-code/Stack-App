-- Rollback for 20261203000000_readable_links.sql. Run by hand, then mark the migration reverted:
--   supabase migration repair --status reverted 20261203000000
-- Puts back handle_is_reserved and handle_available as in 20261125000000_email_code_sign_in, and removes the
-- username history (its trigger, current_handle and past_handles, with the old usernames it kept: they become free
-- to take again, and old links with them stop forwarding).

begin;

drop trigger if exists profiles_handle_history on public.profiles;
drop function if exists public.profiles_handle_history();
drop function if exists public.current_handle(text);

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

drop table if exists public.past_handles;

commit;

notify pgrst, 'reload schema';
