# Schema comparison: live database vs. repo migrations

This folder holds the scripts behind section 6 of the [Task 0 audit](../../party-mode-task-0-audit.md). Every query here is read-only. Only `build-clean.sh` creates anything, and it creates a throwaway local database.

| File | What it does |
| --- | --- |
| `stubs.sql` | Minimal stand-ins for the Supabase pieces the migrations use: the `anon`, `authenticated` and `service_role` roles; `auth.users`; `auth.uid()`; and Supabase's default grants on `public`. Never run it against the live database. |
| `build-clean.sh` | Creates a fresh local database, applies `stubs.sql` and then all 19 files in `web/supabase/migrations/` in order. It stops on the first error and prints the fingerprints. |
| `fingerprint.sql` | One line per object in `public`: `<kind> <name>\|<md5 of its definition>`. |
| `summary.sql` | The object count and one hash over all fingerprints. |
| `definitions.sql` | The full definition of one object, for looking into a mismatch. |
| `clean-fingerprints.txt` | The output of `build-clean.sh` for the migrations on this branch (288 lines). |

**What is compared:**
- columns (type, nullability, default)
- whether row-level security is on
- constraints and indexes
- full function definitions
- whether signed-out (`anon`) and signed-in (`authenticated`) users can run each function
- triggers, including `on_auth_user_created` on `auth.users`
- access policies
- table grants for `anon` and `authenticated`

## Reproduce it

1. **Clean side** (any machine with Postgres 16 or later and `psql`):

   ```bash
   # from the repo root, with a local Postgres you can create databases in
   PGHOST=/tmp PGPORT=55432 PGUSER=postgres docs/party-mode-audit/schema-compare/build-clean.sh > /tmp/clean.txt
   diff /tmp/clean.txt docs/party-mode-audit/schema-compare/clean-fingerprints.txt   # no output = same as committed
   PGHOST=/tmp PGPORT=55432 PGUSER=postgres psql -At -d stack_clean -f docs/party-mode-audit/schema-compare/summary.sql
   ```

   The audit used a throwaway cluster:

   ```bash
   initdb -D <dir> -A trust
   pg_ctl -D <dir> -o '-p 55432 -k /tmp' start
   ```

2. **Live side** (read-only): paste `summary.sql` into the Supabase SQL editor for the Stack project. To see which objects differ, run `fingerprint.sql` there, save the rows to a file, sort it, and `diff` it against `clean-fingerprints.txt`.

## Results (redacted: object names and hashes only, no user data)

| Run | Objects | Hash over all fingerprints |
| --- | --- | --- |
| Clean build from the repo (Postgres 16, rerun for this write-up) | 288 | `90f3ffcde679d1b8ccc3ee26279425f7` |
| Live, Nov 24, **before** the follow-notifications fix (Postgres 17.6) | 284 | `99da419b2589e285e24ea4373d2dd774` |
| Clean build without the 4 follow-notification objects | 284 | `99da419b2589e285e24ea4373d2dd774` (same as live before the fix) |
| Live, Nov 24, **after** the fix, rerun for this write-up | 288 | `90f3ffcde679d1b8ccc3ee26279425f7` (same as the clean build) |

Before the fix, the live database had exactly the clean build's objects except these 4, all from `20260929000000_follow_notifications.sql`:
- `function notify_on_follow()`
- `function-exec notify_on_follow()`
- `index notifications_follow_uniq`
- `trigger follows.follows_notify`

Each run's hash covers every object's fingerprint, so equal hashes mean every object matches. On Nov 24 the live database had no `supabase_migrations.schema_migrations` table, so no migration was recorded as applied.

## What can't be reproduced

- **The "before" live run can't be repeated.** The live database has changed since, because the follow fix was applied. Its result is recorded above. The middle row shows the same state can be rebuilt from the repo by leaving out the 4 objects.
- **The live side needs access to the Stack database** (Supabase SQL editor, or Claude's Supabase tools). Anyone without that access can only run the clean side.
- **The stand-ins aren't real Supabase.** Things that exist only in a real Supabase project aren't compared:
  - Auth settings (email templates, code length and expiry, providers)
  - the rest of the `auth` and `storage` schemas
  - the realtime publication
  - column-level grants

  A Supabase preview branch or `supabase start` (which needs Docker, unavailable during the audit) would cover more of this.
- **Postgres versions differ** (16 locally, 17.6 live). All definitions matched across the two versions, but a future version could print a definition differently and show a false mismatch. If that happens, use `definitions.sql` to compare the text.
