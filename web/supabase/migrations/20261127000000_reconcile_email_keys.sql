-- Reconciles Gmail inbox keys, and lets the sign-in token be rotated without downtime.
--
-- * An earlier version of 20261126000000_gmail_alias_accounts installed its trigger after the backfill, without
--   holding off sign-ups, so an account created or re-addressed at that moment could be left without its inbox
--   key. That version is what live Supabase recorded. This migration repairs whatever that could have missed,
--   under the same lock: keys that no longer match their account's email are dropped, every account without a
--   key claims it (oldest first, unless another account already holds the inbox), and accounts that share an
--   inbox are listed in private.email_key_collisions for review. No email or account id is changed. Where keys
--   are already complete, it changes nothing.
-- * resolve_sign_in_email() accepts the current token or the next one ('sign_in_resolver_next'), so a new token
--   can be added before the old one is removed (docs/gmail-aliases-rollout.md, "Rotating the token").

-- One transaction, so the lock holds until the end and a failure leaves nothing half-applied (the Supabase CLI
-- doesn't wrap migration files in a transaction itself).
begin;

lock table auth.users in share row exclusive mode;

-- Keys that no longer match their account's email (changed before the trigger existed), or whose account has no
-- email any more: dropped here and claimed again below.
delete from private.account_email_keys k
 using auth.users u
 where u.id = k.user_id
   and (u.email is null or u.email = '' or k.email_key <> private.email_key(u.email));

-- Accounts without a key claim it, the oldest first. One whose inbox is already held stays without a key and is
-- listed below.
insert into private.account_email_keys (email_key, user_id)
select distinct on (private.email_key(u.email)) private.email_key(u.email), u.id
  from auth.users u
 where u.email is not null and u.email <> ''
   and not exists (select 1 from private.account_email_keys k where k.user_id = u.id)
 order by private.email_key(u.email), u.created_at, u.id
on conflict do nothing;

-- Accounts that share an inbox: kept as they are, listed for review.
insert into private.email_key_collisions (email_key, user_id, email)
select private.email_key(u.email), u.id, u.email
  from auth.users u
 where u.email is not null and u.email <> ''
   and private.email_key(u.email) in (
     select private.email_key(email) from auth.users where email is not null and email <> '' group by 1 having count(*) > 1)
on conflict do nothing;

-- Same as in 20261126000000, except that the next token is accepted too, for rotation.
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
     where name in ('sign_in_resolver', 'sign_in_resolver_next') and token_sha256 = sha256(convert_to(p_token, 'UTF8'))
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

commit;
