-- Marks a disposable test database and records its fixtures, for web/e2e/sign-in.e2e.mjs. Run it only on a test
-- database (named stack_test_*), after the fixture account exists:
--   psql "host=/tmp port=55433 dbname=stack_test_x user=postgres" -v token=<random> -v email=existing.user@stack.test -f web/e2e/fixtures.sql
-- The runner refuses to write unless it finds this marker with the token it was given.

\set ON_ERROR_STOP 1
select current_database() ~ '^stack_test_[a-z0-9_]+$' as is_test_db \gset
\if :is_test_db
\else
  \echo 'refusing: this is not a stack_test_* database'
  \quit
\endif

create schema if not exists stack_test_env;
revoke all on schema stack_test_env from public;
create table if not exists stack_test_env.marker (
  token            text not null,
  fixture_email    text not null check (fixture_email ~ '@[^@]+\.test$'),
  fixture_stack_id uuid not null,
  created_at       timestamptz not null default now()
);

-- The fixture Stack: Public, owned by the fixture account.
insert into public.stacks (id, author_id, title, status, sections)
select 'cccccccc-0000-4000-8000-00000000000c', u.id, 'Test Tacos', 'published',
       '[{"label":null,"lines":[{"text":"El Test","link":null,"format":"num"}]}]'
  from auth.users u where u.email = :'email'
on conflict (id) do nothing;

delete from stack_test_env.marker;
insert into stack_test_env.marker (token, fixture_email, fixture_stack_id)
values (:'token', :'email', 'cccccccc-0000-4000-8000-00000000000c');
