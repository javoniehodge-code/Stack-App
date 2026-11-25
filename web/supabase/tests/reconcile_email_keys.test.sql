-- Regression tests for 20261127000000_reconcile_email_keys.sql. Run only on a disposable test database that has
-- 20261126000000 applied (never on live). Builds the damage an unguarded install could leave, applies the
-- migration twice, and checks the result. The migration commits its own transaction, so this test can't simply roll
-- back: it removes its own test accounts at the start and end, and restores the stored tokens afterwards.
-- It refuses to run (before its first write) unless the target is a marked, disposable local test database:
--   TEST_DB="host=/tmp port=55433 dbname=stack_test_x user=postgres" TEST_ENV_TOKEN=<marker token> \
--     node web/supabase/tests/run-db-test.mjs web/supabase/tests/reconcile_email_keys.test.sql
-- or, equivalently, psql "<same TEST_DB>" -v test_env_token=<marker token> -f web/supabase/tests/reconcile_email_keys.test.sql

-- Target check: stops psql (exit code 3) before any write unless it is connected, through a local Unix socket, to
-- a disposable stack_test_* database whose test marker (stack_test_env.marker, from web/e2e/fixtures.sql) holds the
-- token passed as -v test_env_token. It runs read-only and mirrors the shared runner guard, web/e2e/test-target.mjs.
-- It must stay in this file, not an included one: psql carries on with the including file after an error in an
-- included file, even with ON_ERROR_STOP set.
\set ON_ERROR_STOP 1
\if :{?test_env_token}
\else
  \set test_env_token ''
\endif

begin transaction read only;

select current_database() ~ '^stack_test_[a-z0-9_]+$' as test_target_named,
       inet_server_addr() is null                      as test_target_local,
       to_regclass('stack_test_env.marker') is not null as test_target_marked
\gset

\if :test_target_named
\else
  do $$ begin raise exception 'refusing to run: this is not a disposable stack_test_* database'; end $$;
\endif
\if :test_target_local
\else
  do $$ begin raise exception 'refusing to run: connect through a local Unix socket (host=/...)'; end $$;
\endif
\if :test_target_marked
\else
  do $$ begin raise exception 'refusing to run: this database has no test marker (web/e2e/fixtures.sql)'; end $$;
\endif

select count(*) = 1 and bool_and(token = :'test_env_token') and :'test_env_token' <> '' as test_target_token_ok
  from stack_test_env.marker
\gset
\if :test_target_token_ok
\else
  do $$ begin raise exception 'refusing to run: pass -v test_env_token=<the token in this database''s test marker>'; end $$;
\endif

commit;

-- Leftovers from an earlier, interrupted run of this test.
delete from private.email_key_collisions where user_id in ('e1e1e1e1-0000-4000-8000-0000000000e1', 'e2e2e2e2-0000-4000-8000-0000000000e2', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'e4e4e4e4-0000-4000-8000-0000000000e4');
delete from auth.users where id in ('e1e1e1e1-0000-4000-8000-0000000000e1', 'e2e2e2e2-0000-4000-8000-0000000000e2', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'e4e4e4e4-0000-4000-8000-0000000000e4');
create temp table saved_tokens as select * from private.server_tokens;

-- Damage, created with the trigger paused (as if written in the gap before it existed):
--   r1 and r2 share one Gmail inbox and have no keys (r1 is older); s has a key for an address it no longer has;
--   ok is a normal account with its key.
alter table auth.users disable trigger claim_email_key;
insert into auth.users (id, email, created_at) values
  ('e1e1e1e1-0000-4000-8000-0000000000e1', 'recon.one@gmail.com',       now() - interval '2 days'),
  ('e2e2e2e2-0000-4000-8000-0000000000e2', 'reconone+x@gmail.com',      now() - interval '1 day'),
  ('e3e3e3e3-0000-4000-8000-0000000000e3', 'stale.now@company.test',    now()),
  ('e4e4e4e4-0000-4000-8000-0000000000e4', 'recon.ok@company.test',     now());
insert into private.account_email_keys (email_key, user_id) values
  ('stale.before@company.test', 'e3e3e3e3-0000-4000-8000-0000000000e3'),
  ('recon.ok@company.test',     'e4e4e4e4-0000-4000-8000-0000000000e4');
alter table auth.users enable trigger claim_email_key;

create temp table before_accounts as select id, email from auth.users;
create temp table other_keys as select * from private.account_email_keys
  where user_id not in ('e1e1e1e1-0000-4000-8000-0000000000e1', 'e2e2e2e2-0000-4000-8000-0000000000e2', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'e4e4e4e4-0000-4000-8000-0000000000e4');

\ir ../migrations/20261127000000_reconcile_email_keys.sql

do $$ begin
  if (select email_key from private.account_email_keys where user_id = 'e1e1e1e1-0000-4000-8000-0000000000e1') is distinct from 'reconone@gmail.com' then
    raise exception 'FAIL 1: the older account of a shared inbox did not get its key';
  end if;
  if exists (select 1 from private.account_email_keys where user_id = 'e2e2e2e2-0000-4000-8000-0000000000e2') then
    raise exception 'FAIL 1: the newer account of a shared inbox got a key too';
  end if;
  if (select count(*) from private.email_key_collisions where user_id in ('e1e1e1e1-0000-4000-8000-0000000000e1', 'e2e2e2e2-0000-4000-8000-0000000000e2')) <> 2 then
    raise exception 'FAIL 2: the two accounts sharing an inbox were not both listed for review';
  end if;
  if (select email_key from private.account_email_keys where user_id = 'e3e3e3e3-0000-4000-8000-0000000000e3') is distinct from 'stale.now@company.test' then
    raise exception 'FAIL 3: a stale key was not replaced by the key for the current address';
  end if;
  if (select email_key from private.account_email_keys where user_id = 'e4e4e4e4-0000-4000-8000-0000000000e4') is distinct from 'recon.ok@company.test' then
    raise exception 'FAIL 4: a correct key changed';
  end if;
  if exists (select 1 from auth.users u join before_accounts b on b.id = u.id where u.email is distinct from b.email)
     or (select count(*) from auth.users) <> (select count(*) from before_accounts) then
    raise exception 'FAIL 5: an account or email changed';
  end if;
  if exists ((select * from other_keys) except (select * from private.account_email_keys)) then
    raise exception 'FAIL 5: another account''s key changed';
  end if;
end $$;

-- Running it again changes nothing.
create temp table keys_once as select * from private.account_email_keys;
create temp table collisions_once as select email_key, user_id, email from private.email_key_collisions;
\ir ../migrations/20261127000000_reconcile_email_keys.sql
do $$ begin
  if exists ((select * from private.account_email_keys) except (select * from keys_once))
     or exists ((select * from keys_once) except (select * from private.account_email_keys))
     or exists ((select email_key, user_id, email from private.email_key_collisions) except (select * from collisions_once)) then
    raise exception 'FAIL 6: a second run changed keys or collisions';
  end if;
end $$;

-- Rotation: the current and the next token both work while both are stored; anything else is refused.
insert into private.server_tokens (name, token_sha256) values
  ('sign_in_resolver',      sha256(convert_to('current-token', 'UTF8'))),
  ('sign_in_resolver_next', sha256(convert_to('next-token', 'UTF8')))
on conflict (name) do update set token_sha256 = excluded.token_sha256;
do $$ begin
  if public.resolve_sign_in_email('reconone+y@gmail.com', 'current-token') <> 'recon.one@gmail.com'
     or public.resolve_sign_in_email('reconone+y@gmail.com', 'next-token') <> 'recon.one@gmail.com' then
    raise exception 'FAIL 7: a stored token was refused';
  end if;
  begin
    perform public.resolve_sign_in_email('reconone@gmail.com', 'other-token');
    raise exception 'FAIL 7: an unknown token was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- Clean up: this test's accounts (their keys go with them), their collision rows, and the original tokens.
delete from private.email_key_collisions where user_id in ('e1e1e1e1-0000-4000-8000-0000000000e1', 'e2e2e2e2-0000-4000-8000-0000000000e2');
delete from auth.users where id in ('e1e1e1e1-0000-4000-8000-0000000000e1', 'e2e2e2e2-0000-4000-8000-0000000000e2', 'e3e3e3e3-0000-4000-8000-0000000000e3', 'e4e4e4e4-0000-4000-8000-0000000000e4');
delete from private.server_tokens;
insert into private.server_tokens select * from saved_tokens;

select 'all reconcile_email_keys checks passed' as result;
