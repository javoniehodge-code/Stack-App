# Task 1b: Continue with Google, rollout

This covers the "Continue with Google" button in the sign-in sheet, the `/auth/callback` route, and finishing the action that asked for sign-in after the trip to Google. No database changes: the one-account-per-inbox rule from PR #34 already covers Google. Each step that changes Google Cloud, live Supabase, Vercel or production needs a go-ahead.

## What changes

- **One sheet, two choices.** "Continue with Google" sits above "Continue with email", as in the design.
- **Google leaves the page.** The browser goes to Google's sign-in screen and comes back to `/auth/callback`, which finishes the sign-in and returns to the page the person was on.
- **The action that asked for sign-in still happens, once.** Before leaving, the app saves what it needs in this tab only, for 15 minutes:
  - Like, Save and Follow are finished on return.
  - Create opens the editor.
  - Repost and Block open their sheets.
  - A comment typed while signed out comes back in the open comments, unposted.
- **New or returning:**
  - A new Google account picks a name and username first, then the action runs.
  - A returning account goes straight in.
- **One account per email:**
  - **Same address as an email-code account:** Supabase adds Google to that account. No new account is made.
  - **A Gmail variation of an existing account** (dots or a `+tag`, for example Google reports `firstlast@gmail.com` and the account is `first.last@gmail.com`): the database refuses a second account for the inbox. The sheet says "This Gmail inbox already has a Stack account. Continue with email to sign in to it."
- **Backing out on Google** returns to the sign-in sheet. Leaving and coming back any other way drops the saved action.

## Setup steps (live)

These steps need your accounts. Each will be walked through one at a time.

1. **Google Cloud: create the sign-in client.**
   - In the Google Cloud console, create a project for Stack.
   - Set up the consent screen (Google Auth Platform → Branding): app name "Stack" and a support email.
   - Set its audience to External.
   - Create an OAuth client of type **Web application**. Its authorized redirect URI is Supabase's: `https://pgxobjxyqorsdzjdjbtz.supabase.co/auth/v1/callback`.
   - Keep the client ID and client secret for step 2. The secret never goes into chat.
2. **Supabase: turn Google on.** Authentication → Sign In / Providers → Google: enable it, and paste the client ID and secret.
3. **Supabase: allow the return address.** Authentication → URL Configuration → Redirect URLs. Add:
   - `https://stack-app-livid.vercel.app/**`
   - `https://*-project-stack.vercel.app/**` (previews)

   They must end in `/**`. The app returns to `/auth/callback?next=…`, and Supabase compares the whole address, so an entry ending in `/auth/callback` doesn't match. A non-matching address makes Supabase fall back to the Site URL, and sign-in doesn't finish there.
4. **Preview check**, on this PR's preview:
   - Google with your own Gmail account reaches your existing profile. No setup screen, no second account.
   - A Like started before signing in is on afterwards.
5. **Google Cloud: publish the app** (Audience → Publish app). Until then, only test users added there can use Google sign-in.
6. **Merge, then a production check:** repeat step 4 on the real site.

## Rollback

- **Fastest:** turn Google off in Supabase (step 2). The button then shows an error, and email sign-in keeps working.
- **Full:** promote the previous production deployment in Vercel.
- **Google identities already added stay on their accounts.** They're harmless with Google off.

## Known limits

- **In-app browsers.** Google refuses to sign in inside other apps' built-in browsers, such as Instagram or TikTok. People who open a Stack link there can use email, or open the link in their browser.
- **Google's screen names Supabase.** It says "to continue to pgxobjxyqorsdzjdjbtz.supabase.co". Showing Stack's own domain there needs a Supabase custom domain, which is a paid add-on.
- **"Already has an account" relies on Supabase's wording.** The sheet shows that message when Supabase reports "Database error saving new user". That's what the one-inbox rule causes today. Any other failure shows "Couldn't sign in with Google. Try again, or continue with email."

## Evidence (isolated test environment, Nov 25)

**Setup:**
- The test copy of Supabase Auth ran with Google turned on.
- It was pointed at a stand-in for Google's servers (`web/e2e/fake-google.mjs`), trusted through a throwaway test certificate.
- The browser test played Google's consent screen.

**Supabase Auth on its own:**
- A new Google address got a new account.
- The exact address of an email-code account was linked to it: one account, with providers email and Google.
- An undotted variation of a dotted Gmail account was refused with "Database error saving new user", and the inbox kept one account.

**Browser (`web/e2e/sign-in.e2e.mjs`, 74/74 including the earlier 52):**
- **8a. New person:**
  - came back to the same page at "Make it yours", with their address shown as verified;
  - the Like waited for the profile, then ran exactly once;
  - one account, signed in with Google, and still liked after a reload.
- **8b. Returning account** (the same address as an email-code account):
  - signed straight in, and the Save ran once;
  - the same account, now with email and Google;
  - Create via Google opened the editor.
- **8c. Task 1b acceptance check.** With an email-code account saved as `g.<run>.tester@gmail.com`, Google reported `g<run>tester@gmail.com`:
  - refused, with the message pointing to email sign-in;
  - no new account, and one account still holds the inbox;
  - not signed in, and the Like didn't run;
  - continuing with email in the same sheet signed in to that account and finished the Like once.
- **8d. Backing out on Google:**
  - back to the sheet with the original message and no error;
  - no auth cookies and nothing liked;
  - Not now, then a reload: no sheet.
- **8e. Leaving for Google and coming back another way:** no sheet, the saved action gone, nothing liked.
- **8f. A comment typed while signed out:** back in the open comments after sign-in, and not posted.
- **The earlier checks still pass:**
  - email-code sign-in, Gmail aliases, the stale-sign-in and keyboard checks;
  - the browser-suite guard (11/11).
