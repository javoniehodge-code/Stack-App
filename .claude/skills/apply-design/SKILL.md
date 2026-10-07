---
name: apply-design
description: Pull the latest Stack App design from Claude Design, diff it against the previous export in project/, and apply only the visual changes to the Next.js app in web/. Use when the user says they updated the design, asks to sync or apply design changes, or types /apply-design (optionally with a Claude Design project link).
---

# Apply design changes to the Stack app

The Claude Design project is the source of truth for how the app looks. `project/`
holds the last export we applied. `web/` is the live app (Next.js + Supabase).
This skill moves new *visual* changes from the design into `web/` without touching
how data, sign-in or Supabase work.

Default design project: `f8c6b0c0-7621-468f-aee5-0a1e47f26e8e`
(https://claude.ai/design/p/f8c6b0c0-7621-468f-aee5-0a1e47f26e8e). If the user passes
a different link, use the id from that link.

## 1. Start clean

- `git fetch origin main` and start the working branch from `origin/main`. Never stack
  new work on a branch whose pull request is already merged.

## 2. Get the new export

- Use the `DesignSync` tool: `list_files`, then `get_file` for every file it lists
  (`.dc.html`, `ios-frame.jsx`, `support.js`, anything under `uploads/`). Skip `.thumbnail`.
- Write each file to `project/<path>` byte for byte. Large results are saved to a
  tool-results file as JSON; read `content` from it (base64-decode when `isBase64` is
  true). Never retype file contents by hand.
- If `DesignSync` says design access is missing, stop and ask the user to run
  `/design-consent` (or use Claude Design's "Send to Claude Code Web"). Don't guess
  at the design.
- The design project has no chat transcripts, so `chats/` is not updated.

## 3. See exactly what changed

- `git status project` and `git diff project`. Files marked "concept · not in app"
  (desktop and library concepts, Style Options, the print file) are references only;
  don't build them unless the user asks.
- Look at any new images in `project/uploads/` with the Read tool.
- For long inline-style diffs, strip `style="…"` and `<svg>` bodies to see the
  structure, then read the style values for the parts you change.

## 4. Sort each change before writing code

- **Visual only** (sizes, colors, spacing, fonts, layout, icons, copy) → apply it.
- **Needs new data** (new profile fields, pinning, ordering, new tables or columns, new
  API calls) → **stop and ask the user** before building it. List each such feature
  and the database change it would need. The user's standing rule is not to change how
  data, sign-in or Supabase work without saying so.
- If the user approves a database change: add a new file in `web/supabase/migrations/`
  (never edit an old one), keep it additive so the current live app keeps working, and
  test it against a local Postgres before pushing. The migration is **not** applied by
  deploying; the user has to run `npx supabase db push` before the preview works. Say so
  in the pull request and in your reply.
- Code that reads new columns must still work before the migration runs (fall back to
  the old columns), especially anything on the sign-in path: `fetchProfile()` in
  `web/src/lib/queries.ts` shows the pattern. A missing migration must never lock
  people out.

## 5. Apply to web/

- Screens live in `web/src/app/**` (Feed, `s/[id]` detail, profile, `u/[handle]`,
  explore, create). Shared cards are in `web/src/components/StackCards.tsx` and
  `Cards.module.css`; color tokens are in `web/src/app/globals.css`.
- Map design colors to the existing CSS variables; add a variable only when no
  existing one matches.
- Scope changes to the screen the design changed. A shared class (e.g. `.card`) can be
  used by several screens; override under a screen-specific class instead of editing
  the shared one.
- `web/AGENTS.md` warns this Next.js version differs from older ones; check
  `web/node_modules/next/dist/docs/` before using unfamiliar APIs.

### Always keep (not in the prototype)

- Password sign-in (email/username + password)
- The comment box on stack pages
- Edit profile (sheet with name, handle, bio, sign out)
- Deleting your own stack lives in the visibility sheet ("Delete stack", tap again to confirm);
  there is no separate Delete button on the stack page
- Comment replies (Reply button, threaded one level) and @mentions with autocomplete, on the
  stack page and feed cards; both create notifications
- Blocking: Block in the profile share sheet (Block @handle? dialog) and Settings and
  privacy → Blocked accounts (with Unblock). Blocks are two-way and enforced by row-level
  security
- Sign out stays in the Edit profile sheet as well as Settings and the profile share sheet
- Comment replies and @mentions also work in the stack page's comments sheet
- Editing a published stack (docs/user-flows/edit-stack.md): Edit stack in the visibility sheet
  from Manage stacks and from your own stack page; Publish and Publish & Share Update (only after
  a real change, public stacks, once every 7 days); update notes show for 7 days; a shared update
  moves the stack to the top of your profile below the pinned one. Product rules live in `docs/`.

Add new app-only features to this list as they ship.

### Keep these app choices even if the design differs

- Typography follows the design's "Stack App Typography v3" (chosen by the user): on the stack
  page and feed cards, bold dark titles, sentence-case subsection titles with a short orange bar
  and a dark rule, gray item numbers (`--num`), and links as a blue pill with the domain
  (`--link`, `--link-bg`). This replaced the older rule that kept feed text gray.
- Stack size limits (set by the user from the "Create Flow Screen Typography" design; the
  database enforces them in `normalize_sections` and the stacks trigger, and
  `web/src/lib/format.ts` has the same numbers): title 60, description 180, section heading
  60, at most 20 sections and 100 lines, a paragraph, numbered or bulleted line 360, a bold
  line 60, and 6,000 characters of visible text in all (`**` bold marks don't count). A link
  name is 40. Comments and repost notes stay at 500 (not 140). Older lines may still have a
  separate detail (note, up to 300); it shows under the line and joins the text when edited.
- Lines have a format: numbered, bulleted, paragraph or bold line (`format` on each line; older
  lines without one follow the stack's numbered/bulleted style). Numbered, bulleted and
  paragraph lines are one text where selected words can be bold (saved between `**` marks;
  the per-line bold toggle is gone). A line's link can have a name shown on its pill
  (`linkName`), and so can web addresses typed into the text (`linkNames`). Edit buttons stay
  "Publish" / "Publish & Share Update" (as `docs/user-flows/edit-stack.md` says) even where the
  design says "Save".
- "Unlisted" is called "Invite Only" in the UI, but the description stays "Only people with
  the link" (there are no invites). The database value is still `unlisted`.
- Tags aren't shown or edited any more (replaced by the stack's location); existing tags stay
  in the database and still count for search.
- Links show as blue pills with the link's name, or its domain when it has none. The app doesn't
  fetch page titles or favicons (the user chose this).
- Forking is gone from the app: no fork buttons, counts, Forked tab or Forks notifications, even if a
  design still shows them. Old `forked_from_id` data stays in the database untouched.
- No profile photos yet: avatars stay as initials (the user skipped the photo upload the design
  added to Edit profile, since it needs a storage bucket and a new column).
- You can't repost your own stack, and the Following feed shows each stack once, at its
  latest activity (published or reposted by someone you follow).

## 6. Check, push, preview

- In `web/`: `npm ci`, `npm run lint`, then `npm run build` with placeholder
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` /
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` values. (`tsc` alone fails on Next's
  generated `PageProps` types; the build generates them.)
- Commit the export (`project/`) and the app changes (`web/`) as separate commits.
- Push with a normal push (no force). Open a pull request describing, per screen, what
  changed, what was left out and why.
- The Vercel bot comments on the pull request with a preview link; give it to the user
  once the deployment is Ready. **Don't merge until the user says so.**
