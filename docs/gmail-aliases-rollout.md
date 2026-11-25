# One Stack account per Gmail inbox: rollout

This covers migration `20261126000000_gmail_alias_accounts` and the server sign-in routes `/auth/email-code/send` and `/auth/email-code/verify`. Each step that changes live Supabase, Vercel or production needs an explicit go-ahead.

## What changes

- **Matching.** For gmail.com only, dots, letter case and `+tag` suffixes don't make a different account. `first.last@gmail.com`, `firstlast@gmail.com` and `FirstLast+stack@gmail.com` all reach the same account. Every other domain only ignores letter case.
- **Sign-in goes through Stack's server.** The sheet posts the typed address to `/auth/email-code/send`. The server asks the database (`resolve_sign_in_email`) which saved address owns that inbox, and has Supabase send the code there. Checking the code works the same way, through `/auth/email-code/verify`. Either way, the browser only gets "sent", "wrong code" or "try later". It never learns the saved address, or whether an account exists.
- **One account per inbox, enforced in the database.** A trigger on `auth.users` records each account's inbox key in `private.account_email_keys`, whose primary key refuses a second account for the same inbox. That holds for any way an account is created: email code now, Google sign-in in Task 1b, and two sign-ups at the same moment.
- **Existing accounts.** No email address or account id is changed. If two existing accounts already share an inbox, the older one keeps the key, both stay usable with their exact address, and both are listed in `private.email_key_collisions` for review.
  - On live, nothing shares an inbox: a read-only check on Nov 25 found 2 accounts and no shared inboxes.

## New server setting

`resolve_sign_in_email` only answers callers that present the server's sign-in token. Otherwise anyone could use it to find out whether an account exists.
- The token is a long random string.
- Vercel holds it as `SIGN_IN_RESOLVER_TOKEN`, a server-only variable without `NEXT_PUBLIC_`, so it never reaches the browser.
- The database stores only its SHA-256 hash, in `private.server_tokens`.

It can do one thing: tell Stack's server which saved address owns an inbox. That's far narrower than the old `SUPABASE_SECRET_KEY`.

## Steps

1. **Generate the token**, for example with `openssl rand -hex 32`. It goes only into the two places below, never into chat.
2. **Vercel:** add `SIGN_IN_RESOLVER_TOKEN` for Production and Preview, as a Sensitive variable.
3. **Database: apply and record**, the same way as Task 1a. The dry run must list only `20261126000000_gmail_alias_accounts`. Then apply it and record it under that version, and confirm the migration history shows 21 rows.
4. **Store the token's hash.** In the Supabase SQL editor, paste the token in place of `TOKEN` (the editor runs the statement but doesn't store it):

   ```sql
   insert into private.server_tokens (name, token_sha256)
   values ('sign_in_resolver', sha256(convert_to('TOKEN', 'UTF8')))
   on conflict (name) do update set token_sha256 = excluded.token_sha256;
   ```
5. **Review collisions:** run `select * from private.email_key_collisions;`. It's expected to be empty on live.
6. **Preview check**, on the PR's Vercel preview:
   - sign in with your saved address;
   - sign in again with a dotless or `+tag` version of it. It must reach the same profile, and the code must arrive at the saved address;
   - sign-in with a brand-new outside address still works.
7. **Merge and deploy.** Repeat the step 6 checks on production.

**Until steps 2–4 are all done,** the new sign-in routes answer "unavailable". So don't merge before them.

## Rollback

1. In Vercel, promote the previous production deployment.
2. Run `web/supabase/rollback/20261126000000_gmail_alias_accounts.down.sql` by hand. It removes the trigger, the key tables, the resolver and the `private` schema, and changes no accounts.
3. Mark the migration reverted: `supabase migration repair --status reverted 20261126000000`. Then check that the history shows 20 rows.
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
- **Browser and API** (`web/e2e/sign-in.e2e.mjs`, 52/52):
  - A Gmail account created as `g.<run>.tester@gmail.com`.
  - Signing in typed `g<run>tester@gmail.com`, and `G<run>Tester+stack@Gmail.com`: each time the code went to the saved address (none to the typed one), with no setup, the same account and the same profile.
  - A dotted work address stayed distinct: the undotted one got its own code and a new-account setup.
  - The send answer was identical for an existing account's alias and for an unknown address. The verify answer was identical for a wrong code on an existing alias and on an address with no account. No response contained the saved address.
  - Two simultaneous sign-ups for one new Gmail inbox made exactly one account (responses 200 and 429, never 5xx).
  - All earlier sign-in checks still pass through the new routes.
- **The token is server-only:** it appears in no browser bundle.
