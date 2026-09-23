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

Signed-out visitors can browse everything and start a stack. Liking, saving, following, commenting, saving a draft and publishing all open the sign-in sheet first. Sign-in uses a 6-digit code sent by email, entered in place, so the draft or the like you were making isn't lost.

## Running locally

Requires Node 20+ and Docker (for the local Supabase stack).

```bash
npm install
npx supabase start          # Postgres, Auth and the REST API; applies migrations and seed.sql
cp .env.example .env.local  # then paste the API URL and the publishable (or anon) key from `npx supabase status`
npm run dev                 # http://localhost:3000
```

Sign-in emails are caught locally by Mailpit at http://127.0.0.1:54324. The seed adds four demo creators and their stacks.

## Deploying

1. Create a Supabase project, then `npx supabase link` and `npx supabase db push` to apply `supabase/migrations`. Don't run `seed.sql` in production.
2. In **Authentication → Emails → Magic Link** (and **Confirm signup**), include `{{ .Token }}` so the email contains the 6-digit code the app asks for. `supabase/templates/magic_link.html` is a ready-made template.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` on your host (for example Vercel, with `web/` as the root directory).
4. Add your site URL under **Authentication → URL Configuration**.

## Data model

Everything is in `supabase/migrations/20260923000000_init.sql`:

- **profiles**: one per auth user, created by a trigger with a generated handle that the user can change.
- **stacks**: title, `sections` (JSON: labelled groups of `{ text, link }` lines), `numbered` or `bulleted` style, `draft` or `published`, and the stack it was forked from. A trigger validates and normalizes lines (at most 120 characters, http(s) links only) and keeps `line_count` up to date.
- **stack_tags**: private search tags. Row-level security lets only the author read them. Search (`search_stacks`) and Explore categories (`explore_categories`, `stack_categories`) run as security-definer functions, so tags affect results but are never exposed.
- **likes, saves, follows, reposts, comments**: with row-level security. Counts are kept on `stacks` by triggers. A fork counts toward the source's fork total once it is published.
- Clients can't write `stacks` directly. `save_stack()` creates and updates the caller's own drafts, publishes them, and replaces their tags in one transaction.

## Differences from the prototype

- The prototype ran on in-memory sample data. Here all data comes from Supabase, and the sample content is `supabase/seed.sql`.
- Sign-in is a real email-code flow in the same bottom sheet, not a toggle.
- **Add a comment** opens a comment box on the stack page. From the feed it opens the stack with the box ready.
- Forks count once they're published, not when the fork screen opens.
- Unsaving from Saved dims the row and lets you save it again, rather than removing it at once.
- Filtering Saved matches title, author name and handle. Tags are private, so they aren't matched.
- Recent searches are kept in the browser.
- Top and bottom padding use the device's safe areas instead of the prototype's fixed iOS status-bar spacing, and the app is a centered column on wide screens.
- There's no UI for reposting yet, matching the design. Reposts in the database show up on creator profiles.
