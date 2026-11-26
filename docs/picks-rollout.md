# Task 2b: the pick editor and new limits, rollout

This covers migration `20261129000000_pick_model` and the new pick editor. The editor and the database switch to the spec's content limits together (agreed Nov 26). Each step that changes live Supabase or production needs a go-ahead.

## What changes

- **Picks, not lines.** Each pick is numbered or bulleted and has:
  - a heading (up to 80 characters, required);
  - an optional subheading (up to 100);
  - an optional link (it shows the link's domain, or the name you type);
  - up to 3 tags.
- **No paragraphs or bold lines.** The toolbar is Section, Numbered, Bulleted, Link, Tags. The heading shows in bold.
- **Tags tray.**
  - It shows the 5 suggested groups: Highlight, Price, Good for, Know before, When.
  - "Your own" takes a typed tag of up to 20 characters.
  - A pick can have one price: choosing another swaps it in.
  - At 3 tags the rest dim, and the tray says "This item has 3 tags. Remove one to add another."
- **New limits, in the editor and the database:**

  | | Before | Now |
  | --- | --- | --- |
  | Title | 60 | 60 |
  | Description | 180 in the editor, 300 in the database | 160 |
  | Sections | 20 | 5 |
  | Section title | 60 | 40 |
  | Items | 100 | 15 |
  | Each item | one line, up to 360 | heading up to 80, subheading up to 100 |
  | Tags per item | none | 3, up to 20 characters each |
  | Total characters | 6,000 | none |

- **Counters, nothing cut off.**
  - A counter appears at 80% of a field's limit.
  - Past the limit it turns red and says how far over, for example "heading 92/80 · 12 over".
  - Text is never cut off or blocked while typing. A box above the picks lists what to fix before publishing.
- **Add controls at a limit.**
  - At 15 picks, Add item reads "15 of 15 items · remove one to add another" and adds nothing.
  - At 5 sections, Section says "A Stack can have up to 5 sections."
- **Line breaks become spaces** in every field, typed or pasted.
- **Delete has a 5-second Undo.** Undo puts back only the deleted pick, or the removed section title, and keeps anything changed since. Reorder works as before.
- **Every pick has a stable id.** It survives saves, reorders, Undo, publishing and later edits, so pins and sends can point at it later.
- **The save status shows on every page**, from the Title page on.
- **The published Stack page** shows each pick's subheading and tag chips.
- **Picks come back exactly as saved.** A heading that names a website ("Ramen at fuunji.jp") stays as typed, through save and refresh.
- **Older content converts when it's opened in the editor.** This applies only to lines saved before picks:
  - paragraphs and bold lines become bulleted picks;
  - ** marks and line breaks go;
  - an older line's separate detail becomes its subheading;
  - if it had no link, the first web address typed into its text becomes the link (with its name);
  - any other web addresses stay in the heading, and the box lists them until the owner moves or removes them;
  - anything over the new limits is listed, not cut.

  Published Stacks keep showing as they are until they're edited. Live has none (Nov 26).

**Not in 2b:** fetching a link's page title and site icon (later, its own task); the Finalize step: theme, place and city, categories (2c); the full publish checks and the "Fix N things" list on Finalize (Task 3).

## Steps (live)

1. **Apply and record the migration** with the Supabase CLI `db push`:
   - the dry run must list only `20261129000000_pick_model`;
   - afterwards the history shows 24 rows.
2. **Merge the PR.** Then, on the real site:
   - start a Stack and add a pick with a subheading and two tags;
   - check "Saved just now" shows, and a refresh brings the pick back with its tags;
   - publish it, and check the Stack page shows the subheading and the tags.

The new editor saves picks that the new database rules accept, so step 1 comes first.

**Between the two steps,** the current live app keeps working. Its drafts save as before. Publishing from it now follows the new limits, so a Stack with a paragraph, a bold line or something over a new limit is refused with a message saying why. To avoid that, don't publish between the two steps.

## Rollback

1. In Vercel, promote the previous production deployment.
2. Run `web/supabase/rollback/20261129000000_pick_model.down.sql` by hand. It puts back the previous rules and limits.
   - Stacks published with picks keep their content.
   - Their pick ids and tags are dropped the next time their content is saved.
3. Run `supabase migration repair --status reverted 20261129000000`. The history then shows 23 rows.

## Evidence (isolated test environment, Nov 26)

- **Migration on the test copy** (the live-like copy from 2a, with 23 history rows):
  - the CLI dry run listed only this migration;
  - `db push` applied and recorded it (24 rows).
- **Database tests** (`web/supabase/tests/pick_model.test.sql`, all pass):
  - a full pick keeps its id, heading, subheading, link, link name, format and tags, and line breaks become spaces;
  - a good id is kept; a missing, malformed or repeated one is replaced;
  - each pick limit: heading 80, subheading 100, 3 tags of up to 20 characters, one price;
  - blank and repeated tags are dropped;
  - an empty pick is dropped; one with anything in it needs a heading; paragraphs and bold lines are refused;
  - 15 picks and 5 titled sections are allowed, 16 and 6 aren't; section titles up to 40;
  - descriptions up to 160;
  - a Stack published under the old limits keeps its content, and changes that don't touch it (visibility, likes) still work;
  - `publish_draft` and `apply_stack_edit` follow the same rules, a refused publish keeps the draft, and published picks keep their ids and tags.

  The same tests fail on the previous rules.
- **Rollback:** on the test copy, the rollback put back the previous rules (a paragraph was accepted again) and the 2a draft tests passed. Re-applying the migration passed the new tests again.
- **Browser** (`web/e2e/picks.e2e.mjs`, 25/25):
  1. the Title page shows "Saved just now";
  2. a pick saves its heading and subheading, line breaks become spaces, and it gets a stable id;
  3. **tags tray:**
     - a second price swaps in;
     - a typed tag over 20 characters shows "28/20 · 8 over. Shorten it to add." and can't be added;
     - at 3 tags the others dim and a 4th can't be added;
     - tapping a chosen tag removes it;
  4. a 92-character heading isn't cut: the counter says "12 over" and the box lists it. Once fixed, the box goes and the id stays;
  5. Enter adds the next pick in the same format; Add link adds https:// and shows the domain;
  6. Delete shows "Item deleted" with Undo; Undo brings the pick back with its id and tags; reorder keeps the id; the message goes after 5 seconds;
  7. publishing keeps each pick's id, subheading and tags, and the Stack page shows them;
  8. publishing an edit to that Stack keeps the pick's id;
  9. at 15 items, Add item reads "15 of 15 items" and adds nothing;
  10. with 5 sections, Section says "A Stack can have up to 5 sections." and adds none;
  11. older content (a paragraph with ** marks, a bold line, a numbered line with a detail, a 120-character line) opens as picks with the detail as a subheading, lists the long one, and saves as picks with ids, nothing cut;
  12. new headings naming a website ("Ramen at fuunji.jp", and one with its own link) keep their heading and link through save, refresh and another save, with nothing listed;
  13. an older line with two web addresses: the first becomes the named link, the second stays in the heading and is listed after save and refresh, until the owner removes it;
  14. Delete a pick, edit another, then Undo: only the deleted pick comes back, in its place, and the edit stays. The same for a removed section title.

  Checks 12, 13 and 14 fail on this PR's first version, which had those bugs.
- **The window between the steps:** the current live app (built from `main`) passed its own drafts browser test (26/26) against the migrated test copy.
- **Earlier suites still pass:**
  - drafts browser test, 26/26;
  - sign-in browser test, 79/79;
  - guard test, return-address test (40/40), old-draft recovery checks;
  - 2a database tests, type checks and lint.
