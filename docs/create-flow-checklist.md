# Create flow checklist (spec, Flow 1 and the editor rows of "Responsive behavior")

Every detail of creating and publishing a Stack, and where it's built. Tick items off as they ship. Agreed Nov 26: phone first (2d); tablet and desktop in a later task.

## Built

- **Drafts (2a):**
  - autosave about a second after each change;
  - the draft's own address, `/drafts/<id>`, and a refresh reopens it at its step;
  - the leave warning while a save is pending;
  - Exit: no draft when empty, otherwise "Draft saved" and Profile › Drafts.
- **Picks (2b):**
  - heading (80), subheading (100), up to 2 links, up to 3 tags;
  - the tags tray: 5 groups, "Your own", one price, and the 3-tag message;
  - the link sheet: Link, Name, "Shows as", Remove link, https:// added;
  - full web addresses written into a pick become links;
  - Edit › Reorder / Delete, with a 5-second Undo.
- **Counters (2b):**
  - shown at 80% of a limit, red past it with "N over", and text is never cut: title, description, pick heading, subheading, section title, tag, city (2c);
  - "15 of 15 items · remove one to add another";
  - "A Stack can have up to 5 sections.";
  - line breaks become spaces.
- **Save status on every step (2b).**
- **Finalize and Preview (2c), as in the design:**
  - theme card, Privacy, place question and city, categories, Order;
  - the full-screen Preview;
  - the dark Publish.

## 2d: the phone create flow matches the design, plus missing details (PR #44)

- [x] Title, Description and Build match the design: top bar, status pill, progress bar, fields, pick rows, toolbar, tags tray, link sheet, bottom bar. Pink accent, ink text and the design's fonts.
- [x] The tags tray opens as a panel under the toolbar, with group hints ("Price · pick one") and a "2/3" count. Tapping "Your own" or its field puts the cursor there.
- [x] No warning box above the picks: each pick says what to fix under it ("Needs a heading.", "heading 92/80 · 12 over", an older web address). A section with picks and no title says "Needs a title."
- [x] Placeholders as in the design: "Item name (required)", "Add a short reason or useful context (optional)".
- [x] Save failure reads **"Not saved · Retry"**, with Retry (Flow 1, What is saved and when).
- [x] The Build header shows the item count ("5 items · 2 links") (Flow 1, step 3).
- [x] **Shift+Enter does nothing** in pick fields, so no line breaks (Responsive behavior, Build: format toolbar).
- [x] Publish is black with a pink offset shadow (Responsive behavior, Publish).
- [x] "Your Stack is live" offers **Share your Stack, Start another stack, Done**. Done goes to Profile › Stacks, with the new Stack at the top (Flow 1, Published screen).
- [x] The save status and messages are announced politely to screen readers (Global rules, accessibility).
- [x] Editing a published Stack: the buttons read **Save** and **Save and share update**.
- **Deferred:** the **"+" format menu** by the current pick: Section, Numbered, Bulleted (Flow 1, step 3). The design doesn't have it, and the toolbar already offers the same three. Listed under Later tasks.

## After 2d: the theme on the Stack page (agreed Nov 26)

- [ ] The Stack page shows its theme as in the design: the theme band with the emoji wallpaper, the "🌮 N picks" pill and the date pill.
- [ ] The city shows on the Stack page.

## Task 3: publish checks

- [ ] The red "Fix N things before publishing" box on Finalize, listing each problem.
- [ ] Publish looks off, with the reason under it, while a check fails.
- [ ] A place Stack with no city: highlight the city, and the toast "Add a city to publish this place stack."
- [ ] At least 1 category.
- [ ] A section with no items: "“Roma Norte” has no items. Add one or remove the section."
- [ ] On failure: "Couldn't publish. Check your connection and try again.", keeping everything.
- [ ] The slug at first publish.

## Later tasks

- **The "+" format menu** by the current pick (Section, Numbered, Bulleted), deferred from 2d: the spec has it, the design doesn't.
- **Tablet:**
  - a centered column, max 680 px;
  - the link sheet and tags tray as centered dialogs, max 480 px.
- **Desktop** (most Proposed):
  - Build with a 360 px live preview from 1280 px up, or a Preview button below that;
  - a two-column Finalize (settings left, live preview right) with a Phone / Desktop switch;
  - on hover: a move handle and delete button on pick rows, and drag to reorder;
  - shortcuts: Alt+↑ / Alt+↓ to move a pick, Cmd/Ctrl+K for Link;
  - the link and tags as popovers;
  - Publish also in the top bar.
- **Link titles:** "Fetching link…", then the page title and site icon, falling back to the domain after 6 seconds.
- **Preview of the feed card** ("This is how your card looks in feeds", as a full feed card).
- **Showing the Finalize choices in feeds**, and categories in Explore and search. (The Stack page comes right after 2d, above.)
- **Editing a published Stack:**
  - the theme, place and categories;
  - "This stack changed on another device".
- **Remix:** a freshly suggested theme, and remixedFrom.
