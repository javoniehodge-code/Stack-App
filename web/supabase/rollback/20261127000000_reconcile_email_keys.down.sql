-- ROLLBACK for 20261127000000_reconcile_email_keys.sql. Run by hand, then:
--   supabase migration repair --db-url "$DB_URL" --status reverted 20261127000000
-- Restores resolve_sign_in_email() to accept only the current token. The repaired inbox keys and the collision list
-- are kept: they describe the accounts correctly either way. Run this before rolling back 20261126000000.
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
