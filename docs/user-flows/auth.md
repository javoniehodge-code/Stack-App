# Authentication user flows

[Functional spec — Flow 10](../stack-spec.md#flow-10-sign-in-sign-up-log-out) defines sign-in, sign-up and log-out for Party Mode.

## Sign in or create an account

- Signed-out visitors can browse and open eligible shared links. A protected action such as Create, Save, Like or Pin opens an action-specific sign-in prompt. The signed-out Profile tab also offers **Sign in / Create account**.
- The combined screen offers **Continue with Google** or **Continue with email**. Email sends a six-digit code that expires after 10 minutes. Returning users enter the existing account. New users choose a display name and unique handle after verification.
- Both methods resolve to the same account when they verify the same email. Passwords, username-and-password login and password reset are outside this flow.
- After sign-in, resume the original action exactly once. For Create, open step 1. For Profile, show the user's profile. For Pin, open the pin sheet on the original pick.
- **Not now**, closing the prompt or leaving the page drops the pending action. Wrong or expired codes and network failures appear inline. Cancelled Google sign-in returns to the sign-in screen. The spec proposes five attempts per code and a 30-second resend delay.

## Log out

**Log out** in Settings or the profile share sheet ends the session and returns to Home. Refreshing retains an active session. Signing back in restores server-backed drafts, pins and buckets. Authenticated actions require a valid session after logout, including in another open tab.

## Checks

- Verify Google and email sign-in for the same verified email reach one profile.
- One account per Gmail inbox: for gmail.com, dots, letter case and `+tag` suffixes don't make a different account. Typing any such alias sends the code to the account's saved address and signs in to that account. Other domains keep dots significant (`first.last@company.com` and `firstlast@company.com` are two people). The sign-in routes never reveal whether an account exists.
- **Task 1b acceptance check:** Google sign-in can't create a second account for the same Gmail inbox. Test it in the isolated test environment: with an email-code account saved as `first.last@gmail.com`, sign in with a Google account whose address is `firstlast@gmail.com` (or the reverse). Expect it to reach that same account, or to be refused with a message pointing to email sign-in. Never expect a new, empty account. Then check that `private.account_email_keys` still has exactly one account for the inbox. Passed in the isolated test environment on Nov 25; see [the Task 1b rollout](../google-sign-in-rollout.md).
- Verify a taken handle can be corrected without duplicating an account.
- Verify a signed-out direct link to an owner-only surface prompts for sign-in and that ownership is still checked after sign-in.
- Verify a cancelled or failed sign-in never writes the pending action.
