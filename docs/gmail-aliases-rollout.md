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

**To apply it to live** (needs a go-ahead), use the same history-safe method as Task 1a: the Supabase CLI `db push`.
1. Do a dry run first. It must list only `20261127000000_reconcile_email_keys`.
2. Push it.
3. Confirm the history shows 22 rows.
4. Run `select * from private.email_key_collisions;` and expect no rows.

## Steps for a fresh setup

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
6. **Preview check**, on the PR's Vercel preview:
   - sign in with your saved address;
   - sign in again with a dotless or `+tag` version of it. It must reach the same profile, and the code must arrive at the saved address;
   - sign-in with a brand-new outside address still works.
7. **Merge and deploy.** Repeat the step 6 checks on production.

**Until steps 2–4 are all done,** the new sign-in routes answer "unavailable". So don't merge before them.

## Rotating the token

Rotate whenever the raw token may have been seen anywhere other than Vercel. **That's the case for live now:** during the first setup, the raw token was pasted into the Supabase SQL editor. The editor can keep queries in its history and in saved snippets, and the database's logs can record statement text. So treat that token as exposed.

1. **Apply `20261127000000` first** (see "Live status" above). Before it, the database only accepts the current token, so step 3 would briefly break sign-in.
2. **Make a new token and its hash on your Mac**, exactly as in step 1 of the setup above.
3. **Store the new hash as the "next" token.** In the SQL editor:

   ```sql
   insert into private.server_tokens (name, token_sha256)
   values ('sign_in_resolver_next', decode('NEW_HASH', 'hex'))
   on conflict (name) do update set token_sha256 = excluded.token_sha256;
   ```

   From now on both the old and the new token work.
4. **Vercel:** edit `SIGN_IN_RESOLVER_TOKEN` for Production and Preview, and paste the new token. Then redeploy production, because a variable change only takes effect in new deployments. Redeploy the preview too, if you use one.
5. **Check sign-in on production** with your saved address.
6. **Retire the old token.** In the SQL editor, run this as one statement:

   ```sql
   with next as (delete from private.server_tokens where name = 'sign_in_resolver_next' returning token_sha256)
   update private.server_tokens set token_sha256 = (select token_sha256 from next) where name = 'sign_in_resolver';
   ```

   Then check that `select name, encode(token_sha256, 'hex') from private.server_tokens;` shows one row, `sign_in_resolver`, holding the new hash.
7. **Check sign-in on production again.** The old token now gets "not allowed".
8. **Clean up after the first setup:** in the Supabase SQL editor, delete any saved snippet or history entry that contains the old raw token. It's harmless once rotated, but there's no reason to keep it.

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
- **Browser and API** (`web/e2e/sign-in.e2e.mjs`, 52/52):
  - A Gmail account created as `g.<run>.tester@gmail.com`.
  - Signing in typed `g<run>tester@gmail.com`, and `G<run>Tester+stack@Gmail.com`: each time the code went to the saved address (none to the typed one), with no setup, the same account and the same profile.
  - A dotted work address stayed distinct: the undotted one got its own code and a new-account setup.
  - The send answer was identical for an existing account's alias and for an unknown address. The verify answer was identical for a wrong code on an existing alias and on an address with no account. No response contained the saved address.
  - Two simultaneous sign-ups for one new Gmail inbox made exactly one account (responses 200 and 429, never 5xx).
  - All earlier sign-in checks still pass through the new routes.
- **The token is server-only:** it appears in no browser bundle.
