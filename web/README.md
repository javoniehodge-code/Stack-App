# Stack

Short lists of anything worth remembering: bars, books, gear and more. Each line is at most 120 characters, and lines can carry a link.

This is the production build of the `Stack App` design in `../project/Stack App.dc.html`. It's a Next.js 16 (App Router) app with Supabase for Postgres and sign-in.

## Screens

| Route | Screen |
| --- | --- |
| `/` | Feed: For You / Following, one stack per screen with its comments, vertical snap scroll, loads more as you go |
| `/explore` | Explore: search, topic chips, recent searches, Trending this week, Categories, Recently added. `?q=` shows results |
| `/s/[id]` | Stack: all lines with link chips, comments with a composer, like / save / fork / copy link |
| `/u/[handle]` | Creator profile: Stacks and Reposts tabs, Follow |
| `/profile` | Your profile: Stacks / Saved / Forked / Drafts, Edit profile, Sign out |
| `/create` | New stack. `?fork=<id>` remixes a stack, `?draft=<id>` edits a draft |

Signed-out visitors can browse everything and start a stack. Liking, saving, following, commenting, saving a draft and publishing all open the sign-in sheet first. It all happens in that sheet, so the draft or the like you were making isn't lost:

- **Sign in** with your email or username, plus your password.
- **Create an account** with a name, username, email and password. A 6-digit code is emailed once to confirm the address.
- **Forgot password** emails a 6-digit code, then you choose a new password.

## Running locally

Requires Node 20+ and Docker (for the local Supabase stack).

```bash
npm install
npx supabase start          # Postgres, Auth and the REST API; applies migrations and seed.sql
cp .env.example .env.local  # then paste the API URL and the publishable (or anon) key from `npx supabase status`
npm run dev                 # http://localhost:3000
```

Confirmation and password-reset emails are caught locally by Mailpit at http://127.0.0.1:54324. The seed adds four demo creators and their stacks.

## Deploying

1. Create a Supabase project, then `npx supabase link` and `npx supabase db push` to apply `supabase/migrations`. Don't run `seed.sql` in production.
2. In **Authentication → Sign In / Providers → Email**, keep **Confirm email** on. In **Authentication → Emails**, put `{{ .Token }}` in the **Confirm signup** and **Reset Password** templates so the emails contain the 6-digit codes the app asks for. `supabase/templates/confirmation.html` and `recovery.html` are ready-made templates.
3. Set these environment variables on your host (for example Vercel, with `web/` as the root directory):
   - `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: the project URL and publishable (or anon) key.
   - `SUPABASE_SECRET_KEY`: the **secret** (or service_role) key. It is only used on the server, to look up the email for a username at sign-in. Without it, email sign-in still works and username sign-in says it isn't set up.
4. Add your site URL under **Authentication → URL Configuration**.

## Data model

Everything is in `supabase/migrations/`:

- **profiles**: one per auth user, created by a trigger. It uses the username chosen at sign-up, or generates one from the email if that is missing or taken. Users can change it in Edit profile.
  Profiles also hold optional social links (`socials`), a pinned stack with a short caption (`pinned_stack_id`, `pin_note`), and one featured link button (`featured_link_label`, `featured_link_url`). A trigger cleans up the social links and only allows pinning your own published stacks.
- **stacks**: title, `sections` (JSON: labelled groups of `{ text, link }` lines), `numbered` or `bulleted` style, `draft` or `published`, and the stack it was forked from. A trigger validates and normalizes lines (at most 120 characters, http(s) links only) and keeps `line_count` up to date.
- **stack_tags**: private search tags. Row-level security lets only the author read them. Search (`search_stacks`) and Explore categories (`explore_categories`, `stack_categories`) run as security-definer functions, so tags affect results but are never exposed.
- **likes, saves, follows, reposts, comments**: with row-level security. Counts are kept on `stacks` by triggers. A fork counts toward the source's fork total once it is published.
- Clients can't write `stacks` directly. `save_stack()` creates and updates the caller's own drafts, publishes them, and replaces their tags in one transaction. `set_stack_order()` saves the order of the caller's stacks on their profile (`stacks.profile_position`).

## Differences from the prototype

- The prototype ran on in-memory sample data. Here all data comes from Supabase, and the sample content is `supabase/seed.sql`.
- Sign-in is real email/username and password sign-in in the same bottom sheet, not a toggle.
- **Add a comment** opens a comment box on the stack page. From the feed it opens the stack with the box ready.
- Forks count once they're published, not when the fork screen opens.
- Unsaving from Saved dims the row and lets you save it again, rather than removing it at once.
- Filtering Saved matches title, author name and handle. Tags are private, so they aren't matched.
- Recent searches are kept in the browser.
- Top and bottom padding use the device's safe areas instead of the prototype's fixed iOS status-bar spacing, and the app is a centered column on wide screens.
- There's no UI for reposting yet, matching the design. Reposts in the database show up on creator profiles.
