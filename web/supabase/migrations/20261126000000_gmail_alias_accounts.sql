-- One Stack account per Gmail inbox.
--
-- Gmail delivers first.last@gmail.com, firstlast@gmail.com and firstlast+anything@gmail.com to the same inbox, but
-- Supabase Auth treats them as different addresses, so one person could end up with several accounts. This
-- migration:
--
-- * Defines an inbox key for every address: for gmail.com only, the part before "@" without dots and without a
--   "+tag" suffix, lowercased; every other address is just lowercased (so first.last@company.com and
--   firstlast@company.com stay different).
-- * Keeps one key per account in private.account_email_keys. A trigger on auth.users claims the key whenever an
--   account is created (or its email changes); a second account for the same inbox fails on the table's primary
--   key, including when two sign-ups race. This applies however the account is created: email code today, Google
--   sign-in later.
-- * Backfills keys for existing accounts without changing any email or account id, under a lock that holds off
--   sign-ups and email changes until the trigger and the backfill are both in place. If two existing accounts
--   already share an inbox, the older one keeps the key, both stay as they are, and both are listed in
--   private.email_key_collisions for review.
-- * Adds resolve_sign_in_email(), which Stack's server uses to send the code to the saved address of the account
--   that owns an inbox. Only callers holding the server's sign-in token may use it, so a browser can't use it to
--   find out whether an account exists. An exact address always resolves to itself.
--
-- Nothing here is readable through the Data API: the private schema isn't exposed and grants nothing.

-- One transaction, so the lock holds until the end and a failure leaves nothing half-applied (the Supabase CLI
-- doesn't wrap migration files in a transaction itself).
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- The inbox an address delivers to.
create or replace function private.email_key(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
           when split_part(e, '@', 2) = 'gmail.com'
             then replace(split_part(split_part(e, '@', 1), '+', 1), '.', '') || '@gmail.com'
           else e
         end
    from (select lower(btrim(coalesce(p_email, ''))) as e) as x;
$$;

create table if not exists private.account_email_keys (
  email_key text primary key,
  user_id   uuid not null unique references auth.users (id) on delete cascade
);

create table if not exists private.email_key_collisions (
  email_key text not null,
  user_id   uuid not null,
  email     text not null,
  found_at  timestamptz not null default now(),
  primary key (email_key, user_id)
);

-- Claims the inbox key for a new account, or moves it when an account's email changes.
create or replace function private.claim_email_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or new.email = '' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if private.email_key(old.email) is not distinct from private.email_key(new.email) then
      return new;
    end if;
    delete from private.account_email_keys where user_id = new.id;
  end if;
  insert into private.account_email_keys (email_key, user_id) values (private.email_key(new.email), new.id);
  return new;
exception when unique_violation then
  raise exception 'another account already uses this email inbox' using errcode = '23505';
end;
$$;

revoke execute on function private.claim_email_key() from public, anon, authenticated;

-- Install the trigger and backfill existing accounts as one step. The lock waits for sign-ups and email changes
-- already in progress to finish, then makes new ones (and sign-ins, which update the account row) wait until this
-- migration commits, a moment later; reading accounts isn't blocked. So every account either exists before the
-- backfill and is backfilled, or is written after the trigger exists and claims its key through it.
lock table auth.users in share row exclusive mode;

drop trigger if exists claim_email_key on auth.users;
create trigger claim_email_key
  after insert or update of email on auth.users
  for each row execute function private.claim_email_key();

-- Backfill: the oldest account for each inbox keeps the key.
insert into private.account_email_keys (email_key, user_id)
select distinct on (private.email_key(u.email)) private.email_key(u.email), u.id
  from auth.users u
 where u.email is not null and u.email <> ''
 order by private.email_key(u.email), u.created_at, u.id
on conflict do nothing;

-- Existing accounts that already share an inbox: kept as they are, listed for review.
insert into private.email_key_collisions (email_key, user_id, email)
select private.email_key(u.email), u.id, u.email
  from auth.users u
 where u.email is not null and u.email <> ''
   and private.email_key(u.email) in (
     select private.email_key(email) from auth.users where email is not null and email <> '' group by 1 having count(*) > 1)
on conflict do nothing;

-- Server-side secrets, stored as SHA-256 hashes. The sign-in token's hash is added during rollout (see
-- docs/gmail-aliases-rollout.md); until then resolve_sign_in_email() refuses every call.
create table if not exists private.server_tokens (
  name         text primary key,
  token_sha256 bytea not null
);

-- The address to send a sign-in code to: the address itself if an account has exactly it, otherwise the saved
-- address of the account that owns the same inbox, otherwise the address as typed (lowercased). For Stack's
-- server only.
create or replace function public.resolve_sign_in_email(p_email text, p_token text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  typed text := lower(btrim(coalesce(p_email, '')));
  saved text;
begin
  if p_token is null or not exists (
    select 1 from private.server_tokens
     where name = 'sign_in_resolver' and token_sha256 = sha256(convert_to(p_token, 'UTF8'))
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select u.email into saved from auth.users u where lower(u.email) = typed limit 1;
  if saved is null then
    select u.email into saved
      from private.account_email_keys k join auth.users u on u.id = k.user_id
     where k.email_key = private.email_key(typed);
  end if;
  return coalesce(saved, typed);
end;
$$;

revoke execute on function public.resolve_sign_in_email(text, text) from public;
grant execute on function public.resolve_sign_in_email(text, text) to anon, authenticated;

commit;
