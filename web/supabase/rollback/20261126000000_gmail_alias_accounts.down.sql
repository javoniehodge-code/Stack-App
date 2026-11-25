-- ROLLBACK for 20261126000000_gmail_alias_accounts.sql. Not a migration: run by hand, only as described in
-- docs/gmail-aliases-rollout.md, after the previous app deployment is live again (the newer app's sign-in routes
-- need resolve_sign_in_email()). Then mark the migration reverted:
--   supabase migration repair --db-url "$DB_URL" --status reverted 20261126000000
-- No account or email is changed. Accounts stay as they are; only the one-account-per-inbox rule goes away.

begin;
drop trigger if exists claim_email_key on auth.users;
drop function if exists private.claim_email_key();
drop function if exists public.resolve_sign_in_email(text, text);
drop table if exists private.account_email_keys;
drop table if exists private.email_key_collisions;
drop table if exists private.server_tokens;
drop function if exists private.email_key(text);
drop schema if exists private;
commit;
