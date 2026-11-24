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
- Verify a taken handle can be corrected without duplicating an account.
- Verify a signed-out direct link to an owner-only surface prompts for sign-in and that ownership is still checked after sign-in.
- Verify a cancelled or failed sign-in never writes the pending action.
