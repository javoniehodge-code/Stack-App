# Party Mode v1 · Task 0 audit

Nov 24, 2026. Branch `claude/party-mode-task-0-audit`, from `main` at `811d378`. No feature code was changed. The only database changes are the cleanup steps you approved (section 7). The schema, access rules and migration history were not touched.

## 1. Live database (Stack project `pgxobjxyqorsdzjdjbtz`)

### Before cleanup

These counts come from read-only queries run before the approved changes.

| Item | Count | Notes |
| --- | --- | --- |
| Accounts (`auth.users`) | 3 | All have a password and a confirmed email. Every sign-in identity is `email`; none use Google. The most recent sign-in was Oct 8. |
| Profiles | 2 | `@stack` (5 Stacks) and `@knicksin5` (1 Stack). |
| Account with no profile | 1 | Created May 16, before the profile trigger existed. |
| Stacks | 6 | 5 published and Public, 1 draft. No Unlisted or Private Stacks, no edit drafts, no remixes. |
| Engagement | 1 comment, 1 follow | No likes, saves or reposts. |
| Stack tags | 0 | |

Old-format content (54 lines in those 6 Stacks) had no pick ids, subheadings or tags:
- 1 Stack had 18 items.
- 5 lines were longer than 80 characters.
- 5 lines contained line breaks.
- 7 lines used `**bold**` marks.

### After the approved changes (current state)

| Item | Count | Notes |
| --- | --- | --- |
| Accounts | 2 | `@stackapp` (renamed from `@stack`) and `@knicksin5`. Both have a confirmed email and a password; the password stops being used once email-code sign-in ships. |
| Profiles | 2 | One for each account. |
| Stacks, comments, tags, likes, saves, reposts | 0 | All 6 Stacks were deleted for a fresh start. |
| Follows | 1 | Between the two remaining accounts. |
| Notifications | 4 | Left over from the deleted Stacks. Their Stack reference is now empty, which the app already shows as "no longer available". |
| Supabase migration history | none | The `supabase_migrations.schema_migrations` table doesn't exist, so no migration is recorded as applied. |

There is no old-format content, no draft and no shared Stack link left to preserve.

## 2. Sign-in (spec Flow 10, plan Tasks 1a and 1b)

**How it works now.** `web/src/components/AuthSheet.tsx` signs people in with email or username plus a password. A 6-digit code is used only to confirm the email at sign-up and to reset a password. `web/src/app/auth/sign-in/route.ts` looks up a username's email using the service (secret) key. `web/src/app/auth/confirm/route.ts` accepts email links. A database trigger, `handle_new_user` (`supabase/migrations/20260924000000_signup_handle.sql`), creates the profile at sign-up using a handle that must be 2–30 characters. There is no Google sign-in.

| Keep | Adapt | Replace or remove |
| --- | --- | --- |
| `lib/supabase/{client,server,env}.ts`, `proxy.ts` (session refresh), `getViewerId` | `AppProviders.requireAuth` and the `pending` action. The pending action is held in memory, which works for the email code (it stays on the page) but is lost after Google's redirect. Task 1b needs a saved pending action and a safe return path. | Password sign-in, sign-up, forgot and reset steps in `AuthSheet.tsx` |
| The sheet's layout, styles and **Not now** behavior | `auth/confirm/route.ts` becomes the shared callback for email links and Google, with the existing `next` path check | `auth/sign-in/route.ts` (username lookup with the service key). After this, the app needs no secret key. |
| | `handle_new_user`: stop assigning a generated handle silently. New users choose their name and handle in a profile-setup step. Handles become 3–30 characters, with the reserved list from the spec. | |

**Keeping existing accounts.** Both remaining accounts have confirmed emails, so signing in with an email code reaches the same account and data. Supabase links Google to an existing account with the same verified email. Nobody needs to be moved over, and password data can stay in the database unused.

**Supabase settings needed (not visible to me, set in the dashboard later).** The email template must send the 6-digit code (`{{ .Token }}`), the code must expire after 10 minutes (Supabase's default is 1 hour), and the Google provider needs its client ID and secret. Five wrong tries and the 30-second resend delay need checking against Supabase's built-in rate limits.

**Task 1a acceptance checks.** Both must pass in a test environment (a local or preview database with test accounts and a test inbox) before live sign-in is switched.

1. **An existing user keeps their account.** Create a test account the old way (email and password, with a profile). Sign in with an email code using the same address. Expect the same `auth.users` id, the same profile (handle, name, bio) and the same data. No second account or profile is created.
2. **A new user picks their identity before their profile is public.** Sign in with an email code using an address that has no account. Expect a profile-setup step that asks for a display name and a handle (3–30 characters, not taken, not reserved). Until setup is finished, a signed-out visitor and a second account can't find the profile by handle or through any listing or API, and no generated handle appears anywhere.

## 3. Create and drafts (Flow 1, Task 2)

**How it works now.** `/create` (`app/create/page.tsx`, `CreateScreen.tsx`) stores drafts as rows in `stacks` with `status = 'draft'`. Edits to a published Stack are draft rows with `edit_of` set. Writes go through the `save_stack` RPC, which runs as a privileged database function and checks `auth.uid()`. Autosave runs about 1.2 seconds after a change and queues saves so they don't overlap (`CreateScreen.tsx:431–505`).

Gaps compared with the spec:

- **Duplicate drafts.** The first save sends `p_id = null`. If the request succeeds but the reply is lost, a retry creates a second draft.
- **Over-limit drafts aren't saved.** Autosave stops when text is over a limit (`limitProblems` returns "over"). The spec says drafts may be incomplete or over limits and are checked only at publish.
- **Missing fields.** No step reached, no `/drafts/{id}` URL, no pick ids, subheadings, tags, theme or categories.
- **Old limits.** The database still enforces the old limits: title 60, description 300, 20 sections, 100 lines of up to 360 characters, and 6,000 characters in total.

**Keep:** the autosave timing and queue, owner checks in `save_stack`, and the editor shell's styling where it matches the design.
**Replace:** the line model (paragraph and bold lines, `**` marks inside a line) with picks that have stable ids, a heading, an optional subheading, an optional link and tags.

**Decision C (approved).** Add a separate owner-only `drafts` table that stores loose JSON content plus `step`, `edit_of`, `base_version` and a client-generated id, so retries can't create duplicates. The `stacks` table then holds only validated, published content, and over-limit drafts can still autosave.

## 4. Publish (Task 3)

**How it works now.** Publishing calls `save_stack` with `status = 'published'`, which turns the draft row into the Stack in place. `stacks_before_write` sets `published_at`, and `published_is_complete` requires a title and at least one line. There is no slug, theme, city requirement or category rule. A retry after a lost reply fails with "draft not found", so the Stack is published but the user sees an error. A publish with no draft id can create a duplicate.

**Plan.** Add a single `publish_draft(draft_id)` database function. In one transaction it checks every content rule, assigns the permanent slug (unique per author), creates the Stack with a stable pick id for every pick, deletes the draft, and records which Stack the draft became. A retry then returns the same Stack instead of failing or creating a duplicate. This needs new `stacks` columns (slug, theme emoji and colour, place and city, categories, version).

## 5. Shared links and access (Flow 3, Tasks 3 and 5)

**How it works now.** `/s/[id]` (`app/s/[id]/page.tsx`) loads the Stack through the user's own session, so database access rules (RLS) apply. A missing or Private Stack returns Next's generic 404 page. Unlisted Stacks get `noindex`. The link preview's description includes the first three pick names, which the spec forbids. There is no separate link-page layout for signed-out visitors.

**Access check (before cleanup, signed-out role, tested inside the database).** A signed-out visitor saw only the 5 published Public Stacks. The draft was hidden, and so were Private Stacks. Task 3 and Task 5 repeat this check with test Stacks.

**Unlisted problem (confirmed from the policy text).** The read policy on `stacks` is `status = 'published' AND visibility <> 'private' AND NOT is_blocked_with(author_id)`, or the reader is the owner. That means anyone, signed out, can ask the database API for `stacks?visibility=eq.unlisted` and get a list of every Unlisted Stack. Tags, comments and counts follow the same rule. The app's own listings (`search_stacks`, `explore_categories`, and the feed and profile queries) filter to Public correctly, but the raw API does not. No Unlisted Stack has ever existed, so nothing has leaked.

The fix belongs in Task 5:
- Limit the table's read policy to Public Stacks plus the owner's own.
- Open Unlisted Stacks only through a function that takes the exact `handle` and `slug` (or id).
- Move the policies on comments, likes and other related tables to the same "can this viewer open this Stack" check.

**New URLs.**

1. Every Stack published from now on gets its slug at first publish (Task 3). No existing Stacks need a slug.
2. Add a past-handles table so old usernames redirect and stay reserved to their owner.
3. The old routes have no shared links worth keeping, so no `/s/{id}` redirects are needed. When the new routes replace them, simple redirects (`/u/{handle}` → `/{handle}`, `/create` → `/new`, `/profile` → `/me`) are optional.
4. The reserved-username list must also include the app's current top-level routes while they exist: `s`, `u`, `create`, `profile`, `notifications`, `auth`.

## 6. Baseline checks

| Check | Result |
| --- | --- |
| `npm ci` | OK |
| `npm run lint` | Passes, 0 problems |
| `npm run build` (with the project's public URL and publishable key) | Passes. 14 routes, all server-rendered on demand. |
| `tsc --noEmit` after the build | Passes. Before a build it fails only because Next's generated `PageProps` types don't exist yet. |
| Automated tests | None exist in the repo |
| Supabase security scan | Expected warnings for intentionally public functions. 4 trigger or helper functions lack a fixed `search_path`. Leaked-password protection is off (this won't matter once passwords are gone). No missing-RLS errors. |

**Not verified.**
- I couldn't run the full Supabase stack locally: Docker isn't available in this environment. The schema comparison below used a plain Postgres instead.
- This environment can't reach Supabase's API directly, so the access checks were run inside the database instead.
- I didn't sign in end to end, because there are no test accounts or test inbox.
- I traced `CreateScreen.tsx` (1,948 lines) through its save and publish paths only, not line by line.
- I didn't open a Vercel preview, because the previews require a Vercel login.

### Live schema compared with the repo's migrations

**Method.** I built a clean database from the repo by applying all 19 files in `web/supabase/migrations/` in order. I used Postgres 16 locally, with minimal stand-ins for Supabase's `auth.users`, `auth.uid()`, the `anon`, `authenticated` and `service_role` roles, and Supabase's default grants. All 19 applied without errors.

I then fingerprinted every object in the `public` schema in both databases and compared them. On the live database (Postgres 17.6) this was read-only. Objects compared:
- table columns, types and defaults
- whether row-level security is on
- constraints and indexes
- full function definitions
- who can run each function (signed-out and signed-in)
- triggers, including `on_auth_user_created` on `auth.users`
- access policies
- table grants for signed-out and signed-in users

Neither database has views or custom types in `public`.

**Result.** 284 of the clean database's 288 objects match the live database exactly. The 4 that differ are all from one migration, `20260929000000_follow_notifications.sql` ("started following you" notifications), which was never applied to the live database:

| Object | In repo | In live |
| --- | --- | --- |
| Function `notify_on_follow()` | Yes | Missing |
| Trigger `follows_notify` on `follows` | Yes | Missing |
| Unique index `notifications_follow_uniq` | Yes | Missing |
| Who can run `notify_on_follow()` | Yes | Missing (follows from the function) |

The same migration also widens `notifications_type_check` to allow `'follow'`. The live database already allows it, because a later migration (`20260930000000_reposts.sql`) redefined that constraint with `'follow'` included. So today, following someone on the live app creates no notification.

Nothing exists in the live database that the repo doesn't create.

**Not covered.** The comparison doesn't cover:
- Supabase Auth settings (email templates, code length and expiry, providers)
- the `auth` and `storage` schemas beyond the one trigger
- the realtime publication
- column-level grants

Postgres 16 and 17 printed identical definitions for all 284 matching objects, so the version difference didn't affect the result.

**Revised migration recommendation.** Don't mark all 19 migrations as applied yet, because one of them isn't. Before recording any history:

1. Decide how to handle the missing follow-notifications migration. Either apply `20260929000000_follow_notifications.sql` to the live database (it is additive and safe to re-run), or skip it on purpose. Party Mode's Activity list (spec Flow 9) has no follow notification type, so skipping it is reasonable. The migration's backfill step only adds rows for follows from the last 30 days.
2. Then record the 19 migrations as applied, so Supabase's history matches the schema. Both steps change the live database and need your approval.
3. Add a schema-comparison check like this one to the release checks (plan Task 26), so the live database and the repo can't drift apart unnoticed again.

The live database and its migration history were left untouched during this review.

**Before building Task 1a or 2:** choose a safe test setup, such as a Supabase preview branch (a paid feature) or test accounts with made-up data in this project.

## 7. Decisions (answered Nov 24)

- **A. `@stack` handle:** renamed to `@stackapp` in the live database. `stack` stays reserved.
- **B. Account with no profile:** deleted. 2 accounts remain (`@stackapp`, `@knicksin5`).
- **C. Drafts:** use a new owner-only `drafts` table (section 3).
- **D. Sign-in:** as the spec says: email code + Google, no passwords. Sessions last about 90 days per device, so a code is only needed on a new device or after logging out. Password sign-in is removed in Task 1a.
- **E. Old content:** all 6 Stacks (and their comment) were deleted for a fresh start. No old-format conversion, draft migration, slug backfill or `/s/{id}` redirects are needed for existing data.
