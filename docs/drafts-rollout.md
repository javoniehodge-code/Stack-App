# Task 2a: drafts that never get lost, rollout

This covers migration `20261128000000_drafts` and the editor's switch to it (Task 0 audit, decision C). Each step that changes live Supabase or production needs a go-ahead.

## What changes

- **Drafts have their own private table, `drafts`.**
  - Only the owner can read or change a draft. Signed-out visitors and other people get nothing.
  - The `stacks` table now holds published Stacks only.
- **Autosave about a second after each change, from the first character.** The status reads "Saving…", then "Saved just now", or "Couldn't save" if it failed.
- **A draft can be incomplete or over a limit and still save.** Limits are checked when it's published.
  - The limit banner now says "Your draft is saved; fix this before publishing."
  - Today's editor still stops typing at some limits; the new editor in 2b won't.
- **A retried save can't make a second draft.**
  - The app makes the draft's id before its first save, and every save writes to that id.
  - If a reply is lost and the save is sent again, it updates the same draft.
- **A retried publish can't make a second Stack.** Publishing gives the Stack the draft's id. A publish that's sent again returns that Stack and removes the draft.
- **Each draft has its own address, `/drafts/<id>`.**
  - A new Stack starts at `/new`, and its address becomes `/drafts/<id>` after the first save.
  - A refresh reopens the draft at the step it reached.
  - After publishing, the address becomes the Stack's, `/s/<id>`.
  - Older `/create` and `/create?draft=<id>` links forward to the new addresses. Editing a published Stack stays at `/create?edit=<id>`.
- **Leaving the editor:**
  - **Empty:** no draft is kept (one saved earlier is removed).
  - **With content:** the draft is kept, and Profile › Drafts opens.
  - **A change not yet saved:** the browser asks before you leave the page.
- **Unsaved edits to a published Stack** are a draft too, one per Stack, and Publish removes them.
- **Existing drafts move over**, with their ids and contents. Live had none on Nov 26.

## Limits: still the old ones (on purpose)

2a changes where drafts are kept, not what's in them. The editor and the database still use the old limits:

| | Old (still in use) | New (spec, Content rules) |
| --- | --- | --- |
| Title | 60 | 60 |
| Description | 180 in the editor, 300 in the database | 160 |
| Sections | 20 | 5 |
| Section title | 60 | 40 |
| Items | 100 | 15 |
| Each item | one line, up to 360 | heading up to 80, subheading up to 100 |
| Tags per item | none | 3, up to 20 characters each |
| Total characters | 6,000 | none |

**Plan (agreed Nov 26):** 2b, the new pick editor, switches both sides together, so they never disagree about what's allowed:
- **The editor:** counters, explained over-limit text, nothing cut off while typing.
- **The database:** the published-Stack checks in `stacks_before_write`, and the new pick model with stable ids, heading, subheading, link and tags.

Task 3 (publish) then adds the full publish checks: the "Fix N things before publishing" list, the city for place Stacks, and categories.

## Steps (live)

1. **Apply and record the migration** with the Supabase CLI `db push`:
   - the dry run must list only `20261128000000_drafts`;
   - afterwards the history shows 23 rows;
   - `select count(*) from public.stacks where status = 'draft';` returns 0.
2. **Merge the PR.** Then, on the real site:
   - start a Stack, type a title and an item, and check the address becomes `/drafts/…` and the status says "Saved just now";
   - refresh: it comes back at the same step;
   - Exit: it's in Profile › Drafts.

The app and the database must change together: the new app saves to `drafts`, which exists only after step 1. So step 1 comes right before the merge.

## Rollback

1. In Vercel, promote the previous production deployment.
2. Run `web/supabase/rollback/20261128000000_drafts.down.sql` by hand.
   - It moves drafts back into `stacks`, restores the previous `apply_stack_edit` and removes `publish_draft`.
   - A draft over a stack limit can't go back. It stays in `drafts`, still private, and the notice says how many.
3. Run `supabase migration repair --status reverted 20261128000000`. The history then shows 22 rows.

## Evidence (isolated test environment, Nov 26)

- **Migration on a live-like copy:**
  - The test copy had Task 1a and the Gmail alias migrations applied, with 22 history rows.
  - A temporary account was given an old-style draft (sections, a link, a tag, Unlisted, a city) and an old-style unsaved edit of its published Stack.
  - The CLI dry run listed only this migration, and `db push` applied and recorded it (23 rows).
  - Both drafts moved with their ids and contents, the edit still pointing at its Stack. No drafts were left in `stacks`.
  - The schema matched a clean build of all migrations.
- **Database tests** (`web/supabase/tests/drafts.test.sql`, all pass):
  - saving the same id twice keeps one draft with the latest content;
  - an over-limit draft saves, but one over the size cap doesn't;
  - one unsaved edit per Stack, only for your own published Stacks, and its owner and target can't be changed;
  - `publish_draft` publishes under the draft's id, removes the draft, and returns the same Stack when called again;
  - an over-limit, untitled or edit draft isn't published, and is kept;
  - applying an edit removes its draft;
  - another person can't read, change, remove, overwrite through an upsert, make for someone else, or publish a draft;
  - signed out: no access at all;
  - at most 200 drafts per person, and saving one of them again still works at the limit.
- **Rollback:** on a scratch copy, a draft that fits went back to `stacks` with its tags, and an over-limit one stayed in `drafts`. With `drafts` empty, the table was removed. Re-applying the migration moved the draft back.
- **Browser** (`web/e2e/drafts.e2e.mjs`, 18/18):
  1. **New Stack:**
     - the first save made one draft, with the app's id, the step and the text typed;
     - the address became `/drafts/<id>`, and nothing was in `stacks`;
     - a refresh reopened it at Build with its title and item;
     - a save whose reply was lost showed "Couldn't save", and the next save still left exactly one draft, with the latest text.
  2. **Leaving and limits:**
     - an empty editor closed with no draft;
     - one with content kept its draft, shown in Profile › Drafts, and Delete there removed it;
     - an existing over-limit draft (18 long items, over the 6,000-character total) showed the banner with "Your draft is saved", and an edit to it saved with all 18 items kept.
  3. **Publish:**
     - the first Publish reached the server but its reply was lost;
     - Publish again showed the published screen;
     - exactly one Stack, with the draft's id; the draft was gone, and the address became `/s/<id>`.
  4. **Editing the published Stack:**
     - unsaved edits were kept in one draft for it, listed in Manage stacks as unsaved edits, and came back on reopening;
     - Publish updated the Stack and removed that draft.
- **Earlier suites still pass:**
  - the sign-in browser test, 79/79 (Create now opens `/new`);
  - the guard test, 11/11;
  - the return-address test, 40/40;
  - the Task 1a, Gmail alias and reconcile database tests;
  - type checks and lint.
