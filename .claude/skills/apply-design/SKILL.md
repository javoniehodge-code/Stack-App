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
- Deleting your own stack (Delete button + confirmation sheet on your stack's page)

Add new app-only features to this list as they ship.

### Keep these app choices even if the design differs

- Feed text stays the original gray: title and lines use `--text-2`/`--muted-66`,
  handle `--muted-56`, comments `--muted-56`/`--text-2`. Sizes can follow the design.

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
