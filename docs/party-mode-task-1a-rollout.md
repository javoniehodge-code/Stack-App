# Task 1a rollout: switching production to email-code sign-in

This covers PR #33 (email-code sign-in). Each step that changes live Supabase or production needs an explicit go-ahead. Stop at the first failed check and use **Rollback** below.

## What changes, and why the order matters

- **App.** The sign-in sheet uses a 6-digit email code. The password, sign-up and reset screens are gone.
- **Database** (`web/supabase/migrations/20261125000000_email_code_sign_in.sql`). The trigger that made a profile at sign-up is removed. New accounts get a profile only through `create_profile()`, after choosing a name and username.
- **Old sign-up screen.** Without a guard, it could keep creating accounts after the trigger is removed. That includes the live app until the deploy, and any tab opened before it. Those accounts would have no profile, and the old app can't handle that.
  - The migration therefore also adds `reject_old_signup`. The database refuses any new account whose sign-up carries a chosen username (`handle` in user metadata). The old screen always sends one; the email-code flow never does.
  - So from the moment the migration runs, the old screen can't create accounts. Existing accounts can still sign in on the old app with their passwords until step 6.
  - Tested: refused after the migration (no account created), allowed again after the rollback, refused again after re-applying.

## Steps

1. **Before anything changes.** Note the current state, so a rollback can be checked against it:
   - number of accounts and profiles;
   - that both live accounts sign in.

   Confirm the PR's checks still pass.

2. **Email delivery (production sender).** Supabase's built-in email only delivers to members of the Supabase team, and only a few emails an hour. Real users would never get a code. Set up a custom SMTP sender in Supabase: Authentication → Emails → SMTP settings. Then raise the email rate limit to fit expected sign-ups.

3. **Auth settings** in the Supabase dashboard:
   - Email OTP expiry: **600 seconds**.
   - Minimum interval between emails: **30 seconds**.
   - Templates **Confirm signup** and **Magic Link**: subject "Your Stack sign-in code", body from `web/supabase/templates/sign-in-code.html`. It must show `{{ .Token }}`.

   The live app keeps working during this step: its sign-up confirmation email also uses a code.

4. **Database.**
   - Record the 19 existing migrations as applied in Supabase's migration history.
   - Apply `20261125000000_email_code_sign_in.sql`.
   - Then check that both live accounts still have their profiles, and that the old sign-up screen refuses a new account.

5. **Required: delivery to a non-team inbox, before production switches.** Use the Vercel preview of PR #33, which runs the new app against live Supabase. Use an email address that is **not** a member of the Supabase team or the Vercel team, for example a new personal mailbox.
   - The code email arrives in the inbox (not spam) within a minute, from the custom sender, with subject "Your Stack sign-in code".
   - The code signs in, "Make it yours" appears, and finishing it creates the profile.
   - Sign in on the preview with one existing live account. It reaches the same profile.
   - Afterwards, delete the test account: Authentication → Users.

   **If any of this fails, stop here.** Production is still on the old app, and existing users can still sign in with passwords. Fix delivery or roll back the database (Rollback, step 2).

6. **Switch production.** Merge PR #33 and let Vercel deploy. On production, confirm that both live accounts sign in with a code and land on their own profiles.

7. **After a few days with no problems:** erase the 2 saved passwords (decision G), then confirm that password sign-in through the API is refused. A rollback after this point means those accounts use "Forgot password?" on the old app.

## Rollback

Use this if step 5 or later fails.

1. **App.** In Vercel, promote the previous production deployment (Deployments → the last deployment before the merge → Promote / Instant Rollback). Skip this if production was never switched.
2. **Database.** Run `web/supabase/rollback/20261125000000_email_code_sign_in.down.sql` by hand in the SQL editor. It:
   - restores the sign-up trigger and the old 2–30 character username rule;
   - removes the old-sign-up guard;
   - leaves the new functions in place, so the migration can be re-applied later;
   - changes no accounts or profiles.
3. **Accounts made while email-code sign-in was live.**
   - Accounts with a profile work on the old app after "Forgot password?" sets a password.
   - Accounts that never finished setup have no profile, which the old app can't open. List them, then delete them or give them a profile:

     ```sql
     select u.id, u.email, u.created_at
       from auth.users u left join public.profiles p on p.id = u.id
      where p.id is null;
     ```
4. **Auth settings** from step 3 can stay. The old app's emails show a code too.
5. **Check:** the old app signs in with a password, and its sign-up creates an account with a profile.

## Evidence (isolated test environment, Nov 24)

The test environment is described in `web/e2e/README.md`. Live Supabase wasn't touched.

- **Upgrade.** An account made with the old password sign-up kept its id, profile and password after the migration.
- **Old sign-up screen after the migration:** refused, and no account was created. The old app's password sign-in for the existing account still worked, as expected until step 7.
- **Rollback script:** the old sign-up screen worked again and its trigger made a profile. Existing accounts and profiles were unchanged.
- **Re-applying the migration** after the rollback: the database checks passed, and the old sign-up screen was refused again.
