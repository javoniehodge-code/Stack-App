# Sign-in test environment (Task 1a)

`sign-in.e2e.mjs` drives the real app in a browser against an isolated, local copy of Supabase, with Mailpit as the test inbox. It refuses to run unless every URL points at `localhost` or `127.0.0.1`. It never touches the live Supabase project.

## Pieces used for the Task 1a run (Nov 24, 2026)

| Piece | Version | Role |
| --- | --- | --- |
| Postgres | 16 (local, Unix socket) | Test database `stack_test`, with Supabase's roles (`anon`, `authenticated`, `service_role`, `authenticator`, `supabase_auth_admin`) and default grants |
| Supabase Auth | `supabase/gotrue` v2.198.0 | Email-code sign-in. It runs its own migrations into `auth`. |
| PostgREST | `postgrest/postgrest` v16.6 | Database API (`/rest/v1`) |
| Mailpit | `axllent/mailpit` v1.34.0 | SMTP test inbox. Codes are read through its API. |
| Gateway | small Node proxy | Routes `/auth/v1` and `/rest/v1`, answers CORS like Supabase's gateway, and serves `supabase/templates/` to Auth |

The binaries came from the official Docker Hub images, checked against their layer digests. Docker itself wasn't available.

Auth settings matched `supabase/config.toml`:
- 6-digit codes that expire after 600 seconds
- one code per address every 30 seconds
- sign-ups allowed, with email confirmation on
- the `sign-in-code.html` template for both the confirmation and magic-link emails

Keys were local test JWTs signed with a throwaway secret.

## Order used

1. Create a database named `stack_test_*` and apply every migration up to `20261011000000_link_only_lines.sql`.
2. Create the fixture account the old way. Sign up through Auth with a password and `{name, handle}` metadata, then confirm with the code from Mailpit. The old trigger makes their profile.
3. Apply `20261125000000_email_code_sign_in.sql`, as an upgrade, and reload PostgREST's schema cache. For the rollout check this was done with the Supabase CLI: `migration repair` for the 19 existing versions, then `db push`.
4. Mark the database as the disposable test target, and add the fixture Stack:

   ```bash
   psql "host=/tmp port=55433 dbname=stack_test_x user=postgres" -v token=<random> -v email=existing.user@stack.test -f web/e2e/fixtures.sql
   ```
5. Run `supabase/tests/email_code_sign_in.test.sql`, then the guard test and the browser test, with the same environment:

```bash
export APP_URL=http://localhost:3000 API_URL=http://localhost:54321 MAILPIT_URL=http://127.0.0.1:8025 \
  ANON_KEY=<local anon JWT> TEST_DB="host=/tmp port=55433 dbname=stack_test_x user=postgres" \
  TEST_ENV_TOKEN=<the token from step 4> EXISTING_EMAIL=existing.user@stack.test
node web/e2e/target-guard.test.mjs   # invalid targets are refused before any write
node web/e2e/sign-in.e2e.mjs         # the browser checks
```

The app was built and started with `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321` and the local anon key. It was started with `SIGN_IN_RESOLVER_TOKEN` set to a random test token, whose SHA-256 hash is stored in the test database's `private.server_tokens` (see `docs/gmail-aliases-rollout.md`, step 4).

## Safety: what the browser test may write

Before any write, `sign-in.e2e.mjs` checks the target with read-only queries, and refuses (exit 2) unless all of these hold:
- every URL is local;
- `TEST_DB` is a single local Unix socket to a `stack_test_*` database;
- that database carries the marker from `fixtures.sql`, with the same token as `TEST_ENV_TOKEN`;
- `EXISTING_EMAIL` is the marker's fixture account (an `@….test` address), and owns the fixture Stack;
- the API serves the fixture Stack;
- the app's home page shows it;
- `MAILPIT_URL` answers as Mailpit.

Reads run in read-only transactions. Writes throw if attempted before the target is verified. The only writes are:
- the fixture account's likes, saves and sessions on the fixture Stack, reset at the start and end;
- the accounts this run creates (`*.<run id>@stack.test`), deleted at the end, including after a crash.

`target-guard.test.mjs` runs the browser test against 9 invalid targets and checks each one:
- exits with code 2;
- logs no write statement;
- runs no browser check.

It also checks that the real target passes `--verify-only` without writing, and that the database's row counts and timestamps don't change.

## What the browser test covers

- **Stale code check (0a).** A slow code check finishes after its sheet was closed and another was opened from a different action. Playwright holds back only the response, so the server does the work.
- **Create account while committing (0b).** A slow Create account keeps the sheet open with its progress shown; Escape and the backdrop don't close it; the flow then completes.
- **Create account failure (0c).** A failed Create account keeps the sheet and the typed values, saves nothing, and a retry works.
- **Existing user, Not now, new user, and setup closed midway** (1–4).
- **Keyboard** (6): Tab, Shift+Tab, Escape and focus return.
- **Gmail aliases** (7): dotless and `+tag` aliases reach the saved account, and the code goes to the saved address. Dotted work addresses stay distinct. The sign-in routes answer the same with or without an account. Simultaneous sign-ups for one inbox create one account.
- **Desktop layout** (5).
