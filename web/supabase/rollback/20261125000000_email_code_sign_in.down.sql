-- ROLLBACK for 20261125000000_email_code_sign_in.sql. Not a migration: run it by hand, only as part of the
-- rollback in docs/party-mode-task-1a-rollout.md, after the previous app deployment is live again.
--
-- It restores what the password-based app needs: the sign-up trigger that creates a profile, the old username
-- rule (2–30 characters) and password sign-up. It leaves create_profile(), handle_available() and
-- handle_is_reserved() in place (unused by the old app, harmless), so the forward migration can be re-applied.
-- No profiles or accounts are changed. Accounts created with a code while email-code sign-in was live have no
-- password; with the old app they can set one through "Forgot password?".

begin;

drop trigger if exists reject_old_signup on auth.users;
drop function if exists public.reject_old_signup();

alter table public.profiles drop constraint if exists profiles_handle_check;
alter table public.profiles add constraint profiles_handle_check check (handle ~ '^[a-z0-9._]{2,30}$');

-- Same as 20260924000000_signup_handle.sql.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted    text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'handle', '')));
  base      text;
  candidate text;
  display   text;
begin
  if wanted ~ '^[a-z0-9._]{2,30}$' and not exists (select 1 from public.profiles where handle = wanted) then
    candidate := wanted;
  else
    base := lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-zA-Z0-9._]', '', 'g'));
    if char_length(base) < 2 then base := 'user'; end if;
    base := left(base, 24);
    candidate := base;
    while exists (select 1 from public.profiles where handle = candidate) loop
      candidate := base || floor(random() * 10000)::int::text;
    end loop;
  end if;
  display := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, 'New user'), '@', 1));
  insert into public.profiles (id, handle, name) values (new.id, candidate, left(display, 50));
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

commit;
