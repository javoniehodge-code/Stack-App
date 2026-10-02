# Authentication User Flows

This document defines the expected behavior for Stack authentication flows: sign up, log in, and log out.

## Sign Up

### Entry Points
- User clicks **Create Stack** while logged out.
- User clicks **Profile** while logged out.

### Main Flow
1. User is prompted to sign up or log in.
2. User chooses **Sign Up**.
3. User enters name, username, email, and password.
4. User submits account creation.
5. User verifies their email.
6. After verification:
   - If signup started from **Create Stack**, direct the user to Step 1 (Title) of the Create Stack flow.
   - If signup started from **Profile**, direct the user to their new profile page.

## Log In

### Entry Points
- User clicks **Create Stack** while logged out.
- User clicks **Profile** while logged out.

### Main Flow
1. User is prompted to sign up or log in.
2. User enters email and password.
3. User logs in successfully.
4. After login:
   - If login started from **Create Stack**, direct the user to Step 1 (Title) of the Create Stack flow.
   - If login started from **Profile**, direct the user to their profile page.

## Log Out

### Main Flow
1. User opens the dropdown menu from the share button on the top-right of their profile.
2. User selects **Logout**.
3. The user's authenticated session ends.
4. The user returns to a logged-out state.

### Known Issue
- Logout currently also appears under **Edit Profile**.
- Remove this duplicate logout option.

## Rules
- Only registered users can own a profile or create Stacks.
- Public profiles may be viewed without logging in.
- After authentication, return the user to the action that caused the login/signup prompt.
- A logged-out user cannot access authenticated-only pages directly.

## Failure Cases
- User loses internet access during signup.
- User loses internet access during login.
- Email is already associated with an account.
- Username is already taken.
- Password does not meet requirements.
- Email verification link is expired or invalid.
- User closes the verification page before completing verification.
- Login credentials are incorrect.
- Authentication succeeds but redirect fails.
- User tries to access Create Stack through a direct URL while logged out.
- User logs out in one tab while another authenticated tab is still open.

## Expected Results
- Successful signup creates exactly one user account.
- Successful login creates an authenticated session.
- The user's session persists after refreshing the page until they log out or the session expires.
- The user is redirected to the correct destination based on what they were doing before authentication.
- Successful logout invalidates the session.
- After logout, authenticated-only actions require login again.
- The user cannot access another user's private account data.
