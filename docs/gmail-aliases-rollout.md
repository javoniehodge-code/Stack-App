# One Stack account per Gmail inbox: rollout

This covers migrations `20261126000000_gmail_alias_accounts` and `20261127000000_reconcile_email_keys`, and the server sign-in routes `/auth/email-code/send` and `/auth/email-code/verify`. Each step that changes live Supabase, Vercel or production needs an explicit go-ahead.

## What changes

- **Matching.** For gmail.com only, dots, letter case and `+tag` suffixes don't make a different account. `first.last@gmail.com`, `firstlast@gmail.com` and `FirstLast+stack@gmail.com` all reach the same account. Every other domain only ignores letter case.
- **Sign-in goes through Stack's server.** The sheet posts the typed address to `/auth/email-code/send`. The server asks the database (`resolve_sign_in_email`) which saved address owns that inbox, and has Supabase send the code there. Checking the code works the same way, through `/auth/email-code/verify`. Either way, the browser only gets "sent", "wrong code" or "try later". It never learns the saved address, or whether an account exists.
- **One account per inbox, enforced in the database.** A trigger on `auth.users` records each account's inbox key in `private.account_email_keys`, whose primary key refuses a second account for the same inbox. That holds for any way an account is created: email code now, Google sign-in in Task 1b, and two sign-ups at the same moment.
- **Installed in one step.** The migration runs as a single transaction. It locks the accounts table against new accounts and email changes, installs the trigger, then fills in keys for existing accounts. A sign-up already in progress finishes first and is filled in. One that starts during the migration waits a moment, then goes through the trigger. Reading accounts isn't blocked.
- **Existing accounts.** No email address or account id is changed. If two existing accounts already share an inbox, the older one keeps the key, both stay usable with their exact address, and both are listed in `private.email_key_collisions` for review.
  - On live, nothing shares an inbox: a read-only check on Nov 25 found 2 accounts and no shared inboxes.

## New server setting

`resolve_sign_in_email` only answers callers that present the server's sign-in token. Otherwise anyone could use it to find out whether an account exists.
- The token is a long random string.
- Vercel holds it as `SIGN_IN_RESOLVER_TOKEN`, a server-only variable without `NEXT_PUBLIC_`, so it never reaches the browser.
- The database stores only its SHA-256 hash, in `private.server_tokens`.

It can do one thing: tell Stack's server which saved address owns an inbox. That's far narrower than the old `SUPABASE_SECRET_KEY`.

## Live status, and the follow-up migration

An earlier version of `20261126000000` is already applied and recorded on live (21 history rows). That version filled in keys for existing accounts first and installed the trigger after, without holding off sign-ups. So an account created or re-addressed in that gap could have been left without a key. The file in the repo is now the safe version, but live keeps what it recorded. Migrations aren't run twice under the same version.

`20261127000000_reconcile_email_keys` repairs what the gap could have missed, under the same lock:
- It drops keys that no longer match their account's address.
- It gives every account without a key its key, oldest account first.
- It lists accounts that share an inbox in `private.email_key_collisions`, for review.
- It changes no email address and no account id.
- It also lets `resolve_sign_in_email` accept a second, "next" token, so the token can be rotated without downtime (below).

A read-only check of live on Nov 25 found 2 accounts, 2 correct keys, none missing and no shared inboxes. On live it will therefore change no keys and only add rotation support. It hasn't been applied to live yet.

It's applied as step 1 of "Live rollout" below.

## Live rollout: from today's state to production

Live today:
- `SIGN_IN_RESOLVER_TOKEN` is set in Vercel, and the earlier `20261126000000` is recorded (21 history rows).
- A token hash is stored.
- But that token's raw value was pasted into the Supabase SQL editor during setup. The editor can keep queries in its history and in saved snippets, and the database's logs can record statement text. So treat that token as exposed, and replace it before merging.

Production (`main`) doesn't use the token yet. Only the PR #34 preview does. So the whole replacement is done and checked on the preview, before merging. Each step that changes live Supabase or Vercel needs a go-ahead.

1. **Apply the follow-up migration** with the Supabase CLI `db push`, the same history-safe method as Task 1a:
   - do a dry run first; it must list only `20261127000000_reconcile_email_keys`;
   - push it;
   - check that the history shows 22 rows;
   - run `select * from private.email_key_collisions;` and expect no rows.

   After this, the database accepts a second, "next" token alongside the current one.
2. **Make a new token and its hash on your Mac**, exactly as in step 1 of "Steps for a fresh setup" below. Keep the Terminal window open until step 3 is done.
3. **Store the new hash as the "next" token.** In the SQL editor, put the printed hash in place of `NEW_HASH`:

   ```sql
   insert into private.server_tokens (name, token_sha256)
   values ('sign_in_resolver_next', decode('NEW_HASH', 'hex'))
   on conflict (name) do update set token_sha256 = excluded.token_sha256;
   ```

   Check it with `select name, encode(token_sha256, 'hex') from private.server_tokens;`. It must show two rows: `sign_in_resolver` (the old hash) and `sign_in_resolver_next` (the hash you just printed). Both tokens now work. Then run `unset TOKEN` and close the Terminal window.
4. **Vercel: give the new token to Preview and Production.**
   - Edit `SIGN_IN_RESOLVER_TOKEN` and paste the new token (it's still on the clipboard from step 2).
   - Set it for both Preview and Production. Production doesn't use it until the merge, but it then has the right value from its first deployment.
   - Afterwards, copy something else, so the token isn't left on the clipboard.
5. **Redeploy the PR #34 preview, fresh.** A variable change only reaches deployments made after it.
   - In Vercel, open the project, then Deployments.
   - Find the newest deployment for the branch `claude/gmail-alias-accounts`. Choose ⋯, then Redeploy.
   - Wait until it shows Ready. Use **that** deployment's URL from here on, and check that its creation time is later than step 4.
6. **Preview check, with both tokens stored.** On the new preview URL, in a private window:
   - sign in with your regular Gmail address. You reach your own profile;
   - sign out, then sign in with the same address plus `+test` before the `@` (for example `yourname+test@gmail.com`). The code arrives in the same inbox, there's no "create your account" step, and you reach the same profile;
   - if either fails, stop here. The old token is still stored, so nothing is broken for anyone else.
7. **Retire the old token.** In the SQL editor, run this as one statement:

   ```sql
   with next as (delete from private.server_tokens where name = 'sign_in_resolver_next' returning token_sha256)
   update private.server_tokens set token_sha256 = (select token_sha256 from next) where name = 'sign_in_resolver';
   ```

   Then check that `select name, encode(token_sha256, 'hex') from private.server_tokens;` shows one row, `sign_in_resolver`, holding the new hash from step 2. The old token is now refused.
8. **Preview check again**, on the same preview URL: repeat both sign-ins from step 6. Now they can only work through the new token. So this proves the preview runs with it, and nothing still depends on the old one.
9. **Clean up:** in the Supabase SQL editor, delete any saved snippet or history entry that contains the old raw token. It's useless once retired, but there's no reason to keep it.
10. **Merge PR #34.** Vercel deploys production with the new token.
11. **Production smoke test**, once the production deployment shows Ready, in a private window:
    - sign in with your regular Gmail address;
    - sign in with its `+test` version. It must reach the same profile, with no setup step;
    - sign in with your other account's address. It must reach that account's profile.

    If any of these fails, follow "Rollback" below.

## Rotating the token later (after the merge)

Do this whenever the token may have been seen anywhere other than Vercel. It's the same as steps 2–9 above, with production in place of the preview:
- in step 5, redeploy production (Deployments, the current production deployment, ⋯, Redeploy), plus the preview if you use one;
- in steps 6 and 8, check on the production site.

## Steps for a fresh setup

This is for a project that has never had this feature, such as a new Supabase project. Live is already past these steps: use "Live rollout" above instead.

1. **Make the token and its hash on your Mac.** In Terminal:

   ```bash
   TOKEN=$(openssl rand -hex 32)
   printf %s "$TOKEN" | pbcopy                        # copies the token, for Vercel (step 2)
   printf %s "$TOKEN" | shasum -a 256 | cut -d' ' -f1 # prints the hash, for Supabase (step 4)
   ```

   - The token itself is never shown on screen.
   - The printed hash is safe to handle: the token can't be worked out from it.
   - Keep the Terminal window open until step 4. Then run `unset TOKEN` and close it.
   - Never put the token into chat, the Supabase SQL editor, or a file in the repo.
2. **Vercel:** add `SIGN_IN_RESOLVER_TOKEN` for Production and Preview, as a Sensitive variable. Paste from the clipboard.
3. **Database: apply and record both migrations** with `db push`. The dry run must list only `20261126000000_gmail_alias_accounts` and `20261127000000_reconcile_email_keys`. Afterwards, the history must show 22 rows.
4. **Store the hash, not the token.** In the Supabase SQL editor, put the printed hash in place of `HASH`:

   ```sql
   insert into private.server_tokens (name, token_sha256)
   values ('sign_in_resolver', decode('HASH', 'hex'))
   on conflict (name) do update set token_sha256 = excluded.token_sha256;
   ```

   To check it, run `select name, encode(token_sha256, 'hex') from private.server_tokens;`. It must show the same hash.
5. **Review collisions:** run `select * from private.email_key_collisions;`. It's expected to be empty on live.
6. **Redeploy the preview and check it**, as in steps 5 and 6 of "Live rollout" above. Also check that sign-in with a brand-new outside address still works.
7. **Merge and deploy.** Then do the production smoke test (step 11 of "Live rollout").

**Until steps 2–4 are all done,** the new sign-in routes answer "unavailable". So don't merge before them.

## Rollback

Undo the newest migration first.

1. In Vercel, promote the previous production deployment.
2. If `20261127000000` is applied:
   - run `web/supabase/rollback/20261127000000_reconcile_email_keys.down.sql` by hand. It returns the resolver to accepting only the current token. It keeps the repaired keys, which are correct either way;
   - then run `supabase migration repair --status reverted 20261127000000`.
   - To keep only the Gmail matching, stop here. The history should show 21 rows.
3. To remove the Gmail matching altogether:
   - run `web/supabase/rollback/20261126000000_gmail_alias_accounts.down.sql` by hand. It removes the trigger, the key tables, the resolver and the `private` schema, and changes no accounts;
   - then run `supabase migration repair --status reverted 20261126000000`;
   - check that the history shows 20 rows.
4. Remove `SIGN_IN_RESOLVER_TOKEN` from Vercel.

## Known limit

Supabase Auth now sees Stack's server, rather than each person's browser, as the source of every code request. Supabase's per-IP limits on code requests and checks therefore apply to all users together.
- With today's handful of users this doesn't matter.
- The project-wide email limit (about 30 an hour, set during Task 1a) still applies too.
- Before real traffic, choose one:
  - forward each visitor's IP to Supabase, which needs a privileged key on the server; or
  - add Stack's own per-address and per-IP limits in the sign-in routes.

## Evidence (isolated test environment, Nov 25)

The test database was set up like live: Task 1a applied, 20 history rows. Before this migration, two accounts were created for one Gmail inbox (`dup.tester@gmail.com`, `duptester@gmail.com`).

- **Migration:**
  - The CLI dry run listed only this migration, and `db push` applied and recorded it (21 rows).
  - Account emails and ids were unchanged.
  - Both duplicate accounts were listed in `email_key_collisions`, and the older one kept the key.
- **Database tests** (`web/supabase/tests/gmail_alias_accounts.test.sql`, all pass):
  - Inbox keys: Gmail dots, case and `+tags` ignored; work addresses, `googlemail.com` and look-alike domains not.
  - A second account for the same inbox is refused, including one created by a Google provider (the Task 1b precondition).
  - Dotted work addresses stay separate.
  - Address resolution works only with the token.
  - An email change moves the key, and deleting an account frees it.
  - Neither signed-out nor signed-in users can read the private tables.
- **Concurrency** (`web/supabase/tests/gmail_alias_concurrency.sh`): two database sessions created accounts for one inbox at the same moment. The first committed; the second waited for it, then was refused. One account.

### Atomic install and the follow-up migration (Nov 25, second round)

- **Sign-ups during the migration** (`web/supabase/tests/gmail_alias_migration_race.sh`). The script builds a fresh database from the earlier migrations, then runs this timeline:
  - a sign-up (A) is still in progress when the migration starts;
  - the migration is held open for 3 seconds;
  - during it, three more writes start: another sign-up (B), a sign-up for an alias of A's inbox (C), and an email change to a Gmail address (D).

  **Result: 9/9 checks pass** for the current migration, both from scratch and when the key tables already exist (a retry after a partial run):
  - A and B have their keys;
  - C is refused;
  - D's key follows its new address;
  - no account lacks a key;
  - each inbox has one account.

  **The earlier version fails 4 of the 9** when the key tables already exist:
  - A has no key;
  - the alias sign-up is allowed;
  - one account lacks a key;
  - two accounts share an inbox.

  This is the gap `20261127000000` repairs.
- **Follow-up migration on a live-like copy** (Task 1a and the earlier `20261126000000` applied and recorded, 21 rows):
  - the CLI dry run listed only `20261127000000`;
  - `db push` applied and recorded it (22 rows).
  - The upgraded schema matched a clean build of all migrations, fingerprint for fingerprint.
- **Reconcile tests** (`web/supabase/tests/reconcile_email_keys.test.sql`, all pass). The test creates the damage the gap could leave, with the trigger paused:
  - two accounts share an inbox without keys;
  - one account has a stale key.

  After the migration:
  - the older account of the pair gets the key, and both are listed for review;
  - the stale key is replaced;
  - correct keys, emails and account ids are unchanged;
  - a second run changes nothing;
  - the current and the next token both work, and any other token is refused.
- **Local hash and rotation**, on a scratch database, following the steps above:
  - a hash computed outside the database (`printf %s | sha256sum`, which gives the same result as `shasum -a 256` on a Mac) and stored with `decode` let the token through;
  - during rotation, the old and the new token both worked;
  - after the retire statement, one row held the new hash, the new token worked and the old one was refused.
- **Re-run of everything** on the upgraded copy, all passing:
  - the Task 1a tests, the Gmail alias tests and the concurrency script;
  - the target-guard test;
  - the browser suite, 52/52.

### Test-target guard and the rotation runbook (Nov 25, third round)

- **The reconcile test refuses wrong targets before its first write.** It commits, so it now checks its target first, read-only. It runs only on a disposable `stack_test_*` database, reached through a local Unix socket, whose test marker holds the token it was given.
  - The check sits at the top of the test file, so it also applies when someone runs the file with plain psql.
  - It has to be in that file itself: psql carries on with a file after an error in a file it includes, even with `ON_ERROR_STOP` set. This was tried and confirmed.
  - The runner, `web/supabase/tests/run-db-test.mjs`, runs the same database checks first. It uses the guard shared with the browser suite, `web/e2e/test-target.mjs`, which the browser suite now uses too.
- **Proof** (`web/supabase/tests/reconcile-guard.test.mjs`, 17/17):
  - The runner refused 8 bad targets, with zero writes logged: a remote host, a forced network address, TCP to the real test database, a non-test database, a missing database, a database without the marker, a wrong token and no token.
  - Plain psql refused 6 bad targets, sending only the check's read-only statements: no token, a wrong token, a wrong token with `ON_ERROR_STOP` switched off by the caller, TCP with the right token, a database without the marker, and a non-test database.
  - The real target passed the runner's `--verify-only` without writing.
  - The Postgres server assigned no new transaction id during the whole run, so nothing wrote anywhere, and the marked database was unchanged.
  - **Control:** with the check removed from the file, the proof failed 7 checks, including the transaction-id check.
- **The rotation runbook, rehearsed** on the live-like copy, steps 2–8 of "Live rollout". The app server stood in for the preview, restarted as a new process the way a fresh deployment starts. Each time, its environment was checked for the intended token.
  - Step 3 stored a hash made outside the database as the "next" token. Both tokens were accepted.
  - Steps 4–5: a new app process, started after the change, holding the new token.
  - Step 6: the browser suite passed, 54/54. It now also checks signing in again with the regular address, and with the regular address plus `+test`: the code went to the saved address, with no setup, and reached the same account and profile.
  - Step 7: one row was left, holding the new hash. The old token was refused (401) and the new one accepted.
  - Step 8: the same process, same suite: 54/54.
  - **Control:** a server still holding the old token answered "unavailable" after step 7. That's why step 5 has to redeploy the preview.
  - One unplanned confirmation: in a first attempt, the restart silently failed and the old server kept running. Step 6 passed, since both tokens were still stored, and step 8 failed. That's the situation the step 8 recheck is there to catch.
- **Also run:** the browser-suite guard test (11/11), the Task 1a and Gmail alias database tests, the concurrency script, the reconcile test through the runner, lint and type checks.
- **Browser and API** (`web/e2e/sign-in.e2e.mjs`, 52/52 at the time; 54/54 since the regular-address and `+test` checks were added):
  - A Gmail account created as `g.<run>.tester@gmail.com`.
  - Signing in typed `g<run>tester@gmail.com`, and `G<run>Tester+stack@Gmail.com`: each time the code went to the saved address (none to the typed one), with no setup, the same account and the same profile.
  - A dotted work address stayed distinct: the undotted one got its own code and a new-account setup.
  - The send answer was identical for an existing account's alias and for an unknown address. The verify answer was identical for a wrong code on an existing alias and on an address with no account. No response contained the saved address.
  - Two simultaneous sign-ups for one new Gmail inbox made exactly one account (responses 200 and 429, never 5xx).
  - All earlier sign-in checks still pass through the new routes.
- **The token is server-only:** it appears in no browser bundle.
