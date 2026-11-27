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
- [x] Placeholders as in the design: "Item (required)" (the design says "Item name", but the word "name" makes iPhones offer contacts; agreed Nov 26), "Add a short reason or useful context (optional)". Autofill is off in every create-flow field.
- [x] Save failure reads **"Not saved · Retry"**, with Retry (Flow 1, What is saved and when).
- [x] The Build header shows the item count ("5 items · 2 links") (Flow 1, step 3).
- [x] **Shift+Enter does nothing** in pick fields, so no line breaks (Responsive behavior, Build: format toolbar).
- [x] Publish is black with a pink offset shadow (Responsive behavior, Publish).
- [x] "Your Stack is live" offers **Share your Stack, Start another stack, Done**. Done goes to Profile › Stacks, with the new Stack at the top (Flow 1, Published screen).
- [x] The save status and messages are announced politely to screen readers (Global rules, accessibility).
- [x] Editing a published Stack: the buttons read **Save** and **Save and share update**.
- **Checked on production (Nov 26, phone):** in a draft, Tags › Your own put the cursor in its field; the typed tag "Rooftop" saved, and after a refresh the pick still had the tag and its heading ("bar tag 1") was unchanged. Passed.
- **Deferred:** the **"+" format menu** by the current pick: Section, Numbered, Bulleted (Flow 1, step 3). The design doesn't have it, and the toolbar already offers the same three. Listed under Later tasks.

## After 2d: the theme on the Stack page (agreed Nov 26)

- [x] The Stack page shows its theme as in the design: the theme colour with the emoji wallpaper behind the page, Back (or Edit for your own Stack) as white pills, and the card's band with the emoji wallpaper and the "🌮 N picks" pill.
- [x] Changed from the design (agreed Nov 26): the band holds only "🌮 N picks", on the right. The city and date sit in a small row after the last pick: "📍 Mexico City · Published Nov 24" ("Updated Nov 26" once edited; just the date when the Stack isn't about a place). They stay stored for search and sorting.
- [x] The rest of the Stack page matches the design: the tag filter ("All N" and each tag; "Showing N of M · tag"), flat tag labels in their group's colours ("Renata says"), round Pin and Send buttons on each pick, the bottom bar's colours and yellow **Remix** with its count, a solid pink Follow, the green "Updated" box and the comments panel.
- [x] ⋯ replaces Edit (agreed Nov 26): on your own Stack it opens Edit stack, who can see it, and Delete.
- Pin, Send, Remix, and Report / Block (⋯ on someone else's Stack) show "coming soon" until those features are built (agreed Nov 26).
- [x] Finalize › Preview shows the same layout, so it matches the published page.
- Stacks published before the theme existed show the theme suggested from their title.
- Feed cards keep their current band for now (see "Showing the Finalize choices in feeds" below).

## Task 3: publish checks

Agreed Nov 27: to publish, a Stack needs only a title, at least 1 pick, and nothing over a limit. The theme always has one selected; the categories and the city are optional.

- [x] The red "Fix N things before publishing" box on Finalize, listing each problem ("Fix this before publishing:" for one).
- [x] Publish looks off, with the reason under it, while a check fails ("Fix 3 things on this page to publish."). Tapping it anyway publishes nothing and shows the first problem in a toast.
- [x] The city and the categories are optional (Nov 27): "City (optional), e.g. Mexico City", "Looks like a place stack. Adding the city helps people find it.", and "Optional. Pick up to 2 to help people find your Stack in Explore and search." (Task 3 first required them.)
- [x] A place Stack's city: "City is 5 over 80 characters." is in the list.
- [x] A section with no items: "“Roma Norte” has no items. Add one or remove the section."
- [x] On failure (agreed Nov 26): a sheet with **Try again** and **Keep editing**. Everything is kept.
  - If the draft couldn't be saved, nothing was published: "Your latest changes couldn't be saved, so nothing was published. They're still here. Check your connection and try again." The save status says "Not saved · Retry".
  - If the publish was sent but no answer came, the app first asks the server whether it went through. The server waits for a publish of that draft that's still running to finish, and refuses one that arrives after it answered "still a draft", so the answer holds:
    - live: it opens the published Stack ("Your Stack is live");
    - still a draft: editing goes on, with the toast "Couldn't publish. Your stack is still a draft. Check your connection and try again.";
    - the look fails too: "Publish status unknown", with only **Check again** (editing stays closed until it knows). A failed Check again says "Still couldn't check. Try again in a moment."
- [x] A title typed in "Name your Stack to publish" is saved to the draft at once, so it's kept if the publish fails and after a refresh.
- [x] The slug at first publish (agreed Nov 26): saved from the title and never changed; Stacks published earlier got theirs too. Since Nov 27 it's in the Stack's address (see "Readable links" below).
- The server refuses the same things: no title, a city over 80 characters, no items, a titled section with no items. The older save path (from app versions before drafts) still saves drafts, and publishing through it gets the same checks. Every published Stack gets a slug, whichever way it was published.

## After Task 3 (agreed Nov 27)

- [x] The row after the last pick shows the categories too: "📍 Mexico City · Published Nov 24 · Food & Drink" ("Food & Drink, Travel & Places" with two; nothing added with none).
- [x] Editing a published Stack follows the same steps as creating: the picks, then **Finalize** (theme, "Is this about a place?" and the city, categories, Order, Preview), with Back, **Save** and **Save and share update**. It starts from the Stack's choices. Who can see it stays in the ⋯ menu.
- [x] Changing only the theme, place, city or categories doesn't mark the Stack "Updated", and can't be shared as an update; that stays for the title, description and picks.
- [x] Manage stacks shows "Updated …" on the same rule as the Stack page: any edit to the title, description or picks after publishing, even seconds later (it used to ignore edits within a minute).
  - **Checked on production (Nov 27, iPhone, after PR #52):** a freshly published Stack showed no "Updated" in Manage stacks. After an edit saved through Finalize › Save & exit (89 seconds after publishing), its row ended with "· Updated" and the date. The under-a-minute case is covered by the pick editor test 8c (an edit 3 seconds after publishing).
- [x] Unsaved edits kept from before this (Nov 26) reopen with their pick edits and the published Stack's theme, place answer, city and categories. Edits saved since keep the person's own Finalize choices, including clearing the categories.
- [x] Editing's buttons are **Save & exit** and **Save & share** (agreed Nov 27). After saving you go back to where you opened the editor from, past the Stack's own page if that's where you tapped Edit (so Profile › Stack › Edit › Save & exit lands on the profile); with nowhere to go back to, the profile. Back and Save & exit go by the browser's own history list, so repeated edit trips, browser Back and Forward, and an editor opened directly all land in the right place.
- [x] On a narrow iPhone the Stack page and Finalize › Preview fit at default zoom: a long name or handle shortens with "…" so Follow stays in the card.
- [x] No tap-to-zoom on iPhone and iPad (agreed Nov 27, instead of 16px text boxes): Safari zoomed in when a text box under 16px was tapped (the editor's are 13–15px) and kept the zoom on every later screen, so the Stack page ran off the screen. On iPhone and iPad the page now tells Safari not to auto-zoom (maximum-scale=1); pinch-to-zoom still works there. Android is unchanged, since it would block pinch-zoom.
- **Checked on production (Nov 27, iPhone 15 Pro, Safari), after PR #50:** all passed.
  - Tapping into a pick's name in the editor didn't zoom the page.
  - Save & exit went back to Profile when the edit started from Profile, and to the Feed when it started from the Feed.
  - The Stack page fit without pinching: both edges, ⋯ and the bottom bar showed.
  - Pinch-to-zoom still worked.
  - Two trips in a row, Profile › Stack › ⋯ › Edit stack › Finalize › Save & exit, both landed on Profile.
  - After those trips (Feed › Profile › Edit › Save & exit), Safari's Back went from Profile to the Feed, not back into the editor or the Stack.

## Readable links (agreed Nov 27)

- [x] A Stack's address is `/{username}/{slug}`, like `/stackapp/cities-to-travel-to`, and a profile's is `/{username}`, like `/stackapp`. Your own `/{username}` opens your Profile tab.
- [x] The older `/s/{id}` and `/u/{username}` addresses forward to them (keeping `?comment=1`), so links already shared keep working.
- [x] The links people tap or share use them: Stack cards, Share and Copy link, the address after publishing, profile links, @mentions, follow notifications.
- [x] After a username change, links with the old username forward to the new one. The old username stays reserved to its owner (nobody else can take it), and switching back to it works (D-1).
- [x] Usernames can't be the app's file names (`favicon.ico` and the like).
- [x] A Stack's page fills the screen at its readable address too (no tab bar), however it's opened.
- [x] Safe when two requests overlap: while someone is giving up a username, nobody else can take it (the second request waits, then is refused).
- Followers and Following lists stay at `/u/{username}/followers` and `/u/{username}/following`.
- **Checked on production (Nov 27, iPhone, after PR #54, with migration 20261203000000 applied first):** a Stack opened from Profile showed `/stackapp/cities-to-travel-to` and filled the screen with no tab bar, and an old `/s/{id}` link landed on the same Stack at its readable address.

## Themed cards (agreed Nov 27, part 1 of showing the Finalize choices)

- [x] Feed cards look like the design's: a band in the Stack's theme with its emoji wallpaper, "🌮 7 picks" on the left and the time on the right; the author with Follow; the big title; the first 5 picks in the Stack page's style; then "See all 7 lines".
- [x] Follow on a feed card shows Following when you already follow the author.
- [x] Search results are the same feed cards.
- [x] Explore › Trending: a smaller band with the picks and the category, the first 3 picks, "+ 4 more lines", then Like, Save and Share.
- [x] Explore › Recently added: each Stack's theme as a small square with its emoji, "Maria · 7 picks", and the time.
- [x] Profile tiles: a strip in the Stack's theme with its emoji on top.
- [x] A Stack published before themes shows the theme its title suggests.
- Part 2, next: Explore and search use the 12 categories (needs a database change).

## Later tasks

- **Editing at its own address** (spec: `/{handle}/{slug}/edit`): editing still opens at `/create?edit=…`.
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
- **Categories in Explore and search** (part 2 of showing the Finalize choices): the 12 categories with their emoji and colour, 6 shown then "More categories"; tapping one shows only Stacks in it; search also matches categories; a Back button instead of Cancel.
- **Editing a published Stack:** "This stack changed on another device".
- **Remix:** a freshly suggested theme, and remixedFrom.
