# Task 2c: the Finalize step, rollout

This covers migration `20261130000000_finalize` and the new Finalize step (spec, Flow 1 step 4). Each step that changes live Supabase or production needs a go-ahead.

## What changes

- **One Finalize screen, with an Arrange / Preview switch.** The top bar (Exit, save status, Save draft) stays in both.
- **Theme card.**
  - The emoji and colour are suggested from the title: "Suggested from your title. Tap to change."
  - 12 emoji and 6 colours to choose from. Once changed: "You picked this theme."
  - An untouched suggestion is what gets published, so it doesn't change later.
- **Is this about a place?**
  - Yes / No. Until answered, it starts at Yes when there's a city or the theme's emoji suggests a place (🍸 🍜 ☕ ✈️ 🌮 🌴).
  - Yes shows the city field (up to 80 characters) and "A city is required for place stacks."
  - No says "Not about a place. No city needed." A city typed earlier isn't published.
- **Who can see this stack:** Public, Invite Only (Unlisted) or Private, as before.
- **Categories:** pick 1 or 2 of the spec's 12. At 2, the rest are off and the card says "You picked 2. Tap one to remove it, then pick another."
- **Order:** move sections and picks up or down, the same as Reorder in Build.
- **Preview:** the theme band (colour, emoji wallpaper, emoji, "N picks"), the city, the Stack as visitors see it, and its categories.
- **Back to Build** returns to step 3 with everything kept.
- **Everything is kept in the draft** and comes back after a refresh, at Finalize.
- **Publishing saves the choices on the Stack.** The new `stacks` columns are `theme_emoji`, `theme_color`, `is_place` and `categories`; the city stays in `location`. The database accepts only the listed emoji, colours and categories, at most 2 categories.

**Not in 2c:**
- **Task 3 (publish checks):** requiring a city for a place Stack and at least one category, and the "Fix N things before publishing" list.
- **Later tasks:**
  - showing the theme on the Stack page and in feeds;
  - the feed-card preview;
  - Explore and search using the new categories;
  - changing these choices when editing a published Stack. Edits keep them as they are.

## Steps (live)

1. **Apply and record the migration.**
   - A read-only comparison of the repo's migrations with live's history must list only `20261130000000_finalize`.
   - Then apply it and record it, in one step.
   - Afterwards the history shows 25 rows.
2. **Merge the PR.** Then, on the real site:
   - start a Stack and go to Finalize: check the suggested theme, pick another, answer the place question with a city, and pick 2 categories;
   - check Preview, then publish;
   - I'll confirm on live that the Stack has those choices.

The new app sends the choices with Publish, which works only after step 1, so step 1 comes first.

**Between the two steps,** the current live app keeps working. Its Publish leaves the new choices out: no theme, not a place, no categories.

## Rollback

1. In Vercel, promote the previous production deployment.
2. Run `web/supabase/rollback/20261130000000_finalize.down.sql` by hand. It puts back the previous `publish_draft`. The new columns stay with whatever is in them, and the previous app ignores them.
3. Run `supabase migration repair --status reverted 20261130000000`. The history then shows 24 rows.

## Evidence (isolated test environment, Nov 26)

- **Migration on the test copy** (24 history rows): the CLI dry run listed only this migration, and `db push` applied and recorded it (25 rows).
- **Database tests** (`web/supabase/tests/finalize.test.sql`, all pass):
  - all four choices are kept on the published Stack;
  - a Stack that isn't about a place keeps no city;
  - an unlisted emoji, colour or category, 3 categories, or a repeated one are refused, and a refused publish keeps the draft;
  - an older app's call without the choices still publishes;
  - the table itself refuses unlisted values.

  The same tests fail on the previous rules.
- **Rollback:** on the test copy, the rollback put back the previous `publish_draft` and the 2a draft tests passed. Re-applying passed the new tests again.
- **Browser** (`web/e2e/finalize.e2e.mjs`, 10/10):
  1. "Late-night tacos in CDMX" suggests 🌮, and the place question starts at Yes with the city field;
  2. a picked emoji and colour say "You picked this theme.", save, and come back after a refresh at Finalize;
  3. No hides the city; Yes brings it back, and the city saves;
  4. 2 categories save, a third is off with the reason, and tapping one removes it;
  5. Order moves a pick up;
  6. Who can see this stack saves the choice;
  7. Preview shows the theme band, the city and the categories;
  8. publishing keeps the theme, place and city, categories, visibility and order on the Stack;
  9. "Books I loved" starts at No, its suggested theme (📖) is published, and a city typed before answering No isn't kept.
- **The window between the steps:** the current live app (built from `main`) passed its own pick-editor (34/34) and drafts (26/26) browser tests against the migrated test copy.
- **Earlier suites still pass:**
  - pick editor 34/34, drafts 26/26, sign-in 79/79;
  - guard, return-address (40/40) and old-draft recovery tests;
  - the 2a and 2b database tests, type checks and lint.
