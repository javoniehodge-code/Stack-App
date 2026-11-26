# Test environment (sign-in, Tasks 1a and 1b; drafts, Task 2a)

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

### Google (Task 1b)

Supabase Auth has Google's addresses built in, so the test copy reaches a stand-in for Google instead (`fake-google.mjs`):
1. Make a throwaway test CA and a certificate signed by it for `accounts.google.com`, `oauth2.googleapis.com`, `www.googleapis.com` and `openidconnect.googleapis.com`.
2. Start the stand-in: `node web/e2e/fake-google.mjs 8899 leaf.pem leaf.key test-client.apps.googleusercontent.com`.
3. Start Auth with:
   - Google turned on: `GOTRUE_EXTERNAL_GOOGLE_ENABLED=true`, client id `test-client.apps.googleusercontent.com`, any secret, and redirect URI `http://localhost:54321/auth/v1/callback`;
   - `HTTPS_PROXY=http://127.0.0.1:8899` and `NO_PROXY=localhost,127.0.0.1`;
   - `SSL_CERT_FILE` set to the test CA;
   - `GOTRUE_SECURITY_MANUAL_LINKING_ENABLED=true`, for Connect Google.

   Auth then gets Google's settings, keys and tokens from the stand-in. The stand-in refuses every other host.

The browser test plays Google's consent screen: it answers Auth's `/authorize` step by sending the browser straight back to Auth's callback, with a code naming the Google address to sign in as.

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
node web/e2e/callback-redirect.test.mjs   # /auth/callback only returns to the app's own origin
node web/e2e/drafts.e2e.mjs          # drafts: autosave, own address, retries, leaving, publish once, edits
node web/e2e/picks.e2e.mjs           # the pick editor: subheadings, tags, counters, limits, Undo, older content (SHOTS=<dir> saves screenshots)
node web/e2e/legacy-draft.e2e.mjs old|new   # a draft from the previous app build is recovered by this one (run old, then new)
node --experimental-strip-types web/e2e/legacy-adopt.test.mjs   # old-draft recovery is safe to retry (no network or database)
```

The app was built and started with `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321` and the local anon key. It was started with `SIGN_IN_RESOLVER_TOKEN` set to a random test token, whose SHA-256 hash is stored in the test database's `private.server_tokens` (see `docs/gmail-aliases-rollout.md`, setup step 4).

The Gmail migrations have their own database checks, run against a local `stack_test_*` database:
- `supabase/tests/gmail_alias_accounts.test.sql`;
- `gmail_alias_concurrency.sh`: two sign-ups at once;
- `gmail_alias_migration_race.sh`: sign-ups and an email change while the migration runs. It builds its own scratch database.
- `reconcile_email_keys.test.sql`: this one commits, so it needs the marked test database and its token. Run it through the guarded runner:

  ```bash
  TEST_DB="host=/tmp port=55433 dbname=stack_test_x user=postgres" TEST_ENV_TOKEN=<the token from step 4> \
    node web/supabase/tests/run-db-test.mjs web/supabase/tests/reconcile_email_keys.test.sql
  node web/supabase/tests/reconcile-guard.test.mjs   # same environment; proves bad targets are refused before any write
  ```

  The runner uses the same database guard as the browser test (`e2e/test-target.mjs`). The test file also checks its target itself, so plain psql is refused too unless it's given `-v test_env_token=<token>` on that database.

## Safety: what the browser test may write

Before any write, `sign-in.e2e.mjs` checks the target with read-only queries (the database part lives in `test-target.mjs`, shared with `supabase/tests/run-db-test.mjs`), and refuses (exit 2) unless all of these hold:
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
- **Gmail aliases** (7): signing in again with the regular address, and with dotless, `+test` and `+tag` aliases, reaches the saved account, and the code goes to the saved address. Dotted work addresses stay distinct. The sign-in routes answer the same with or without an account. Simultaneous sign-ups for one inbox create one account.
- **Continue with Google** (8):
  - a new account picks a name, then its Like runs once;
  - the same address as an email-code account signs in to it, and Save and Create resume;
  - a Gmail variation of an existing account is refused, pointing to email (the Task 1b acceptance check);
  - backing out returns to the sheet, and leaving drops the saved action;
  - a typed comment comes back;
  - Connect Google in Settings links this inbox's Google account, refuses one that belongs to another account, and then signs straight in.
- **Desktop layout** (5).

`drafts.e2e.mjs` runs the same read-only target checks first. It writes only to accounts it creates (`drafts.<run>.*@stack.test`), and removes them, with their drafts and Stacks, at the end. It covers:
- the first save, the `/drafts/<id>` address, and a refresh;
- a lost reply on a save and on a publish (neither duplicates);
- an over-limit draft;
- leaving an empty or a filled editor, and deleting a draft;
- edits to a published Stack.

The database checks are `supabase/tests/drafts.test.sql`.
