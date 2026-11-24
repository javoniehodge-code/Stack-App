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

1. Apply every migration up to `20261011000000_link_only_lines.sql`.
2. Create the "existing user" the old way. Sign up through Auth with a password and `{name, handle}` metadata, then confirm with the code from Mailpit. The old trigger makes their profile.
3. Apply `20261125000000_email_code_sign_in.sql`, as an upgrade, and reload PostgREST's schema cache.
4. Run `supabase/tests/email_code_sign_in.test.sql`, then this script:

```bash
APP_URL=http://localhost:3000 API_URL=http://localhost:54321 MAILPIT_URL=http://127.0.0.1:8025 \
ANON_KEY=<local anon JWT> TEST_DB="host=/tmp port=55433 dbname=<test db> user=postgres" \
EXISTING_EMAIL=existing.user@stack.test LIKE_STACK_TITLE="Test Tacos" node web/e2e/sign-in.e2e.mjs
```

The app was built and started with `NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321` and the local anon key. A Public Stack titled "Test Tacos", owned by the existing user, gives the Like and Save checks something to act on.

The script checks:
- **Stale attempts (0a, 0b).** A slow code check, and a slow profile setup, finish after their sheet was closed and another was opened from a different action. Playwright holds back only the response, so the server does the work.
- **Existing user, Not now, new user, and setup closed midway** (1–4).
- **Keyboard** (6): Tab, Shift+Tab, Escape and focus return.
- **Desktop layout** (5).

Against the sheet code from before the stale-attempt fix, 0a fails three of its checks: the newer sheet closed, the browser was signed in, and a session stayed active. That shows the test catches the bug.

The rollback in `docs/party-mode-task-1a-rollout.md` was exercised on the same database: rollback script, then the old sign-up screen, then the migration re-applied and the database test rerun.
