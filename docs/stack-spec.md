# Stack — User Flows and Functional Spec

Nov 24, 2026 · @Jay

This spec defines what Stack v1 (Party Mode) does from each user's point of view, so a coding agent can build it without the design thread. It covers the creator and visitor journeys, the full Stack lifecycle, the bucket list, and every screen in the current mockups.

## Scope and how to read this

**Sources, in priority order.** 1) Decisions made in the design conversation (latest wins). 2) The current mockups: the Party Mode app page and the Party Mode create flow. 3) Proposed defaults in this doc. The original Stack App and Create Flow pages are superseded and are not to be built.

**Labels used throughout.**

- **Agreed:** a decision already made. Build as written.
- **Proposed default:** a routine gap filled in by this spec. Build as written unless changed.
- **Decision needed (D-n):** a choice about publishing, privacy, access or someone's work. All are now decided; see Decisions for me.
- **Conflict (C-n):** the mockup does something an agreed decision or another rule contradicts. See Conflicts.

**In scope for v1.** Creating, editing, publishing and deleting Stacks; visibility (Public, Unlisted, Private); per-pick micro-tags and themes; Home feed, Explore and search; profiles (your own, and the public profile everyone else sees); Save, Like, Repost, Comment, Follow; sharing as a Reels/TikTok video and a link-in-bio web page; the bucket list (pins, buckets, check-offs); asks on profiles; Inbox (Activity and Messages); sign-in with Google or an email code; profile photos; settings, blocking and reporting; the content rules for every Stack.

**Out of scope for v1 (Agreed).** Quarterly Wrapped (designed but hidden; keep the code path off). Per-pick replies. Changes ported from Project Louie.

**Platform.** Mobile-first web app with real URLs. The mockups show an iPhone frame, but every screen below must work in a mobile browser, because shared links open there.

## Core concepts and data model

Every object below needs a server-side record. The mockup keeps everything in browser storage; production must not.

| Object | Key fields | Rules |
| --- | --- | --- |
| User | id, verified email, sign-in methods (Google, email code), name, handle (unique, past handles reserved), bio, photo (400×400 crop), socials (X, Instagram, TikTok, Facebook, email), contact button (type + URL), up to 2 featured websites, show follower counts (bool), featured stack id + caption | Handle is the public URL segment. Past handles are kept, redirect, and can't be taken by anyone else (Agreed, D-1). Proposed default: 3–30 characters, letters, numbers, dot and underscore, case-insensitive unique. |
| Stack | id, owner, title (≤60), description (≤160), theme (emoji + color), is place stack (yes/no), city (≤80, required when place = yes), categories (1–2 from the 12 below), visibility, sections, publishedAt, updatedAt, sharedAt + update note, remixedFrom | Permanent id is its identity; slug is fixed at first publish (Agreed, D-1). No total-character limit; see Content rules. |
| Section | id, title (≤40, required when the section exists), ordered items (≥1 to publish); no description | Up to 5 per Stack. Items may also sit outside any section. |
| Pick (line) | **stable id**, format (numbered or bulleted), heading (≤80, required, plain text), subheading (≤100, optional), up to 2 links stored separately (each a URL ≤2,048 + optional display name ≤40; not counted toward limits; Agreed Nov 26), tags (≤3) | Pins, check-offs, sends and messages point at the pick's permanent id, never at its position (Agreed, C-1). Pins also keep a copy of the pick's text, so they survive deletion. |
| Micro-tag | fixed set in 5 groups: Highlight (Must-do, Hidden gem, New), Price (Free, `$`, `$$`, `$$$`; pick one), Good for (Kid-friendly, Date night, Solo-friendly, Groups, Veg options), Know before (Cash only, Book ahead, Go early, Walk-in, Expect a line, Quick read, Dense, Great on audio), When (Brunch, Late night, Sunset) | Written from the creator's point of view, not as reactions (Agreed). Creators can also type their own tag (≤20 characters), e.g. "Outdoor seating"; a typed tag has a neutral color. |
| Draft | id, owner, all Stack fields, step reached, editOf (stack id or null), remixedFrom | Only the owner can see drafts. |
| Bucket | id, owner, name (≤40), emoji, color, visibility (Public, Unlisted, Private; default Private), slug | User-defined (Agreed). |
| Pin | user, pick id, bucket id (or Unsorted), status (In progress, This week, This weekend, Next week, Someday), doneAt | One pin per user per pick. |
| Social records | like, save, repost (+ note), comment, follow, block | Each is per user per stack (or per user pair). |
| Ask | id, author, text, expiresAt, answers (stack ids) | Shown on the asker's profile (D-9). Text ≤100, open 1 or 3 days. |
| Message | thread, sender, either text or a pick card | Inbox › Messages. |
| Activity | recipient, actor, type (like, comment, remix, save, repost, pin, ask, follow), stack, pick (for pins), read | Inbox › Activity. A follow has no stack; one per follower per person (Agreed). |

**Categories (Agreed).** Every Stack has 1 or 2 of these 12 categories (Proposed default for the count). They power Explore tiles, topic chips and search; creators can't type their own.

| Category | What fits |
| --- | --- |
| Art & Design | Architecture, photography, interiors, illustration, creative inspiration |
| Technology | AI, software, gadgets, coding, useful digital tools |
| Business & Money | Entrepreneurship, careers, marketing, investing, personal finance |
| Learning | Courses, tutorials, research, study resources, how-to guides |
| Health & Wellness | Fitness, nutrition, mental health, skincare, self-care |
| Food & Drink | Recipes, restaurants, coffee, bars, cooking |
| Travel & Places | Trip guides, local discoveries, itineraries, places to visit |
| Style & Shopping | Fashion, beauty, wish lists, gift guides, product finds |
| Home & Living | Gardening, DIY, organization, parenting, pets, everyday life |
| Entertainment & Culture | Movies, TV, music, books, podcasts, internet culture |
| Sports & Outdoors | Sports, hiking, camping, cycling, outdoor activities |
| Games & Hobbies | Video games, tabletop games, crafts, collecting, personal projects |

**Content rules (Agreed).** Every Stack is short, scannable and mainly a list. These replace all earlier limits.

| Element | Limit | Required? |
| --- | --- | --- |
| Stack title | 60 characters | Yes |
| Stack description | 160 characters | No |
| Sections | 5 per Stack | No |
| Section title | 40 characters | Yes, when a section exists |
| Items | 15 per Stack, across sections and unsectioned items | At least 1 to publish |
| Item heading | 80 characters | Yes |
| Item subheading | 100 characters | No |
| Item tags | 3 per item | No |
| Tag text | 20 characters per tag | Yes, when a tag exists |

- Sections hold a title and items only, and every section needs at least one item to publish. Items can exist without a section.
- No standalone paragraphs or other text blocks.
- No manual line breaks in any title, heading, description, subheading or tag; typed or pasted breaks become spaces. Text wraps naturally.
- Item URLs are stored separately and don't count toward limits. There is no total-character limit.
- Tags carry quick details ("Kid friendly", "Outdoor seating", "Must visit"); subheadings give a brief reason or context.
- Drafts can be incomplete; every required field and limit is enforced at publish (and at Save changes).
- Counters appear near a limit; exceeded limits are explained, and text is never silently cut off.
- At the item, section or tag limit, the add control is disabled and explains why.
- The server applies the same validation and rejects a publish that breaks any rule.

Example item: **Café Regina** · "Excellent iced coffee and a small patio." · `Coffee` `Outdoor seating` `Must visit`

**Existing content (Proposed default).** Stacks made before these rules keep displaying as they are. Opening one in the editor converts paragraph and bold lines into bulleted items, and the editor lists anything over the new limits; it must be fixed before Save changes.

**Visibility (Agreed).** Visibility is set per Stack and protects content, not identity. Every profile is public in v1; there are no private accounts (D-5).

| Visibility | Who can open it | On the creator's profile or in discovery |
| --- | --- | --- |
| Public | Anyone | Yes |
| Unlisted | Anyone with the link; people who have it can pass it on | No |
| Private | Only the owner | No |

A creator's public profile shows only Public Stacks and gives no sign of anything else: no Unlisted or Private titles, thumbnails or counts. The stack count visitors see counts Public Stacks only. There is no "Private view / Public view" toggle (Agreed, removed): the owner always sees their own profile with everything they own, and everyone else always gets the public profile at /{handle}.

Known limit: v1 can't do "only my friends can view this." Unlisted links can spread, and Private is owner-only. If sharing with chosen people becomes a common request, that justifies adding restricted sharing later.

**No XP or levels (Agreed).** The bucket list replaces XP: progress is shown as items done and to do. There are no points, levels or level-up moments anywhere in v1.

**Other records (Agreed through the new screens).** Ask: owner, text (≤100), duration (1 or 3 days), createdAt, closedAt, answer Stack ids; up to 3 open per user. Report: reporter, kind (stack, comment, account), target, reason (one of 7), details (≤500; required for Something else), createdAt, status; one per reporter per target. Message thread: two participants, messages (text ≤1,000 or a pick card), read state per participant. Bucket also has pinnedAt, createdAt, item order, visibility and slug.

## Global rules

These apply to every flow unless a flow says otherwise.

**Navigation (Agreed).** A floating bottom bar with five items, left to right: Home, Explore, Create (centre, yellow +), Profile, Inbox. Inbox shows an unread badge (Activity unread + unread message threads, capped at "9+"). Tapping a bar item resets the back history and opens that tab's root. The bar is hidden on Stack detail and inside Create. Everywhere else on mobile it hides while scrolling and returns 200 ms after scrolling stops (see Bottom navigation on mobile below).

**Back.** Every pushed screen (Stack detail, another user's profile, Manage stacks, Settings, Blocked accounts) has a Back control that returns to the exact previous screen, scroll position and tab. Back must sit below the device status bar and stay tappable (Agreed fix). With no history (for example a deep link), Back goes to Home.

**URLs (Agreed).** Every screen has a URL so refresh and shared links work:

| Screen | URL |
| --- | --- |
| Home | `/` |
| Explore / search | `/explore`, `/explore?q=term` |
| Stack (in app and as shared link) | `/{handle}/{stack-slug}` |
| User profile | `/{handle}` |
| Own profile tabs | `/me`, `/me/buckets`, `/me/saved`, `/me/reposts`, `/me/drafts` |
| Create / edit | `/new`, `/drafts/{id}`, `/{handle}/{slug}/edit` |
| Inbox | `/inbox`, `/inbox/messages` |
| Settings | `/settings`, `/settings/blocked`, `/settings/stacks` |

**URL rules (Agreed).**

- **Buckets:** `/{handle}/buckets/{bucket-slug}` (Public and Unlisted buckets).
- **Slugs:** the Stack or bucket title in lowercase, accents removed, words joined by dashes. If the same person already has that slug, add `-2`, `-3` and so on.
- **Changes:** when a username changes, every URL moves to the new username and the old ones redirect. When a title changes, the slug stays as it was at first publish, so links never change (D-1).
- **Reserved usernames:** these can never be usernames because the app uses them for its own pages: `explore`, `me`, `new`, `drafts`, `inbox`, `settings`, `help`, `terms`, `privacy`, `buckets`, `login`, `signup`, `api`, `admin`, `about`, `support`, `stack`.

Link rules (Agreed, D-1): every Stack has a permanent internal id, and the URL is only a way to find it. The slug is set from the title at first publish and never changes when the title changes. When a user changes their username, URLs switch to the new username and every old-username URL redirects automatically. Previous usernames stay reserved to their original account forever, so no one else can take them. Later (not v1): creators may edit a Stack's slug, with a warning; the old slug stays reserved and redirects. Sheets and modals do not get URLs; refreshing with one open returns to the screen under it.

**Signed-out access.** A signed-out visitor can browse Home, Explore, search, other profiles, and any Public or Unlisted Stack. Any action that writes data opens the sign-in modal first:

| Action | Sign-in prompt text |
| --- | --- |
| Create (+) | Sign in or create an account to start a stack. |
| Publish, Save draft, keep draft on exit | Sign in to publish / save / keep this draft. |
| Like, Save, Repost, Comment, Follow | Action-specific line, e.g. "Sign in to save stacks to your profile." |
| Pin, check off, send a pick | Sign in to pin picks / check things off / send picks. |
| Answer an ask | Sign in to answer with a stack. |
| Profile tab | Profile shows "Sign in to see your profile" with a Sign in / Create account button. |

The modal offers **Sign in / Create account** and **Not now**. After a successful sign-in, the action the user tried runs automatically (Agreed behaviour in the mockup). Not now closes the modal and changes nothing.

**Saving (Proposed default).** Every write goes to the server. Optimistic UI is fine for likes, saves, follows, pins and check-offs: show the change at once, roll it back with a toast "Couldn't save. Try again." if the request fails. Publishing, saving edits, visibility changes and deletes wait for the server and show a spinner on the button; on failure the user stays where they are with their input intact.

**Blocking.** Stacks, comments and profiles of blocked users are hidden everywhere for the blocker. The blocked user cannot see the blocker's profile or stacks and is not notified (Agreed copy).

**Toasts.** Short confirmations appear above the nav bar for about 2 seconds; undo toasts stay 5 seconds.

**Mobile scrolling (Agreed, for the live web app).** On phones, published Stack pages and creator profiles scroll as normal documents: the page itself scrolls, not a panel inside a full-height wrapper.

- **No viewport-height scroll trap on these routes.** No `height: 100vh` / `100dvh` wrapper with an inner `overflow: auto` panel, and no `overflow: hidden` on `html` or `body`. Use `min-height: 100dvh` where a minimum is needed.
- **The page header scrolls away with the content.** Not fixed or sticky on these routes.
- **Safari's own toolbar behavior.** Because the document scrolls, Safari collapses its address bar and toolbar naturally. No JavaScript scroll handlers for this. The viewport meta includes `viewport-fit=cover`.
- **The last item stays reachable** with the toolbar expanded or collapsed (see the bottom padding rule below).

**Bottom navigation on mobile (Agreed, for the live web app).** Applies to Stack's own bottom nav bar only, not to sheets, toasts, the share sheet or Safari's toolbar.

- **Visible on first load.**
- **Hides as soon as the page starts scrolling**, up or down.
- **Comes back 200 ms after the last scroll event.** A passive scroll listener restarts a 200 ms timer on each event. This listener only drives the nav; it doesn't touch the page or Safari's toolbar.
- **Stays visible while any nav control has keyboard focus** (`:focus-within` on the nav), even while scrolling.
- **Short slide animation:** about 180 ms, moving down by its own height plus the bottom safe area, using `transform` only. With Reduce Motion (`prefers-reduced-motion: reduce`) it appears and disappears without sliding.
- **Never shifts content.** The bar is `position: fixed` and only moves with `transform`, so hiding or showing it never changes the page layout or scroll position.
- **Always room below the last item.** Pages keep bottom padding equal to the bar's height + `env(safe-area-inset-bottom)` + 16 px, whether the bar is showing or not, so it can never cover the last item when it comes back.
- **Hidden from assistive tech while hidden** (`aria-hidden` and `inert` while off screen), so focus can't land on an invisible button.

**QA before launch (on a real iPhone in Safari).** Open a long published Stack (15 items) and a creator profile.

1. The toolbar collapses as you scroll down and comes back as you scroll up, with no jumping.
2. Scroll to the very bottom: the last item and its buttons are fully visible and tappable, with the bar showing and with it hidden.
3. **Quick flick:** the bar hides at the first movement and returns about 200 ms after momentum scrolling stops, not while the page is still gliding.
4. **Slow drag:** the bar stays hidden for the whole drag and returns 200 ms after the finger stops.
5. The page content never shifts when the bar slides in or out.
6. With Settings › Accessibility › Motion › Reduce Motion on, the bar appears and disappears without sliding.
7. With a keyboard connected, tabbing into the bar keeps it visible.
8. On the home screen web app (Add to Home Screen) and in landscape, steps 2 to 4 still pass.

**Accessibility (Agreed, required for launch).** Target: WCAG 2.2 AA.

- **Real controls.** Anything tappable is a real `<button>` or `<a>` link, never a clickable `<div>` or `<span>`. A whole card that opens a Stack makes its title the link and stretches the link's tap area over the card, so the Like, Save and Share buttons inside stay separate buttons.
- **Names for icon buttons.** Every icon-only control has a spoken label ("Back", "Share profile", "Save", "Move up", "Delete item" and so on). Toggles are switches that announce on/off; tab rows announce which tab is selected.
- **Keyboard.** Everything works with Tab, Enter and Space. A visible focus ring (3 px pink outline) shows on keyboard focus only. Sheets and dialogs keep focus inside while open, close with Escape, and return focus to the button that opened them.
- **Screen readers.** Toasts and save status are announced politely. Photos have alt text; decorative emoji and wallpaper are hidden from screen readers. Every input has a label, not just a placeholder.
- **Touch targets** are at least 44 × 44 px, including the small pin and send buttons (their visible circle can stay 28 px with a larger invisible hit area).
- **Contrast.** Text meets 4.5:1 (3:1 for large text and icons), including gray subheadings and text on theme colours.
- **Reduce Motion** turns off the wallpaper drift, slides and other animation.
- **Text size.** Layouts hold up when the phone's text size is set to 200%.
- **Prototype status:** the design now has keyboard access, labels, focus rings, announced toasts and Reduce Motion. Its clickable `<div>`s use button roles as a stand-in; the live app uses real buttons and links as above.

**QA before launch (accessibility).** VoiceOver on iPhone: create, publish, share and pin a Stack without looking. Keyboard only on desktop: the same tasks. Run an automated checker (axe) on every screen, and check contrast on all 12 theme colours.

**Desktop and tablet layout (designed).** Same features, styling and rules as mobile; only the layout changes. See the "Stack Desktop - Party Mode" page in the design.

| Width | Navigation | Content |
| --- | --- | --- |
| Under 768 px (phone) | Bottom bar (rules above) | Mobile screens as designed |
| 768–1023 px (tablet) | Left rail with icons only (72 px) | Single centered column, max 680 px |
| 1024 px and up (desktop) | Left rail, 232 px: logo, Home, Explore, Inbox (badge), Profile, yellow **Create a stack** button, your account at the bottom | Main column plus a right sidebar where listed below |

- **Stack page:** theme banner across the top with the emoji wallpaper and Back; the Stack card (max 680 px) overlaps the banner; a 300 px right sidebar stays in view while scrolling, holding Share, Remix and the Like / Save / Repost / Comments counts, the author card with Follow, and "More from {name}". The left rail shows on Stack pages on desktop (it's hidden on phones).
- **Profile:** large photo, name, handle, counts, bio, Follow / Connect / Share in one header row; the Asking card sits to the right; tabs below; Stacks and Buckets in a 3-column grid of cards.
- **Home:** feed column (max 640 px) with For you / Following at the top; the right sidebar holds the bucket list (progress, to-do items with status chips, Open bucket list) and People to follow.
- **Explore:** search bar, Trending as 3 cards across, Categories as a 4-column grid showing 8 tiles plus "More categories · 4 more" (phones show 6 plus 6).
- **Sheets become centered dialogs** (max 480 px wide) on tablet and desktop. The share sheet, sign-in, pin, report and confirm sheets open as dialogs over the current page. The Create flow is a full page on every size (see Build handoff).
- **Hover:** cards and main buttons lift slightly with a deeper shadow (off with Reduce Motion). All page links are real links, so middle-click and Cmd/Ctrl-click open a new tab.
- **Document scroll:** pages scroll as normal documents on every size; the left rail stays fixed on desktop.

## Stack lifecycle at a glance

A Stack is private to its owner until Publish. After that, every saved change is live at once on the same link.

&#91;embedded content: Stack lifecycle · draft, three visibilities, edit, delete\]

| Moment | What the owner sees | What others see | Existing shared link |
| --- | --- | --- | --- |
| Drafting (Flow 1) | Draft in Profile › Drafts, autosaved | Nothing | None exists yet |
| Publish (Flow 1) | Published screen, Stack on profile | Depends on visibility, from that moment | Created: `/{handle}/{slug}` |
| Editing, not saved (Flow 2) | Edit draft in Drafts | The last saved version | Shows the last saved version |
| Save changes (Flow 2) | Updated Stack, no feed bump | New version on next load | Same link, new content, even if the title changed (D-1) |
| Share update (Flow 2) | Stack moves to the top of the profile | Stack returns to the top of feeds with the note | Same link |
| Public to Unlisted (Flow 2) | Pill shows Unlisted | Gone from profile, feeds and search | Still works |
| To Private (Flow 2) | Pill shows Private | Gone everywhere; saves and reposts hidden until it's visible again; pins keep their text (D-2) | Shows the unavailable page |
| Delete (Flow 2) | Gone | Gone; pins stay in people's bucket lists without a Stack | Shows the unavailable page |

## Flow 1: Create and publish a Stack

A signed-in user turns an idea into a published Stack in four steps: Title, Description, Build, Finalize. Nothing is visible to anyone else until Publish succeeds.

**Who and where.** Any signed-in user. Entry points: Create (+) in the nav bar; "Answer with a stack" on an ask (Flow 9); opening a draft from Profile › Drafts or Manage stacks › Drafts; Remix (see C-4). Signed-out users get the sign-in modal first and land in step 1 after signing in.

**Step 1: Title.** Prompt "Name your Stack", up to 60 characters, one line. **Next** (or Enter) goes to step 2. **Skip** appears when empty and also goes to step 2; the title stays "Untitled Stack" until Publish asks for one. The progress bar shows 1 of 4.

**Step 2: Description.** Optional, up to 160 characters with a live counter. **Next** / **Skip** / Enter goes to Build. Tapping the title above goes back to step 1.

**Step 3: Build.** The editor opens with one empty numbered pick focused. The header shows the step, a line count ("5 lines · 2 links") and a save status.

- **Format menu (the + by the current line):** Section, Numbered, Bulleted. There are no paragraphs, bold lines or other free text blocks (Agreed content rules). Enter on an item adds another item of the same format; Enter on an empty item leaves it.
- **Toolbar above the keyboard (Agreed order):** Section, Numbered, Bulleted, Link, Tags. Bold is removed because items have no rich text; the item heading is already bold. Tags is disabled until an item is selected.
- **Tags tray:** shows the selected item, its tags, the 5 suggested tag groups, and a "Your own" field for a typed tag (up to 20 characters). Up to 3 tags per item; Price allows one value. At 3, the other tags dim and the field says "This item has 3 tags. Remove one to add another." A typed tag over 20 characters shows "N/20 · N over. Shorten it to add." and can't be added. Tapping a chosen tag removes it.
- **Link sheet:** Add link takes a URL (≤2,048) and an optional display name (≤40). A pick can have up to 2 links, each shown as its own button; at 2, Link says "A pick can have up to 2 links. Remove one to add another." A full web address (starting with https://, http:// or www.) written or pasted into a pick's heading or subheading also becomes one of its links once it's finished; a plain name such as "fuunji.jp" stays text (Agreed Nov 26). On save the line shows "Fetching link…" and then the page title and site icon. Proposed default: if fetching fails within 6 seconds, show the domain as the title. Edit link allows Remove. A URL without a scheme gets https:// added.
- **Edit (top right, once there is content):** opens Reorder or Delete mode. Reorder shows up and down arrows on every line and subsection; Delete shows a delete control with a 5-second **Undo** toast. **Done** leaves edit mode.
- **Limits:** see Content rules. Each item has a heading and an optional subheading field. Counters appear at 80% of a field's limit; past it they turn red and say how many characters over, e.g. "heading 84/80 · 4 over". Text is never cut off or blocked while typing; publishing is blocked until it fits. Line breaks typed or pasted into any field become spaces. At 15 items, Add item reads "15 of 15 items · remove one to add another" and adding is blocked; at 5 sections, adding a section shows "A Stack can have up to 5 sections."
- **Review** (bottom, labeled Finalize) goes to step 4. It is disabled until there is at least one item.

**Step 4: Finalize.** One screen with an **Arrange** and a **Preview** toggle.

- **Theme card (Agreed):** an emoji and colour suggested from the title ("Suggested from your title. Tap to change."). Twelve emoji and six colours to choose from; once changed it says "You picked this theme."
- **Is this about a place? (Agreed):** Yes/No. It defaults to Yes when the title or emoji suggests a place. Yes requires a city (≤80 characters), shown on the Stack and used in search. The hint reads "A city is required for place stacks." (D-6).
- **Who can see this stack:** Public (default), Unlisted, Private, each with its one-line description.
- **Category tags:** pick 1 or 2 of the 12 platform categories (Agreed list; the mockup's free-typed tags are replaced). Publish requires at least one (Proposed default). These feed Explore and search.
- **Arrange:** move subsections and picks up and down.
- **Preview (Agreed):** shows the Stack exactly as visitors will see it, with theme, emoji wallpaper, tag chips and pick numbers.
- **Back to Build** returns to step 3 with everything kept.

**Publish.** In order, the checks are:

1. Any content-rule problem: go to Finalize and show a red box "Fix N things before publishing:" listing each one (e.g. "Title is 8 over 60 characters.", "“Roma Norte” has no items. Add one or remove the section.", "Item 3 heading is 4 over 80 characters."). Publish stays disabled until the list is empty.
2. Place stack with no city: stay on Arrange, highlight the city field, toast "Add a city to publish this place stack."
3. No title: a sheet asks for one; Publish in the sheet is disabled until it has text.
4. Send to server. On success go to the Published screen; on failure stay on Finalize with "Couldn't publish. Check your connection and try again." (Proposed default) and keep everything.

The Publish button looks disabled while check 1 or 2 fails and shows the reason under it.

**Published screen.** Confirms the Stack is live and offers **Share** (opens Flow 4), **Start another stack**, and **Done** (goes to Profile › Stacks with the new Stack at the top). Publishing a draft deletes that draft.

**What is saved and when.**

- Agreed (C-2): from the first character typed, the work is autosaved to a server-side draft about 1 second after each change. The status reads "Saving…", then "Saved just now"; if saving fails it reads "Not saved · Retry".
- **Close (X):** with no content, leave without a draft. With content, keep the draft, go to Profile › Drafts, toast "Draft saved".
- **Refresh or closing the tab:** reopening `/drafts/{id}` restores the draft at the step it reached. Anything typed in the last second before closing may be lost; show the browser's leave warning only while a save is pending.
- **Visibility to others:** none until Publish. After Publish: Public appears at once on the profile, in followers' Following feed, in For you, Explore and search; Unlisted only by link; Private only to the owner.

**Test examples.**

- Create "Late-night tacos in CDMX" with 3 numbered picks, tag one "Late night" and `$`, choose Place = Yes, leave city blank, tap Publish. Expect: no publish, city field highlighted, toast about the city. Add "CDMX" and publish: Stack appears first on Profile › Stacks and in a follower's Following feed.
- Skip the title, add one pick, tap Publish. Expect the title sheet; Publish there stays disabled until a title is typed.
- Type 3 picks, refresh the page. Expect the same 3 picks back from Drafts, at the Build step.
- Try to add a fifth tag to a pick. Expect it to be dimmed and not selectable.

## Flow 2: Change a published Stack (edit, visibility, delete)

The owner can edit, re-share, change visibility or delete a Stack at any time. Saved edits are live everywhere at once, including on links already shared.

**Who and where.** The owner only. Entry points:

- On their own Stack detail, the visibility pill ("Public ▾") opens the Stack settings sheet.
- In Manage stacks, each row's visibility pill opens the same sheet. The row's share icon opens Flow 4.
- A saved edit draft in Profile › Drafts or Manage stacks › Drafts reopens the editor with those edits.

**Stack settings sheet.** Title of the Stack; **Edit stack**; "Who can see this stack?" with Public, Unlisted and Private; **Delete stack**.

### Edit

**Edit stack** opens the editor at Build with the published content, theme, place and city, visibility and category tags. All Flow 1 tools and limits apply. The header status reads "No changes yet" until something changes, then "Unsaved changes". Two buttons replace Publish:

- **Save changes.** Validates like Publish (at least one pick with text; city if a place stack; title required). On success the live Stack is replaced, updatedAt is set, the user returns to the Stack detail, toast "Changes saved". It does not move the Stack in any feed.
- **Share update.** Only for Public Stacks, at most once every 7 days. Opens a sheet for an optional note (≤40 characters, e.g. "Added 3 new bars"). Confirming saves the changes, puts the Stack back at the top of followers' feeds with an "Updated: note" banner, moves it to the top of the owner's profile (below a featured Stack), and toasts "Update shared to the feed". When blocked, the button is greyed and explains why: "Only public stacks can share updates." or "Share again in N days. Updates can be shared once every 7 days."

**Backing out.** Closing the editor with no changes returns to Manage stacks. Closing with changes keeps them as an edit draft ("Unsaved edits to a published stack") and toasts "Changes saved as a draft". The published Stack does not change until Save changes or Share update. Refreshing restores the edit draft (same autosave as Flow 1).

**What other people see after a save.**

- The shared link and in-app detail show the new version on their next load. Proposed default: a visitor with the page open sees the old version until they reload; no live push.
- Likes, saves, comments, reposts and remix counts stay with the Stack.
- Pins on picks that still exist follow the pick, even if it moved or its text changed, because pins use the pick's stable id (C-1).
- Pins on a deleted pick stay in the pinner's bucket list with the pick's last text, but no longer open or expand into a Stack (Agreed, D-3).
- If the title changes, the link does not; the slug stays as it was at first publish (Agreed, D-1).

**Loading and error states (designed).** One rule across the app: never lose the user's work, say plainly what failed, and offer one retry.

- **Loading.** Feed and Stack detail show gray placeholder cards (skeletons) in the shape of the real content until it arrives. The Back button stays usable while a Stack loads.
- **Video rendering.** Tapping TikTok, Reels or Save video shows "Making your video… N%" with a progress bar in the share sheet. If it fails: "Couldn't make the video. Check your connection and try again." with Try again. The sheet stays open.
- **Autosave fails.** The editor's status turns into a red "Not saved · Retry" pill. Edits stay on the device; tapping it retries. Autosave keeps retrying on its own when the connection returns.
- **Publish fails.** A sheet: "Couldn't publish. Your stack is safe as a draft. Check your connection and try again." with Try again and Keep editing. Saving changes to a published Stack uses the same sheet with "Couldn't save your changes. Your edits are safe here."
- **Two devices.** Saving checks the version the edit started from. If the live Stack changed since then: "This stack changed on another device. You edited it somewhere else after you started here. Saving now replaces that version with this one." with Replace with my version and Cancel and keep editing. Last save wins only after this confirmation.
- **Prototype only.** Settings has a "Prototype only · Network" switch (Normal, Slow, Offline, Edited elsewhere) to preview these states. It is not part of the product.

### Change visibility

Tapping a different option applies at once and closes the sheet.

| Change | Toast (Agreed copy) | Effect |
| --- | --- | --- |
| To Public | Now public | Appears on the profile, in feeds, Explore and search. Proposed default: it does not count as a new post in feeds; use Share update for that. |
| To Unlisted | Now unlisted · anyone with the link can view | Removed from the profile, feeds, Explore and search within one refresh. Links keep working. |
| To Private | Now private · shared links no longer work | Links show the unavailable page (Flow 3). Other people's saves and reposts are hidden, not deleted, and return if it's made Public or Unlisted again. Their pins keep the pick's text but can't open the Stack (Agreed, D-2). |

When the user tries to share a Private Stack from anywhere, the settings sheet opens instead, with the note "This stack is private. Make it public or unlisted to share it."

### Delete

**Delete stack** changes to "Tap again to delete" on the first tap; the second tap deletes. If the user is on that Stack's detail, they go back one screen. Toast "Stack deleted". The Stack disappears from the profile, Manage stacks, feeds, search, other people's Saved and Reposts, and featured status is cleared. Its link shows the unavailable page. Other people's pins on its picks stay in their bucket lists, with no Stack to open (Agreed, D-3).

Drafts are deleted from Profile › Drafts or Manage stacks › Drafts with **Delete**. Proposed default: show a 5-second Undo toast, because today it is instant and has no undo.

**Test examples.**

- Edit a Public Stack's third pick and tap Save changes. A visitor reloading the shared link sees the new text; the Stack does not jump to the top of the feed.
- Tap Share update twice within a week. The second time the button is greyed with "Share again in N days".
- Make a Stack Private. Its link in a signed-out browser shows the unavailable page, and it is gone from Explore search.
- Edit, then close without saving. The live Stack is unchanged and Manage stacks › Drafts shows "Unsaved edits to a published stack".

## Flow 3: Open a Stack as a visitor (shared link or in-app)

A Stack link, for example `stack.app/renata.diaz/mexico-city-bars`, always shows the latest saved version of the Stack, if the viewer is allowed to see it.

**Who and where.** Anyone, signed in or not. Entry points: a link in a bio, caption, message or browser; tapping a card in Home, Explore, search, a profile, Saved, Reposts, Inbox or a pin.

**Which layout (Agreed, D-4).** Signed-out visitors and anyone arriving from outside the app get the **link page** layout from the share design. Signed-in users and in-app taps get the **Stack detail** layout. Both read the same data at the same URL.

### Link page (web, signed out)

1. Header in the Stack's theme: emoji, colour, title, author name and handle, description, "N picks".
2. Tag filter chips: All plus every micro-tag used in the Stack. Tapping a chip filters picks and shows "N of M picks"; tapping it again clears the filter.
3. Picks in order with section labels, number, name, note and first tag. A pick with a link is a tappable row that opens its first link in a new tab; a pick without one shows "No link".
4. Call to action "📌 Save these picks to your bucket list · Free on stack · check them off as you go". Tapping it opens sign-in; after sign-in the visitor lands on the Stack detail.
5. Footer "made with stack" links to Home.

Unlisted Stacks show "Unlisted: only people with this link can open the page." Unlisted and Private pages are marked noindex. Link preview image (designed; the share sheet's Link page tab has a "Link page / In a text" switch to see it): a 1200×630 image in the Stack's theme colour with the emoji wallpaper, the big emoji, a "N picks" badge, the title (2 lines max), the author's avatar and handle, and the stack. wordmark. The link title is "{emoji} {title}"; the link description is the Stack's description, or "N picks by @handle" when there is none. No pick names appear in the preview, so people open the link to see them. Public and Unlisted links get the same preview (anyone holding the link can open the page anyway). Private or deleted Stacks get a plain stack. image with "This stack isn't available" and no title. The image is regenerated when the title, emoji or theme changes, and its URL carries the Stack's version so chat apps don't keep a stale copy. Profile and Public bucket links use the same layout: profile shows photo, name, handle and Public stack count; bucket shows emoji, name, item count and owner. Every preview of a Stack (video frames, link page, link image) keeps the original's text weights: pick text is regular except words the author made bold, subheadings are regular, and handles are regular.

### Stack detail (app)

- **Top:** Back. The owner sees the visibility pill (Flow 2); everyone else sees a ⋯ button with Report this stack and Block @handle (Flow 8).
- **Header strip:** emoji wallpaper in the theme colour, "🍸 7 picks", title, author (opens their profile) with Follow / Following, an "Updated: note" banner if one was shared, and the description.
- **Tag filter:** chips for the tags used, with "Filter by tag, or tap any tag on a pick". Filtering shows "Showing N of M · tag". Owners see "Your tags. Viewers can filter by them."
- **Each pick** shows all its tags (Agreed: full tags only in the expanded view) and two small round icon buttons side by side at the bottom right of the row (Agreed). Tag chips are flat, borderless labels; the action buttons are round, outlined and shadowed, so the two never look alike:
  - **📌 Pin:** pin icon button; opens the pin sheet to add the pick to a bucket (Flow 6). Once pinned, the icon fills in and a small badge shows the bucket's emoji; tapping it again moves or removes the pin. Its label names the bucket, e.g. "🎤 2026 Concerts".
  - **📨 Send:** opens the send sheet (Flow 9).
- **Bottom bar:** Like (count), Save (count), Repost (count), Remix (non-owners only, when the owner allows it; Flow 8), Comments (count), Share. Comments opens a panel with the thread, "No comments yet · Share a tip, a favorite, or what you'd add." when empty, and an input with Post.
- Opening a pin or notification scrolls to that pick and highlights it briefly.

### Access rules

| Situation | What the visitor sees |
| --- | --- |
| Public or Unlisted | The Stack. |
| Private, viewer is not the owner | Unavailable page: "This stack isn't available. It may be private or deleted." with a link to the owner's profile if that is visible. In-app taps show the toast "This stack is private. Only its owner can view it." |
| Deleted | Same unavailable page (Proposed default; one message, so privacy isn't revealed). |
| Owner blocked the viewer, or viewer blocked the owner | Unavailable page. |
| Owner opens their own link | Stack detail with owner controls, at any visibility. |
| Old username after a username change | Redirect to the same Stack at the new username (Agreed, D-1). A title change never changes the link. |
| Private again made Public or Unlisted | The same link works again. |

Visiting never requires an account. Every action that writes data triggers the sign-in modal, then completes (Global rules).

**Test examples.**

- In a signed-out browser, open an Unlisted Stack's link. Expect the link page with the Unlisted note; the Stack is not in Explore or on the owner's profile.
- On the link page, tap the "Late night" chip in a 7-pick Stack where 2 picks have it. Expect "2 of 7 picks".
- Signed out, tap 📌 Pin on a pick, then sign in. Expect the pin sheet to open for that same pick.
- Make a Stack Private, then open its old link. Expect the unavailable page with no title or content shown.

## Flow 4: Share a Stack (Reels/TikTok video or link page)

Share turns a Stack into either a vertical video for Reels/TikTok or a link-in-bio web page, both in the platform's style (Agreed). Sharing never changes the Stack or its visibility.

**Who and where.** Anyone who can see a Public or Unlisted Stack; sharing doesn't require sign-in (Proposed default). Entry points: Share on a feed or Explore card, Share on Stack detail, Share on the Published screen, the share icon in Manage stacks, "Share the whole stack instead" in the send sheet. For a Private Stack the owner gets the Stack settings sheet with "This stack is private. Make it public or unlisted to share it."; nobody else can reach a Private Stack.

The share sheet opens on **🎬 Reels / TikTok**; a segmented control switches to **🔗 Link page**. Close (×) dismisses it.

### Reels / TikTok

- **Frames:** a cover (theme, emoji wallpaper, title, author, pick count), then list frames of 5 picks each, then an end card ("Every pick + every link · Tap the link in my bio to open the full stack · 🔗 link"). Each frame lasts 2.5 seconds; the sheet shows e.g. "4 frames · 10s · 1080×1920".
- **Layout (Agreed):** list frames start at the top like any other frame. A last frame with fewer picks is shorter; it is not stretched or padded to fill space.
- **Show safe zones / Hide safe zones:** overlays the areas covered by app buttons and captions ("App buttons + caption cover this"). The overlay is never in the exported video.
- **Copy caption:** copies "{title} {emoji} {N} picks, full list + links in bio. #stack #{slug} #{up to 2 tags}". Toast "Caption copied".
- **TikTok / Reels / Save video:** render the MP4. Proposed default: TikTok and Reels hand the file to the device share sheet where the browser supports it; otherwise the file downloads with a toast telling the user to upload it in the app. Save video downloads it. While rendering, the buttons show progress; on failure, "Couldn't make the video. Try again." The sheet closes on success.

### Link page

- Shows a live preview of the page visitors get (Flow 3), including the tag filter chips.
- The link field shows the Stack URL with **Copy** (toast "Link copied · {url}").
- **Open page** opens the URL in a new tab. **Add to bio** copies the link, closes the sheet and toasts "Link copied. Paste it into your bio".
- For Unlisted Stacks the preview shows 🔒 by the URL and the note "Unlisted: only people with this link can open the page."

**What is saved.** Nothing about the Stack. Proposed default: log a share event (format, stack, user if signed in) for analytics only; it isn't shown to anyone.

**Test examples.**

- Share a 12-pick Stack as a reel. Expect 5 frames (cover, 5 + 5 + 2 picks, end card), 12.5s, and the 2-pick frame starts at the top with empty space below.
- Switch to Link page and tap Add to bio. Expect the URL on the clipboard, the sheet closed and the toast.
- As the owner of a Private Stack, tap Share. Expect the Stack settings sheet with the private-stack note, not the share sheet.

## Flow 5: Discover Stacks (Home feed, Explore, search)

Home is where people see what to do next and what friends posted. Explore is where they find new Stacks and people. Both show Public Stacks only.

**Who and where.** Anyone. Home is the default screen; Explore is the second nav item.

### Home, top to bottom (Agreed order)

1. **Header:** "stack" wordmark and a "✅ 14 done" chip showing how many bucket list items the user has checked off. Tapping it switches the bucket list to its Done view. Signed-out users don't see the chip.
2. **Bucket list:** Flow 6. Signed-out users see the empty-state card, and tapping it opens sign-in.
3. **Stacks:** the feed, with **For you** and **Following** tabs.

**For you.** Public Stacks from everyone, newest first by publish date or shared-update date (Proposed default). **Following.** Public Stacks from people the user follows, plus their reposts ("Renata reposted" with the repost note), newest first. Following is empty for signed-out users and new users: "Nothing here yet · Follow people whose taste you trust and their stacks land here." with **Find people** (opens Explore). Proposed default: load 20 cards at a time with infinite scroll.

**Feed card (Agreed: preview matches the detail layout).**

- Theme header strip with emoji wallpaper, "🍸 7 picks" and time ago.
- Author row (opens their profile) with Follow / Following.
- "Updated: note" banner when the owner shared an update.
- Title and description.
- The first picks, each with at most one tag in the form "Renata says ⭐ Must-do".
- "See all N lines →".
- Actions: Like, Save, Repost, Share.

Tapping the card body or "See all" opens the Stack detail. **Like** toggles and changes the count. **Save** toggles and adds the Stack to Profile › Saved. **Repost** opens the repost sheet: **Repost** ("Add to your Reposts tab") or **Repost with a note** ("What makes this one good?"), then **Repost**. If already reposted, the sheet says "You reposted this" and offers **Undo repost**. **Share** opens Flow 4.

**Comments on cards.** "View N comments" or "Add a comment" expands the thread inline with an input and **Post** (also Enter). Post is disabled while empty. Comments are up to 150 characters (Agreed); the input stops at 150. Deleting (designed): your own comment has a trash button; the Stack's owner gets a trash button on every comment on their Stack (next to the report flag on others' comments). Tapping it turns the comment into an inline confirm, "Delete your comment?" or "Remove @handle's comment? They won't be notified. You can also report it.", with Delete/Remove and Cancel. After deleting, the comment disappears, the count drops, and a "Comment deleted / Comment removed · Undo" bar shows for 5 seconds. After that it's gone for good. No placeholder is left, since comments have no replies in v1.

### Explore

- **Search bar** "Search bars, books, gear, people…". Typing then submitting runs a search. While there's a search term or a category is open, a round **Back** button sits to the left of the search bar (no Cancel button on the right); Back clears the search and returns to Explore.
- **With no search:** topic chips (the first 6 categories, then a dashed "More categories" chip that opens the full grid and scrolls to it); Recent searches (up to 5, newest first, each removable with ×, plus **Clear**); 🔥 Trending this week (4 most-liked Public Stacks, not the user's own); Categories (6 tiles shown first (Food & Drink, Travel & Places, Art & Design, Technology, Learning, Home & Living), then a "More categories · 6 more" button that reveals the other 6 (Style & Shopping, Entertainment & Culture, Health & Wellness, Business & Money, Sports & Outdoors, Games & Hobbies) and turns into "Fewer categories", each showing two sample titles, or "Nothing here yet · Be the first to add one"); Recently added (4 newest Public Stacks).
- **Search results:** Public Stacks whose title, author name, handle or category tags contain the term, shown as feed cards with "N stacks". With no matches: "No results for “term” · Try a different word, or browse a topic instead." Tapping a topic chip or category tile shows that category's Public Stacks.

**Saved.** Likes, saves, reposts, follows and comments save straight away. Recent searches are stored per user (signed out: on the device only). Pull to refresh reloads the feed. Proposed default: Explore lists refresh on each visit.

**Test examples.**

- Follow Renata, who reposted a Stack with a note. Expect the repost in Following with "Renata reposted" and the note.
- An Unlisted Stack by someone the user follows must not appear in Following, For you, Trending, Categories, Recently added or search (see C-5).
- Search "mezcal" with no matches. Expect the no-results message and the term added to Recent searches.

## Flow 6: Pin picks to the bucket list and check them off

Any pick in any visible Stack can be pinned into one of the user's buckets, given a status, and checked off. The bucket list tracks to-do and done items separately (Agreed).

**Who and where.** Signed-in users (others get sign-in first, then the sheet opens). Entry points: 📌 Pin on a pick in Stack detail; 📌 Pin it on a pick card in Inbox › Messages. There is no Did it button on Stacks (Agreed): picks are checked off only from the bucket list.

### Pin sheet

- **Heading:** "📌 Add “Black Coffee”" and "from Concerts worth flying for in 2026 by Dani".
- **Add to list:** a chip for each bucket. The selected chip is filled and offset. Default selection: the pick's current bucket, else the last bucket used, else the first.
- **＋ New list:** turns into an inline name field ("e.g. 2026 Concerts", up to 40 characters) with **Create**. Create adds the bucket (emoji suggested from the name, else ⭐; colour assigned) and selects it. Create is disabled while the name is empty.
- **Status** (one choice, chips): 🏃 In progress, 📅 This week, 🎉 This weekend, ⏭️ Next week, 💭 Someday. Default: the current status if pinned, else Someday. Statuses are action-based labels only; nothing is scheduled and no reminders are sent (Agreed).
- **Primary button:** "Add to 🎤 2026 Concerts" for a new pin, "Save · 🎤 2026 Concerts" for an existing one. It is disabled ("Pick a list") when the user has no buckets.
- **Remove from bucket list:** shown only when the pick is already pinned.

Toasts: "Added to 🎤 2026 Concerts", "Moved to …", "Removed from your bucket list". Closing the sheet (× or tapping outside) doesn't pin anything. Proposed default: a bucket created in the sheet is kept even if the sheet is then closed, because the user named it on purpose.

After pinning, the pick's button in Stack detail shows its bucket, e.g. "🎤 2026 Concerts"; tapping it reopens the sheet to move or remove the pin.

### Check off

- **Checking off use**s the checkbox next to an item on Home, Profile › Buckets or the bucket page. It marks the pick done today, moves it to Done, updates the header chip and progress bar, and toasts "Checked off ✓".
- **Undo:** tapping a done check (✓ Done Nov 24, or the green tick in Done or Buckets) unchecks it (toast "Moved back to to do") and puts it back in its bucket as to do.

### Bucket list on Home

Header "✅ Bucket list" with "9 to do · 14 done" and a progress bar "14 / 23". Three views:

- **My lists** (default): horizontal cards, one per bucket, showing only to-do items (4 shown, "+N more" / "Show less"). Each card shows emoji, name, "N to do · M done" and **Edit** (Flow 7). Items show the pick, "from {Stack} · {author first name}" and a status chip. Tapping the chip opens the status sheet (below). An **Unsorted** card collects pins without a bucket. A dashed **＋ New list** card ends the row.
- **By when:** (the tab is labeled By status) groups In progress, This week, This weekend, Next week, Someday, each listing items with their bucket and Stack.
- **Done:** checked-off items grouped by month, newest first, with the date.

Tapping an item opens its Stack scrolled to that pick. Empty states: no pins at all shows "Open a stack and tap 📌 Pin on anything you want to do. Check it off when you do it."; everything done shows "🎉 Everything pinned is done. Pin something new from any stack."; Done with nothing shows "Nothing checked off yet."

**Status sheet (Agreed, designed).** Tapping any item's status chip (Home or Profile › Buckets) opens "from {Stack}" and the pick's name over six tiles: 🏃 In progress ("Started, not finished"), 📅 This week, 🎉 This weekend, ⏭️ Next week ("On deck"), 💭 Someday ("No rush"), and ✅ Done ("Checked off!"). Tapping a tile applies it at once, closes the sheet and toasts the status. Choosing Done checks the item off; choosing any other status on a done item moves it back to to do with that status.

**No reminders (Agreed).** Statuses don't schedule anything. Nothing is sent to Inbox, push or email, and nothing changes on its own when a week passes; the user moves items between statuses.

**Saved and visible.** Pins, buckets, statuses and check-offs save to the server at once and sync across devices. Others see a pin only through a bucket the owner has made Public or Unlisted (D-7, Flow 7); those buckets show each pick's status (Agreed) as a read-only chip (🏃 In progress, 📅 This week, 🎉 This weekend, ⏭️ Next week, 💭 Someday, ✅ Done) on the bucket page and in the profile's Buckets tab. Only the owner can change a status. Unsorted pins and Private buckets are always private. Pinning notifies the Stack's creator (Agreed): Activity shows "June pinned “Cheap monitor riser” from Desk Setup Under $50" with a pin badge, and Activity has a Pins filter. Pinning your own pick sends nothing. If the creator deletes the pick or the whole Stack, the pin stays with the pinner: it keeps its last text and can still be checked off, shows no source line at all (Agreed: just blank). Tapping it opens a preview sheet with the full item as it was saved (heading, subheading, tags and link, but not the Stack) and a note: "🫥 The stack this came from isn't available anymore. It was deleted or made private. This pick stays on your list: you can still change its status or check it off." The owner also gets Remove from bucket list; everyone gets Got it (designed). The same applies while the Stack is Private. The app saves a copy of the pick's heading, subheading, tags, link, Stack title and author when the pick is pinned and again when its Stack is deleted, so the text survives.

**Test examples.**

- Pin "Dua Lipa" from Dani's Stack, create "Festival weekend" in the sheet, then select 2026 Concerts and add. Expect the toast "Added to 🎤 2026 Concerts", the item on that Home card, and the Festival weekend bucket kept empty.
- With 14 done, check off a pick. Expect the header chip to read "✅ 15 done" and the item to move to Done.
- Uncheck a pick done in August. Expect it to leave Done, return as to do in its bucket, and the done count to drop by one.

## Flow 7: Manage buckets

Buckets are the user's own mini lists, such as "2026 Concerts", which start empty and fill with picks from anyone's Stacks (Agreed). The user decides their name, emoji and colour.

**Who and where.** The signed-in owner. Entry points: **＋ New list** card on Home; **＋ New bucket** on Profile › Buckets; **Edit** on any bucket card (Home or Profile); **＋ New list** inside the pin sheet (Flow 6).

### Bucket editor sheet

- Live preview of the bucket header (emoji, name, colour).
- **Name:** "Name your list", up to 40 characters.
- **Emoji:** a grid of 16.
- **Color:** 6 swatches.
- **Create** (new) or **Save** (existing). Disabled while the name is empty. Proposed default: names don't need to be unique.
- **Delete list** (existing buckets only): "Its picks stay in your bucket list under Unsorted." Proposed default: deleting asks to confirm with a second tap, like Delete stack, because it reorganises many items.

New buckets get a suggested emoji (from the name, else ✨) and the next colour in the set. Closing the sheet without Create or Save discards changes.

### Order, pinning and editing items (Agreed)

- **Bucket order:** pinned buckets first (most recently pinned on top), then every other bucket newest first. A new bucket appears right below the pinned ones. The same order is used on Home, Profile › Buckets, the pin sheet and public profiles.
- **Pin to top:** a pin icon on each bucket card header, next to Edit, toggles pinning. Toasts: "📌 Pinned to the top" / "Unpinned". Any number of buckets can be pinned. Unsorted can't be pinned.
- **Items in the editor:** existing buckets list their items as To do, then Done. Each row has up and down arrows (within its group) and a remove button. Changes apply only when the user taps **Save**; closing the sheet discards them. The sheet notes "N removed · saved when you tap Save".
- **Removing an item:** a to-do item leaves the bucket list. A done item leaves the bucket but stays in the Done history (Proposed default).
- **Item order** is kept per bucket and used on Home, Profile › Buckets and the bucket page. Newly pinned picks appear at the top of their bucket's to-do items (Proposed default).

### Profile › Buckets tab

The full view of every bucket, unlike Home, which shows only what's left:

- Summary "4 buckets · 14 done" and **＋ New bucket**.
- One full-width card per bucket: emoji, name, "3 to do · 6 done", a progress bar, **Edit**, then to-do items followed by done items (ticked and struck through). Five shown, "+N more" / "Show less".
- An Unsorted card when needed (no Edit).
- Checking and unchecking work exactly as in Flow 6.
- Empty bucket: "Empty for now. Tap 📌 Pin on a pick in any stack and choose this bucket."

On the owner's own profile the tab shows every bucket. Visitors see only Public buckets (see Bucket visibility below).

### Bucket visibility (Agreed, D-7)

Each bucket has the same three settings as a Stack, chosen in the bucket editor under "Who can see this bucket?". New buckets start **Private**.

| Visibility | Who can open it | On the profile |
| --- | --- | --- |
| Public | Anyone | Yes, in a Buckets tab on the public profile |
| Unlisted | Anyone with the bucket's link | No |
| Private | Only the owner | No, and no sign it exists |

- **Link:** `/{handle}/buckets/{slug}`, with the same rules as Stack links: the slug is fixed when the bucket is first made non-private, and old usernames redirect (D-1).
- **What visitors see:** emoji, name, colour, "N to do · M done", and each item with its pick, "from {Stack} · {author}", a done tick, and a read-only status chip (Agreed: statuses show on Public and Unlisted buckets). Unsorted is always private.
- **Items always stay** (Agreed). An item keeps existing, for the owner and for visitors, whatever the original Stack's owner does: deleting the pick or Stack, or making it Unlisted or Private. Counts include it. The only thing that changes is whether it can be tapped to open the original Stack.
- **Tapping an item** opens the source Stack at that pick, where the visitor can pin it to their own bucket, but only if the viewer can open that Stack. Otherwise the item shows its saved text, "from {Stack} · {author}" without a link, and is not tappable (Agreed).
- **Discovery:** Public buckets show on the owner's profile. Proposed default: they're not in feeds, Explore or search in v1, because none of those surfaces has a bucket design yet.
- **Changing visibility** follows the Stack rules: Private makes the link show the unavailable page, Unlisted removes it from the profile, and making it Public again brings it back.
- **Sharing a bucket:** the design has no share action. Proposed default: a Copy link button in the bucket editor when the bucket isn't Private.

**Saved.** Create, rename, restyle and delete save at once. The order of buckets is creation order (Proposed default; no reordering in v1).

**Test examples.**

- Create "2026 Concerts" from Home, then pin Kanye West and Dua Lipa from two different Stacks into it. Expect both on its card, each showing its own Stack and author.
- Delete "Tokyo eats" with 1 to do and 2 done. Expect all three in Unsorted, done ones still done.
- Make "2026 Concerts" Public and leave "Date ideas" Private. Open the profile signed out and expect a Buckets tab with only 2026 Concerts and no sign that Date ideas exists.

## Flow 8: Profiles, remix, settings and Manage stacks

A user's own profile shows everything they own. Everyone else sees the public profile: the other-user layout with Public content only (Agreed). There is no switch between the two.

### Own profile

**Who and where.** The signed-in owner, from Profile in the nav bar. Signed out, the tab shows "Sign in to see your profile · Create a free account to save your lists, follow people, and track your remixes." with **Sign in / Create account**.

- **Top bar:** the stack. wordmark and a share icon that opens the profile share sheet. No view toggle (Agreed, removed).
- **Header:** photo, name, @handle, "N Stacks · N Followers · N Following", bio, **Edit profile**, **Connect ▾** (dropdown of their links, "No links added yet", **Edit links**).
- **Tabs:** Stacks, Buckets (Flow 7), Saved, Reposts, Drafts (with a count badge).
- **Stacks (Agreed: no "All stacks" view; designed):** the Stacks tab itself is a dropdown. It opens on Public and reads **Stacks ▾**; tapping it again opens a menu: **🌐 Public** ("What visitors see", count, ✓ when selected), **🔒 Private & unlisted** ("Only you see this list", count), a divider, **Reorder** and **Manage stacks**. Choosing Private & unlisted changes the tab to **🔒 Private ▾** and shows one note above the grid: "Only you see this list. Unlisted stacks open for anyone with the link." Its tiles are labelled Unlisted or Private; Public tiles carry no label. There is no extra row of buttons. Reorder shows a yellow bar "↕ Reordering public stacks" (or private) with **Done**. The arrows change the order of the list on screen without changing the other list or any Stack’s visibility. The star features a Public Stack, which stays first in the Public list. Tapping outside the menu closes it. Empty: "No public stacks yet. Visitors see an empty profile until you publish one." / "No private or unlisted stacks."
- **Feature sheet (Agreed rename from "pin"):** "Feature a stack · Shows at the top of your profile. Change it anytime." Choose a Stack, add a one-line caption ("One line on why this one"), **Save**. Only one featured Stack. Proposed default: only a Public Stack can be featured; if it later becomes Unlisted, Private or deleted, it stops being featured.
- **Saved:** "Filter saved stacks" box and rows; the ◆ button unsaves. Empty: "Nothing saved yet." / "No saved stacks match."
- **Reposts:** each row shows the note, title and "Originally curated by @handle · N lines". Empty: "No reposts yet. Tap ↻ on any stack to share it here."
- **Drafts:** title, "Draft · N lines", **Delete**. Tapping opens the editor. Empty: "No drafts yet."

### Public profile: what everyone else sees (Agreed)

Anyone other than the owner who opens `/{handle}` (signed out, or signed in as someone else) gets the other-user layout: only Public Stacks, the featured Stack, Stacks and Reposts tabs, and follower counts only if the user allows them. Public buckets appear in a Buckets tab (D-7). Unlisted and Private Stacks and buckets, Saved and Drafts never appear. The owner has no preview toggle (Agreed, removed); this public profile exists for everyone else regardless, and the share sheet's Copy link gives the owner the same URL visitors use.

### Another user's profile

Back, share icon, name, handle, counts (if shown), **Follow {first name}** / **Following**, **Connect ▾**, featured Stack, and Stacks / Buckets / Reposts tabs (Buckets only when they have a Public bucket, D-7). Stack cards use the same preview style as the user's own profile (Agreed). Only that user's Public Stacks appear; Reposts show only Stacks the viewer can open (Agreed, C-5). Follow requires sign-in.

**Profile share sheet.** A profile card ("Find @handle on Stack") with **Copy link**, **Share**, **Save image**, **More**. On one's own profile it also lists **Settings and privacy** and **Log out**. On someone else's it lists **Block**, which asks "Block @handle? They won't be able to see your stacks or find your profile, and you won't see theirs. They won't be notified." with **Block** and **Cancel**. Blocking also unfollows both ways and returns to the previous screen.

### Edit profile and Edit links

- **Edit profile:** photo, name, username, bio, "Show followers and following" (stack count always shows). **Cancel** discards; **Save** validates the username (unique, allowed characters) and saves. Changing the username moves every Stack URL to the new username; old URLs redirect, and the old username stays reserved to this account (Agreed, D-1). The sheet should say so before saving (Proposed default).
- **Edit links:** X, Instagram, TikTok, Facebook (handles; a pasted full URL is reduced to the handle), email, a custom link type (Newsletter, Bookings, Website, Shop, Portfolio, Podcast) with its URL, and up to two featured websites with titles. Only filled links show. **Cancel** / **Save**. "Reset prototype data" is removed from the product (Agreed); developers may keep it in test builds only.

**Profile photo (designed).** Tapping the photo or "Add photo / Change photo" in Edit profile opens a sheet: **Choose from library**, **Take photo**, **Remove photo** (only when there is one), and Cancel, with the note "JPG, PNG or HEIC, up to 10 MB. Your photo is public on your profile." A chosen image opens **Move and scale**: a circle guide, drag to reposition, a zoom slider (1–3×), **Cancel** and **Use photo**. Use photo saves a 400×400 square crop into the Edit profile draft; it goes live only when the user taps **Save**. Files over 10 MB or unreadable images show a toast and change nothing.

### Reporting (designed)

Anyone signed in can report a Stack, a comment or an account. Signed-out users get the sign-in sheet first.

- **Entry points:** a ⋯ button at the top of someone else's Stack opens "Report this stack" and "Block @handle". Each comment that isn't your own has a small flag button. Another user's profile share sheet has **Report** next to Block.
- **Report sheet:** "Report this stack / comment / account", the item and "@handle won't know who reported it.", and one reason: Spam or scam; Harassment or hate; Nudity or sexual content; Violence or dangerous acts; False or misleading; Copyright or trademark; Something else. Details are optional (up to 500 characters) except for Something else, where they're required. **Send report** is disabled until the form is complete.
- **After sending:** "Thanks for telling us. We review reports within 24 hours and you'll get an Inbox update. @handle won't know it was you." with **Also block @handle** and **Done**.
- **Reporting the same thing again** shows "You already reported this. We're reviewing it."
- **What changes:** reporting doesn't hide the content for the reporter (Proposed default); blocking does. Review outcomes and moderation tools are out of scope for v1.

### Remix

Agreed: a remix starts with a freshly suggested theme, not the original's. Entry point (Agreed, C-4): a yellow **Remix** pill with the remix count in the Stack detail bottom bar. It opens a sheet ("Remix “Mexico City Bars”": copies picks, notes, links and tags; shows "Remixed from"; later changes to the original won't affect it) with **Start remix** and **Not now**. The new Stack shows a "🔀 Remixed from {title} by {author}" line under the author that opens the original, or reads "no longer available" when the viewer can't open it.

1. Available on Public and Unlisted Stacks whose owner allows remixing (Settings toggle), and never on one's own Stack.
2. Opens the editor at Build with the original's sections, picks, tags and category tags, title "{title} (remix)", a new suggested theme, and remixedFrom set.
3. Nothing is saved until the user edits (it then autosaves as a draft). Publishing creates an independent Stack; later edits to the original don't flow into it.
4. The original's remix count goes up and its owner gets an Activity item on publish, not on opening the editor (Agreed, C-7).

### Settings and privacy

Edit profile; Account and sign-in (renamed from "Email and password", Agreed D-8: shows the account email and linked sign-in methods); **Allow others to remix your stacks** (shown as "fork" in the mockup; rename to remix); Manage stack visibility; Blocked accounts (list with **Unblock**; empty: "You haven't blocked anyone. Block someone from the share menu on their profile."); Help center and Terms and privacy policy (designed, in-app screens; the same pages also live on the web at stack.app/help and stack.app/terms so they work signed out). Help center: "How can we help?", a search box (searches every question and answer, shows "N answers", or "No answers for …" when empty), topic chips (Basics, Sharing, Bucket list, Remix, Account, Safety), questions that expand on tap, a "Still stuck?" card with Email support@stack.app (reply within 2 business days), and links to Terms and Privacy. Terms and privacy: a Terms / Privacy switch, title, last-updated date, a short intro, "On this page" links that jump to each numbered section, and legal@stack.app at the end. The prototype wording is placeholder and must be replaced with lawyer-reviewed text before launch. The sign-in sheet's "Terms" and "Privacy Policy" words are links to these pages. **Log out** (back to Home, signed out, toast "Logged out").

**Delete account (Agreed, designed).** Settings › Account and sign-in › Danger zone › **Delete account** ("Removes your profile, stacks and buckets after 30 days").

- **Confirm sheet:** "Delete your account?", a 30-day grace period, and what will be permanently deleted: profile, photo and username; all Stacks, drafts and buckets; comments, likes, saves, reposts and messages. A note explains that others' pins of your picks stay on their lists, and remixes stay theirs without linking back to you. The user types their @handle to enable **Delete my account**; **Cancel** closes.
- **On delete:** signed out at once, toast "Account scheduled for deletion. Sign in within 30 days to keep it." From that moment, the profile, Stacks and buckets are hidden from everyone (links show the unavailable page), and the user's comments disappear.
- **Signing in during the 30 days** shows "Keep your account?" with the deletion date, **Keep my account** (everything comes back as it was) and **Continue deleting and sign out**.
- **After 30 days:** everything is erased for good. Pin snapshots others hold keep working (D-3). Proposed default: the username stays reserved for 90 days, then becomes available.
- The Privacy Policy and Help center point to this setting.

**Notification settings (Agreed, designed).** Settings › Account › **Notifications** (the row shows a summary: "Push on", "Daily email", "Weekly email" or "Off"). Everything always appears in Inbox; these settings only control what also goes to the phone or email.

- **Push notifications:** one switch, off by default. Sent right away for the types switched on below. While off, a note explains that on iPhone, Stack must first be added to the Home Screen (Share › Add to Home Screen), because iPhone Safari only allows web push for Home Screen apps. Turning it on asks the browser for permission; if the user declines, the switch goes back to off with a toast.
- **Activity emails:** Off / Daily / Weekly (default Weekly). One digest email of everything new for the types switched on; Daily is sent each evening, Weekly on Sunday, and nothing is sent when there's nothing new.
- **News from Stack:** product-news emails, off by default.
- **What to notify me about** (applies to push and email): Comments, Messages, New followers, Answers to your asks, Remixes, Pins and Likes are on by default; Reposts and Saves are off by default (Agreed).
- **Always sent, can't be turned off:** sign-in codes, account emails (like deletion) and safety emails.
- Every email has a one-tap unsubscribe link that turns off that email type.

### Manage stacks

Tabs All, Public, Unlisted, Private, Drafts, each with a count and a one-line hint. Stack rows show title, "N lines · visibility · Updated date", a visibility pill (opens Stack settings, Flow 2) and a share icon (hidden for Private). Draft rows show DRAFT, "N lines · publishes as public" or "Unsaved edits to a published stack", and **Delete**. Tapping a row opens the Stack or the draft.

**Test examples.**

- With 2 Public, 1 Unlisted and 1 Private Stack, open your own profile. Expect the Public list by default. Switch to **Private & unlisted** and expect two tiles labeled Unlisted and Private.
- Reorder the Private & unlisted list and tap **Done**. Expect the Public order and every Stack’s visibility to stay the same. Repeat from Public with no featured Stack in the test list and verify the Private & unlisted order stays the same. A featured Stack stays first in Public.
- With 3 Public, 1 Unlisted and 1 Private Stack and no Public buckets, open the profile signed out and as another signed-in user. Expect 3 Stacks and no Buckets, Saved or Drafts tabs.
- Feature a Stack, then make it Private. Expect it to stop being featured on the public profile.
- Block a user from their profile. Expect to return to the previous screen and their Stacks to disappear from Home and Explore.

## Flow 9: Asks, send picks, Inbox

These are the social loops: friends ask for recommendations, people answer with Stacks, send single picks to each other, and see activity on their own Stacks in Inbox.

### Asks (on profiles)

**Where (Agreed, D-9).** Asks live on the asker's profile, not on Home, so people visit each other's pages. An **Asking** card sits under the profile header, above the tabs, on the owner's own profile and on the public profile everyone else sees. Home no longer has an Ask the group section.

**Posting an ask (Agreed).** On their own profile, the owner taps **＋ Ask**. A sheet takes the question (up to 100 characters) and how long it stays open (1 day or 3 days), then **Post**. Proposed default: up to 3 open asks at once. With no open ask, the owner sees a dashed "Need a rec? Ask your followers." card that opens the sheet. Each open ask the owner sees has **Close** (moves it to Past asks if it has answers) and **Delete** (asks for a second tap).

**Who sees it.** Profiles are public, so anyone who opens the profile sees open asks. Proposed default: when someone posts an ask, their followers get an Inbox › Activity item ("Kenji asked: Coffee in San Juan?") that opens Kenji's profile at the ask. That is the only place it's announced; it doesn't appear in feeds.

**The card** shows the question, time left ("⏳ 3h left"), answer count, and the answering Stacks the viewer can open. Visitors see **Answer with a stack** (sign-in required). Proposed default: when an ask expires, it stays on the profile under "Past asks" if it got answers, and disappears if it didn't.

- **Answer with a stack** opens Create at step 1 with the toast "Answering Kenji: name your stack". Agreed (C-6): the draft remembers the ask. Publishing attaches the Stack to the ask, the card changes to "Answered ✓", and the asker gets an Activity item "Dani answered your ask with {Stack}". Abandoning the draft leaves the ask unanswered.
- **Private answer warning (Agreed; designed).** When the answering Stack is set to Private, tapping Publish first shows a sheet: "Kenji can't see private stacks. Your answer won't show on Kenji's ask, and Kenji won't be notified." Buttons: **Make it Unlisted and publish** (Kenji and anyone with the link can see it; it stays off profiles and discovery), **Make it Public and publish**, **Publish as private anyway** (it isn't attached to the ask), and **Back to editing**. Public and Unlisted answers publish without the warning. Test: answer Kenji's ask with a Private Stack, choose Make it Unlisted, and expect the Stack to appear under Kenji's ask and Kenji to get a notification.
- Answering your own ask isn't allowed (Proposed default).

### Send a pick

**📨 Send** on a pick opens the send sheet: "Send this pick · “Black Coffee” lands in their Inbox › Messages as a card they can open or pin." It shows a row of people (Proposed default: people the user follows who follow back, most recently messaged first). Tapping one sends at once and toasts "Sent to Kenji 📨". **Share the whole stack instead** closes this and opens Flow 4. Sending requires sign-in. A pick from a Private Stack can't be sent (Proposed default; the Send button is hidden for non-owners anyway, because they can't see it).

### Inbox

**Who and where.** Inbox in the nav bar. Signed-out users see a sign-in prompt (Proposed default). Header **Inbox** with **Mark all read**, which clears unread state in both Activity and Messages (Agreed). Tabs: **Activity** and **Messages** (with an unread badge).

**Activity.** Filter chips All, Comments, Likes, Remixes, Saves, Pins, Reposts. Items are grouped New, Today, Earlier: avatar, "Kenji liked Mexico City Bars", the comment text for comments, and time. Unread items have a tint and a dot. Tapping an item marks it read and opens the Stack; tapping the avatar opens that person's profile. A new follower appears as "Kenji started following you" under All; tapping it opens Kenji's profile. Following again after an unfollow doesn't notify twice (Agreed). Empty: "Nothing yet · When people like, save, remix, or comment on your stacks, you'll see it here."

**Messages.** A thread shows the other person ("Kenji Sato @kenji.eats"), text bubbles and pick cards. A pick card shows the Stack emoji, "Pick 2 · {Stack}", the pick and its note, with **Open in stack** (opens the Stack at that pick) and **📌 Pin it** (opens Flow 6; shows "📌 Pinned" once pinned). Empty: "Send any pick from a stack with 📨 Send." If the pick or its Stack is no longer visible to the reader, the card shows "This pick isn't available" (Proposed default). Messages opens on a thread list: each row shows the person, the last message ("You: …" for your own, "📌 {pick}" for a pick), its time and an unread dot; unread threads are tinted. Tapping a row opens the thread and marks it read. The thread header shows the person (tap for their profile); the composer says "Message Renata…", sends on Enter or the send button, and the send button is disabled while empty. A thread with no messages says "Say hi, or send Renata a pick from any stack." The Inbox badge counts unread threads plus unread Activity.

**Saved.** Read state, sends and messages save at once and sync across devices. Opening a thread marks it read.

**Test examples.**

- Kenji likes a user's Stack. Expect a New Activity item, the Inbox badge +1, and after **Mark all read** both badges cleared.
- Send "Fuunji" to Kenji. Expect a pick card in Kenji's Messages; Kenji taps 📌 Pin it, saves, and the card reads "📌 Pinned".
- Tap Answer with a stack on June's ask, then close the editor without content. Expect the ask still unanswered.

## Flow 10: Sign in, sign up, log out

Sign-in appears only when someone tries an action that needs an account, and the action they tried completes right after (Agreed pattern in the mockup).

**Who and where.** Anyone signed out. Triggers are listed under Global rules, plus Sign in / Create account on the signed-out Profile tab.

**Steps.**

1. The modal "Sign in to continue" shows the action's own message, **Sign in / Create account** and **Not now**.
2. Sign in / Create account opens one screen for both sign-up and sign-in (Agreed, D-8) with two choices: **Continue with Google** and **Continue with email**. Email asks for an address, sends a 6-digit code, and the user enters it. Google uses the standard Google consent screen. The app then checks for an account with that verified email: a returning user goes straight in; a new user chooses a display name and username (same rules as Edit profile) before continuing. **One account per email (Agreed).** Google and email codes reach the same account when the email is verified. Signing in with Google using an address that already has an email-code account (or the reverse) opens that account; it never creates a second profile.
3. On success the modal closes, the user is signed in, and the pending action runs once, e.g. the like is applied, or the pin sheet opens for the pick they tapped.
4. On failure (wrong code, expired code, network): an inline error, and the user stays in the step. Codes expire after 10 minutes (Agreed). Proposed default: 5 wrong tries lock that code; **Resend code** is available after 30 seconds. If Google sign-in is cancelled, the user returns to the sign-in screen.
5. **Not now**, closing the modal, or leaving the page: nothing happens and nothing is saved. The pending action is dropped.

**Returning later.** Sessions persist on the device until Log out (Proposed default: 90 days). A shared link opened in a new browser is visible without signing in.

**Log out** (Settings or the profile share sheet): signs out, returns to Home, toast "Logged out". Nothing is deleted; the next sign-in restores everything, because all data is on the server.

**Test examples.**

- Signed out, tap Save on a feed card, complete sign-in. Expect the Stack saved and in Profile › Saved, with no second tap.
- Signed out, tap Like, then Not now. Expect the like count unchanged.
- Sign in on a second device. Expect the same buckets, pins, drafts and done history.

## Build handoff

This section is for the coding agent. It turns the flows above into layouts, tokens, components and assets, walks one Stack through its whole life, and lists every detail the design doesn't settle. Rules elsewhere in this spec win over anything here. Design files: "Stack App - Party Mode" (phone), "Create Flow Screen Party" (editor, embedded in the phone app) and "Stack Desktop - Party Mode" (desktop) in the design canvas.

### Responsive behavior: editor and published pages

Breakpoints: **phone** under 768 px, **tablet** 768–1023 px, **desktop** 1024 px and up. The editor is a full page at `/new`, `/drafts/{id}` and `/{handle}/{slug}/edit` on every size, never a dialog. Items marked **Proposed** aren't drawn in the design; build them as written unless told otherwise.

| Area | Phone | Tablet | Desktop |
| --- | --- | --- | --- |
| Editor shell | Full screen. Top bar: Exit, save status pill, Save draft. Progress bar (4 steps). Bottom bar: Back + Next / Finalize / Publish. | Same as phone, centered column max 680 px (Proposed). | Left rail hidden while editing. Top bar as phone, centered. Build: editor column max 680 px plus a 360 px live preview panel on the right from 1280 px up; under 1280 px a Preview button in the top bar instead (Proposed). |
| Title and Description steps | One field each, large Outfit text, Enter = Next. | Same, centered. | Same, centered, max 680 px. |
| Build: items | Each item is a numbered or bulleted row: heading field (one line, 80), subheading field (optional, 100), link chip, tag chips. Tapping a row selects it. | Same. | Same. Hovering a row shows its move handle and delete button (Proposed). |
| Build: format toolbar | Sticks above the keyboard: Section, Numbered, Bulleted, Link, Tags, and a chevron to hide it. | Same, pinned to the bottom of the screen. | Inline under the selected item (not floating), same five buttons. Shortcuts: Enter = new item of the same type, Shift+Enter is ignored (no line breaks), Cmd/Ctrl+K = Link (Proposed). |
| Link entry | Bottom sheet: **Link** ("Paste a link", up to 2,048), **Name** (optional, up to 40), a "Shows as" preview chip, then Remove link (when editing) and Save. A URL without a scheme gets `https://`. Enter in either field saves. | Same sheet as a centered dialog, max 480 px. | Popover anchored under the selected item, same fields and buttons, closes with Escape (Proposed). |
| Tags | Tags tray slides up above the keyboard: 5 suggested groups, "Your own" field, max 3 per item, Price picks one. | Same as dialog. | Popover anchored to the item, same content (Proposed). |
| Reordering | **Edit** (top right) › Reorder mode: up and down arrows on every item and section; Done exits. Finalize › Arrange has the same arrows. No drag on phones. | Same. | Drag handle on hover plus the same up and down arrow buttons; the focused item moves with Alt+↑ / Alt+↓. Arrows remain the accessible way (Proposed). |
| Finalize | One scrolling screen: Arrange / Preview toggle, theme card (12 emoji, 6 colors), Is this about a place? + City, Who can see this stack?, Category tags (1–2), then the red "Fix N things before publishing" box when needed. | Same, centered. | Two columns: settings on the left (max 480 px), live preview on the right, so the Arrange / Preview toggle isn't needed (Proposed). |
| Preview | Finalize › Preview shows the Stack exactly as visitors see it, plus the feed card ("This is how your card looks in feeds"). | Same. | Always visible in the right column at the same 680 px width visitors get; a Phone / Desktop switch shows both widths (Proposed). |
| Publish | Bottom bar: Back + **Publish** (black, pink offset shadow). Disabled with the reason under it while content rules or the city check fail. | Same. | Publish button at the bottom of the settings column and in the top bar (Proposed). |
| Published screen | "Your Stack is live" with Share your Stack, Start another stack, Done. | Same, centered. | Same, centered card max 480 px. |
| Stack page, signed in | Theme band, Back pill, card with author, title, description, tag filter chips, sections and picks; bottom action bar (Like, Save, Repost, Comments, Remix, Share). Bottom nav hidden. | Single centered column max 680 px; action bar sticks to the bottom of the column. | Banner across the top, Stack card max 680 px overlapping it, 300 px sticky right sidebar (Share, Remix, counts, author card, More from). Left rail visible. |
| Link page, signed out (D-4) | Theme band, avatar, name · handle, emoji + title, description, tag chips, picks as link cards with ↗, "Save these picks to your bucket list" call to action, "made with stack." | Same, centered, max 600 px. | Same centered column max 600 px over a full-width theme band; a small "Sign in" button top right (Proposed). |
| Unavailable page | "This stack isn't available" with a link to Explore. | Same. | Same, centered. |
| Editing after publication | Same editor; bottom bar shows **Save** and **Save and share update** (Public only, once per 7 days); header status "No changes yet" / "Unsaved changes". | Same. | Same buttons at the bottom of the settings column (Proposed). |

### Shared styles (design tokens)

Define these once (CSS custom properties or a theme file) and never hard-code them in components. Colors are OKLCH, exactly as in the design.

| Token | Value | Used for |
| --- | --- | --- |
| `ink` | `oklch(22% 0.04 300)` | Borders, hard shadows, primary dark buttons, body text on light |
| `ink-strong` | `oklch(15% 0.05 300)` | Big titles |
| `cream` | `oklch(98% 0.02 95)` | App background, text on dark buttons |
| `paper` | `oklch(100% 0 0)` | Cards, inputs, sheets' inner cards |
| `surface-muted` | `oklch(94.5% 0.025 95)` | Settings groups, grouped rows, info notes |
| `text-muted` | `oklch(42% 0.035 300)` to `oklch(47% 0.035 300)` | Subheadings, meta, handles |
| `divider` | `oklch(92% 0.02 95)` | 1 px row dividers |
| `pink` | `oklch(55% 0.22 350)` | Follow, accents, focus ring, unread dots, the period in "stack." |
| `pink-hot` | `oklch(66% 0.24 350)` | Highlight tag chips (Must-do, Hidden gem) |
| `yellow` | `oklch(92% 0.17 100)` | Create, Remix, active nav, call-to-action cards |
| `link` / `link-bg` | `oklch(42% 0.17 255)` / `oklch(95.5% 0.025 255)` | Link chips |
| `danger` / `danger-text` / `danger-bg` | `oklch(52% 0.2 25)` / `oklch(45% 0.2 25)` / `oklch(97% 0.03 25)` | Delete buttons, errors, "Not saved · Retry" |
| `success` / `progress` | `oklch(90% 0.1 150)` / `oklch(75% 0.2 145)` | Done chips, progress bars |
| Theme colors (6) | `oklch(86% 0.13 85)`, `oklch(84% 0.12 40)`, `oklch(84% 0.09 260)`, `oklch(85% 0.1 160)`, `oklch(85% 0.1 340)`, `oklch(88% 0.12 110)` | Stack and bucket bands, card headers, link preview image |
| Tag group colors (bg / text) | Highlight `oklch(66% 0.24 350)` / white; Price `oklch(92% 0.08 150)` / `oklch(30% 0.1 150)`; Good for `oklch(92% 0.06 240)` / `oklch(32% 0.12 250)`; Know before `oklch(93% 0.09 90)` / `oklch(34% 0.08 70)`; When `oklch(92% 0.06 300)` / `oklch(34% 0.12 300)`; custom tags `oklch(94% 0.02 95)` / ink | Pick tag chips and filter chips |
| Status colors | In progress `oklch(90% 0.12 150)`, This week `oklch(92% 0.08 230)`, This weekend `oklch(92% 0.1 60)`, Next week `oklch(92% 0.08 300)`, Someday `oklch(93% 0.03 95)`, Done `oklch(90% 0.1 150)` | Bucket status chips and tiles |
| Category colors (12) | As in the Explore tiles (Food & Drink `oklch(84% 0.12 40)`, Travel & Places `oklch(85% 0.1 160)`, Art & Design `oklch(85% 0.1 340)`, Technology `oklch(88% 0.12 110)`, Learning `oklch(84% 0.09 260)`, Home & Living `oklch(86% 0.13 85)`, Style & Shopping `oklch(87% 0.08 20)`, Entertainment & Culture `oklch(85% 0.1 300)`, Health & Wellness `oklch(88% 0.09 150)`, Business & Money `oklch(87% 0.06 230)`, Sports & Outdoors `oklch(86% 0.1 130)`, Games & Hobbies `oklch(88% 0.1 60)`) | Explore category tiles and chips |

- **Type.** Headings: Outfit 800–900, tight letter-spacing (about −0.02em; titles −0.03em). Body and UI: Inter 400–800. Numbers, URLs and code: IBM Plex Mono 400–600. Sizes: Stack title 26–30 px on phone, 44 px desktop; section heading 18–22 px; pick heading 15 px phone / 17 px desktop at weight 600; subheading 14 / 15 px regular in `text-muted`; meta 12–13 px; small caps labels 10.5–11 px, weight 700–800, uppercase, letter-spacing 0.07em.
- **Borders.** 2 px `ink` for cards, buttons, inputs, sheets' top edge; 1.5 px for chips; 1 px `divider` between rows.
- **Shadows.** Hard offset, no blur: 2 px for small round buttons, 3 px for buttons and inputs, 4–6 px for cards (`Xpx Xpx 0 ink`). Primary dark buttons use a pink offset (`3px 3px 0 pink`).
- **Radius.** Pills and buttons 999 px; cards 22–26 px; sheets 28 px top corners; inputs and grouped lists 14 px; small tiles 10–16 px.
- **Spacing.** 4 px base. Screen padding 16–20 px on phone, 40 px on desktop. Tap targets at least 44 × 44 px.
- **Motion.** Sheets slide up 280 ms `cubic-bezier(.2,.8,.2,1)`; bottom nav slide 180 ms; skeleton shimmer 1.2 s; emoji wallpaper drift 18 s linear loop; desktop card hover lifts 1 px with a deeper shadow. All motion off with Reduce Motion.
- **Light theme only in v1.** No dark mode (Proposed).

### Reusable components

Build these once; screens are compositions of them. States listed must all exist.

- **AppShell:** bottom nav (phone; five items, Inbox badge, hide-on-scroll rules) or left rail (tablet icons, desktop full). Hidden in the editor and on Stack detail on phones.
- **TopBar:** Back pill ("‹ Back", 2 px border, 3 px shadow), centered title, optional right action.
- **Button:** variants primary-dark (ink, cream text, pink shadow), yellow, outline (paper + ink border), pink (Follow), danger, text-only, icon-round (28, 34, 40 px). States: default, hover (desktop), pressed, focus-visible, disabled (with reason text below), loading.
- **Chip:** tag chip (group colors, 1.5 px border), filter chip (selected gets 2 px shadow), status chip (tappable for owner, read-only for visitors), count badge, "N picks" badge.
- **SegmentedControl / Tabs:** pill track with ink selected segment; `role=tablist`.
- **Switch, RadioCard** (visibility options with one-line descriptions), **TextField** (with counter at 80% of limit, red "N over" past it), **TextArea** (no line breaks).
- **Sheet → Dialog:** bottom sheet on phone, centered dialog max 480 px on tablet and desktop; focus trap, Escape closes, focus returns.
- **Toast:** dark pill above the nav, 1.8 s (undo toasts 5 s), `role=status`.
- **EmojiWallpaper:** repeated emoji at 18–20% opacity, slow drift, decorative (hidden from screen readers).
- **StackBand / StackHeader:** theme color + wallpaper + "N picks" badge + date.
- **StackCard** (feed: band, author row, title, description, first 3 picks, "See all N picks", action row), **StackTile** (profile and Explore grids), **StackRowMini** (lists).
- **PickRow:** number or bullet, heading (600), subheading, LinkChip, tag chips, owner/visitor actions (Pin, Send; 28 px visual inside a 44 px target). Variants: detail, link page (whole row is a link card with ↗), editor (selected, reorder, delete).
- **SectionHeading:** 4 px ink bar + Outfit 800 label + 2 px rule.
- **LinkChip:** link icon + custom name or domain.
- **Avatar:** photo or initials; sizes 16–112 px.
- **BucketCard, BucketItemRow, StatusSheet, PinSheet, CommentRow** (with inline delete confirm), **NotificationRow**, **AskCard**, **ProgressBar**, **Skeleton** (card and detail shapes), **EmptyState**, **InlineErrorBox** ("Fix N things before publishing"), **SaveStatusPill** (Saving… / Saved just now / Not saved · Retry / No changes yet / Unsaved changes).
- **Editor parts:** EditorItem, FormatToolbar, TagsTray, LinkSheet/LinkPopover, ReorderControls, ThemePicker, PlaceField, CategoryPicker, PublishBar, ShareUpdateSheet.
- **Pages built from these:** LinkPage, UnavailablePage, Published screen, and the link preview image renderer.

### Assets the coding agent needs

- **Fonts:** Inter (400, 500, 600, 700, 800), Outfit (600, 700, 800, 900), IBM Plex Mono (400, 500, 600) from Google Fonts. Self-host them in production with `font-display: swap`.
- **Icons:** simple line icons on a 24 px grid, stroke 2–2.6, round caps and joins, drawn as inline SVG in the design: back chevron, forward chevron, chevron down, search, home, plus, profile, inbox, heart (outline and filled), bookmark, repost, comment, share arrow, link, pin, send, trash, flag, more (⋯), check, close (×), up and down arrows, drag handle, globe, lock, camera. Use one icon set (Lucide matches closely) instead of copying the SVGs one by one.
- **Emoji:** system emoji in the app (wallpapers, themes, tags, statuses, categories). The 12 theme emoji: 🍸 🍜 ☕ 📖 ✈️ 🛍️ 🖥️ 🎧 🌮 🌴 🎨 ✨.
- **Wordmark:** the text "stack" in Outfit 900 with a pink period. It is not an image.
- **Link preview image:** generated per Stack at 1200 × 630 from the StackBand layout (see Flow 3); the emoji there must be drawn with an emoji image set because servers have no system emoji (see the flags below).
- **No bitmap images** besides users' profile photos (400 × 400 crop) and generated link previews.
- **App icons:** the [Stack icon pack](../project/party-mode/icons/README.md) supplies the favicon, app icon, Apple touch icon and web app manifest icons. The signed-out marketing page is still covered by G-14.

### Worked example: one Stack from draft to edit

The example data is made up for testing; use it as seed data and in end-to-end tests. Renata Díaz (`@renata.diaz`, signed in with Google) makes a Stack on her phone, finishes it on her laptop, shares it, and edits it a week later.

**1. Start on the phone.** Renata taps + . Title: "Late-Night Tacos in CDMX" (24/60), Enter. Description: "Where I eat after the bars close. Cash in your pocket, napkins in your bag." (74/160), Next. The draft exists from the first character typed: `POST /drafts` returns `d_8f2k`, the URL becomes `/drafts/d_8f2k`, and the status pill shows Saving… then Saved just now.

**2. Build on the phone.** In the first empty numbered item she types the heading "El Vilsito", then the subheading "Mechanic shop by day, al pastor stand by night". Tags › Late night, Price › `$`, Know before › Cash only (3 of 3; the rest dim). Enter adds item 2: "Taquería Orinoco" / "Get the trompo. Open till 3am". Link › pastes `orinoco.com.mx`, Name left empty; the sheet shows "Shows as: orinoco.com.mx" and saves it as `https://orinoco.com.mx`. Toolbar › Section adds "Centro" above a new item 3: "Los Cocuyos" / "Suadero since 1953, tiny counter" with Hidden gem and `$`. She then taps the + above item 1 and adds a section "Roma & Condesa" so the first two items have a heading too. Every change autosaves; each item gets a permanent id (`p_1`, `p_2`, `p_3`) the moment it's created.

**3. Reorder on the phone.** Edit › Reorder. She moves Taquería Orinoco up above El Vilsito with the up arrow, then taps Done. Numbers renumber 01–03 across sections; the ids don't change.

**4. Finish on the laptop.** At home she opens `stack.app/drafts/d_8f2k` (or Profile › Drafts). The editor opens at Build on desktop, with the editor column on the left and the live preview on the right. She edits item 2's subheading to "Mechanic shop by day, al pastor stand by night. The line moves fast, don't leave" (88/100, counter visible from 80) and clicks Finalize.

**5. Finalize and preview.** The theme is suggested from the title: 🌮 on `oklch(84% 0.12 40)` ("Suggested from your title"); she keeps it. Is this about a place? defaults to Yes because of 🌮. City is empty, so Publish is disabled with "Add a city to publish." under it. She types "Mexico City". Who can see this stack: Public (default). Category tags: Food & Drink, Travel & Places. The preview column shows the Stack at visitor width with the taco wallpaper, "🌮 3 picks", sections Roma & Condesa (01, 02) and Centro (03), and the feed card.

**6. A content-rule miss.** Before publishing she pastes a longer description (172 characters). The description counter reads "172/160 · 12 over" in red. Publish is disabled and the red box says "Fix 1 thing before publishing: Description is 12 over 160 characters." She trims it, and the box disappears.

**7. Publish.** `POST /stacks` from the draft returns Stack `s_4hq9` with slug `late-night-tacos-in-cdmx`. The draft `d_8f2k` is deleted. The Published screen shows "Your Stack is live". Live URL: `stack.app/renata.diaz/late-night-tacos-in-cdmx`. It appears at once on her profile, in followers' Following feeds, in For you, Explore (Food & Drink, Travel & Places) and search (title, city, handle, categories).

**8. Share.** Share your Stack › Link page › Copy. Pasted into a group chat, the link unfurls with the preview image: 🌮 on the orange band, "3 picks", "Late-Night Tacos in CDMX", @renata.diaz, the stack. wordmark. The link title reads "🌮 Late-Night Tacos in CDMX" and the description is her description. No pick names appear in the preview.

**9. A visitor opens the link (signed out, phone).** Jordan taps the link in the chat. They get the **link page** (D-4): band, Renata's avatar and name, title, description, tag chips (All 3, Hidden gem, $, Cash only, Late night), and picks as cards. Tapping the Hidden gem chip leaves only Los Cocuyos ("1 of 3 picks"). Tapping Taquería Orinoco's ↗ opens `https://orinoco.com.mx` in a new tab (`rel="nofollow noopener noreferrer ugc"`). Tapping "Save these picks to your bucket list" opens Sign in; after Continue with Google and choosing a username, the pin sheet opens for that Stack, with no second tap.

**10. A signed-in visitor (desktop).** Kenji opens the same URL on his laptop and gets the **Stack page** layout: banner, Stack card, and a right sidebar with Share, Remix, counts, the author card and More from Renata. He pins El Vilsito to his "CDMX in March" bucket with status This week. Renata gets an Activity item, "Kenji Sato pinned “El Vilsito” from Late-Night Tacos in CDMX" (pins notify; push and email follow her notification settings).

**11. Edit after publication (one week later, phone).** Renata opens her Stack › Public ▾ › Edit stack. The editor opens at Build with the status "No changes yet". She adds "Tacos Los Alexis" / "Best suadero north of Centro" to Centro and moves El Vilsito to the top with Reorder. She changes the title to "Late-Night Tacos in Mexico City". The status reads "Unsaved changes".

- **Save and share update** (Public, last update over 7 days ago) opens the note sheet. She types "Added Tacos Los Alexis" (22/40) and taps Share update.
- The live Stack is replaced. The URL **does not change**: `.../late-night-tacos-in-cdmx` stays (the slug is fixed at first publish, D-1). The Stack goes back to the top of followers' feeds with "Updated: Added Tacos Los Alexis" and moves to the top of her profile. Toast: "Update shared to the feed".
- Kenji's pin still points to El Vilsito (`p_1`) even though it moved from 02 to 01, because pins use the pick's id (C-1). His bucket row now shows "from Late-Night Tacos in Mexico City · Renata".
- The link preview image is regenerated with the new title, and its URL carries the new version so chat apps fetch it fresh.
- If she had also edited the Stack on her laptop in between, Save would first show "This stack changed on another device" with Replace with my version / Cancel and keep editing.
- If she deletes Los Cocuyos later, anyone who pinned it keeps it in their bucket list with its saved text and the 🫥 note, and it no longer opens the Stack (D-3).

### Details the agent would otherwise guess

Each has a default so the build isn't blocked. **Decision needed** means it needs your call before launch; **Proposed** means build it as written unless you change it.

| # | Detail | Default | Status |
| --- | --- | --- | --- |
| G-1 | Desktop and tablet editor layout (two columns, live preview, popovers, drag handles) isn't drawn. | As in the responsive table above. | Proposed |
| G-2 | Link chips: the prototype shows the custom Name or the domain; Flow 1 says the line shows the fetched page title and site icon. | Show the custom Name if given, else the domain (as the prototype). Fetch the page title only as a suggested Name in the link sheet. | Decision needed |
| G-3 | Numbered and bulleted items in the same Stack. | Allowed. Numbers count only numbered items and run continuously across sections (01, 02 in one section, then 03). | Proposed |
| G-4 | Emoji look different on iPhone, Android and Windows, and servers can't draw system emoji for the link preview. | System emoji in the app; the preview image uses the open Twemoji set. | Decision needed |
| G-5 | Favicon, app icon, Apple touch icon and manifest icons. | Use the supplied yellow "s." files and manifest guidance in the [Stack icon pack](../project/party-mode/icons/README.md). | Supplied |
| G-6 | Slug for titles that are all emoji or non-Latin script. | Remove accents, keep a–z and 0–9; if nothing is left, use `stack`, then `-2`, `-3`. | Proposed |
| G-7 | Signed-out link page on desktop isn't drawn. | Centered column max 600 px on a full-width theme band, small Sign in button top right. | Proposed |
| G-8 | Pressed state on touch screens. | Buttons move 1 px down-right and their hard shadow shrinks by 1 px while pressed. | Proposed |
| G-9 | Where the old "theme" presets (Default, Cream, Ink, Sage) in the editor code fit. | Not used. A Stack's look is its emoji + one of the 6 theme colors. | Proposed |
| G-10 | Dates. | "Published Nov 22" in the viewer's locale and time zone; relative times (2d, 3h) in feeds and Activity. | Proposed |
| G-11 | Category tags and Explore before there's content. | Categories with no Public Stacks show "Nothing here yet · Be the first to add one" and stay in the grid. | Proposed |
| G-12 | Images inside picks. | None in v1; a pick is text, tags and one link. | Proposed |
| G-13 | Long words and URLs in headings. | Wrap anywhere (`overflow-wrap: anywhere`) rather than overflow. | Proposed |
| G-14 | Signed-out marketing home page at `stack.app`. | Signed-out visitors see Home's For you feed with a sign-in banner; no separate marketing page in v1. | Decision needed |

## Conflicts between the mockups and agreed rules

Ten places where the current mockup contradicted an agreed decision or a rule above. All are resolved; build the resolution, not the mockup.

| ID | What the mockup does | What it conflicts with | Proposed resolution |
| --- | --- | --- | --- |
| C-1 | Pins, check-offs, sends and pick messages store the pick's position ("stack:index"). | Agreed: owners can edit Stacks after publishing, and pins must track the same pick. Reordering or deleting a pick moves every later pin to the wrong pick. | Decided: every pick gets a permanent id, and pins, check-offs and messages point at that id. |
| C-2 | The editor header says "Saving…" and "Saved just now", but nothing is stored until Save draft or Close; a refresh loses the work. | The status promises a save. | Decided: real autosave to a server draft (Flow 1). |
| C-3 | Settings says "Allow others to fork", Activity has a Forks filter, the signed-out profile says "track your forks". | Agreed term is remix ("remix gets a fresh theme"). | Decided: say remix everywhere ("Allow others to remix your stacks", "Remixes", "track your remixes"). |
| C-4 | Remix logic exists but no button reaches it. | Agreed: remix is in, with a freshly suggested theme. | **Decided: add a Remix button to the Stack detail bottom bar, next to Repost, for non-owners when the owner allows remixing (Flow 8). Remix is in v1.** |
| C-5 | The Following feed includes followed users' Unlisted and Private Stacks. Explore's Recently added, category samples and featured category include non-public Stacks. Another user's Reposts tab can list Stacks the viewer can't open. | Agreed visibility: Unlisted and Private never appear in feeds or discovery. | Decided: every feed, Explore section, search result and profile list shows only Public Stacks, and never lists a Stack the viewer can't open. |
| C-6 | "Answer with a stack" marks the ask "Answered ✓" as soon as it's tapped. | An unpublished draft isn't an answer. | Decided: mark answered only on publish, and notify the asker then (Flow 9). |
| C-7 | The original's remix count goes up when the remix editor opens. | Counts should reflect real remixes. | Decided: count the remix and notify the owner only on publish. |
| C-8 | The private profile shows a fixed 128 followers; the public view shows 142. | Agreed: public view must look like what visitors see. | Decided: show the real count in both. If the owner hides counts, visitors don't see them; the owner always does. |
| C-9 | Hidden leftovers: an old public-profile screen ("Previewing your public profile · Done"), the old create editor, a "Contact button" sheet that duplicates Edit links, the Wrapped overlay and banner. | Agreed: public view uses the other-user layout; Wrapped is off; the new create flow replaces the old. | Decided: remove the old public-profile screen, old create editor and Contact button sheet; nothing reaches them. The public profile reuses the other-user layout; the owner's Public view toggle was later removed (Agreed). Keep Wrapped behind a flag that stays off. |
| C-10 | Create offers categories Food & Drink, Books, Travel, Home, Shopping, Tech; Explore shows Food & Drink, Travel, Books, Home, Art & Design, Tech. | One taxonomy is needed for search and Explore to work. | Decided: one list of 12 platform categories, used in Create, Explore and search (see Core concepts). |

## Decisions for me

All ten are decided (latest answers below); every flow above is written to match.

| ID | Question | Options | Recommendation |
| --- | --- | --- | --- |
| D-1 | What happens to a shared link when the owner renames the Stack or changes their username? (Flows 2, 3, 8) | A) Keep the designed URL `/{handle}/{slug}`, store every past handle and slug, and redirect old links forever. B) Freeze the slug at first publish. C) Let old links break. | Decided: B for titles (slug fixed at first publish), A for usernames (old ones redirect and stay reserved to the account). Permanent internal id underneath. Editable slugs later, not v1. |
| D-2 | When a Stack goes Private, what happens to other people's saves, reposts and pins? (Flow 2) | A) Hide them everywhere; they come back if it's made Public or Unlisted again. B) Keep showing a copy to people who already saved it. C) Delete them for good. | **A.** Decided: hide, don't delete. Saves and reposts disappear and come back if the Stack is made Public or Unlisted again. Pins keep their text but can't open the Stack while it's Private. |
| D-3 | When an owner deletes a pick or a whole Stack, what happens to other people's pins and done history? (Flows 2, 6) | A) Keep each pin as a copy of the pick's text, labelled "No longer in the stack"; it can still be checked off. B) Remove pins silently (what the mockup did). C) Remove to-do pins but keep done history. | **A.** A bucket list is the visitor's own work. Decided: the pick stays in their bucket list, but has no Stack to open or expand into. |
| D-4 | Which layout does a shared link show? (Flow 3) | A) Link page for signed-out visitors, app detail for signed-in users. B) Always the link page. C) Always the app detail. | **A.** Decided: signed-out visitors get the link page; signed-in users get the app view. Same URL. |
| D-5 | What does "Private account" in Settings do? (Flow 8) | A) Remove it from v1; per-Stack visibility covers privacy. B) Build follow requests: only approved followers see Public Stacks. | **A.** Decided: no private profiles in v1; remove the switch from Settings. Privacy is per Stack (see Core concepts). |
| D-6 | How does "Next time I'm in {city}" work? (Flow 6) | A) No location tracking in v1: the pin is grouped under Trips with no automatic reminder. B) Ask for browser location and check it when the app opens. C) Drop the option. | Decided: C. Remove the option; no location use in v1. |
| D-7 | Are buckets private or public? (Flows 6, 7) | A) Always private. B) Each bucket gets its own visibility, like a Stack. C) Always public. | **Decided: B. Each bucket is Public, Unlisted or Private with the same rules as a Stack; new buckets start Private (Flow 7).** |
| D-8 | How do people create accounts and sign in? (Flow 10) | A) Email one-time code. B) Email and password (Settings mentions it). C) Google or Apple sign-in. | Decided: Continue with Google and Continue with email (6-digit code) on one screen; one account per verified email (Flow 10). |
| D-9 | Who can post an ask, and who sees it? (Flow 9) | A) Any user can post an ask; asks last 1 or 3 days; a simple post sheet gets designed. B) Leave asks out of v1. | **A.** Decided: A, with asks on the asker's profile instead of Home, to drive profile visits (Flow 9). |
| D-10 | Is Like in v1? (Flow 5) Remix is decided: yes (C-4). | A) Yes, as in the current design. B) No; an earlier MVP plan removed likes. | **A.** Decided: keep Likes in v1; they rank Trending in Explore. |

## Screen-by-screen coverage

Every screen, sheet and menu in the current mockups, the flow that defines it, and any action still without a defined outcome. "None" means every visible action is covered.

| Screen, sheet or menu | Defined in | Actions with no defined outcome, or open items |
| --- | --- | --- |
| Bottom nav bar | Global rules | None |
| Home: header and level chip | Flow 5 | None (the ✅ done chip replaces the XP level chip). |
| Home: Bucket list (My lists, By when, Done) with pin-to-top on bucket cards | Flows 6, 7 | None |
| Home: feed (For you, Following) and feed card | Flow 5 | Comment delete: designed (trash button, inline confirm, 5-second Undo). |
| Explore and search results | Flow 5 | None |
| Stack detail: header, ⋯ menu (non-owners), tag filter, pick rows with small pin and send buttons, bottom bar with Remix | Flow 3 | None |
| Comments panel, with a report flag on others' comments | Flows 3, 8 | None |
| Stack settings sheet (visibility, Edit, Delete) | Flow 2 | None |
| Share sheet: Reels / TikTok | Flow 4 | The mockup's TikTok, Reels and Save video only show toasts; real export behaviour is a Proposed default. |
| Share sheet: Link page (Copy, Open page, Add to bio) | Flow 4 | None |
| Link page in the browser (live and Unlisted) | Flow 3 | The "Prototype: Live page / Private or deleted" switch is a mockup control and must not ship. |
| "This stack isn't available" page | Flow 3 | None |
| Repost sheet | Flow 5 | None |
| Remix sheet | Flow 8 | None |
| Pin sheet | Flow 6 | None |
| Bucket editor sheet (name, emoji, color, items reorder/remove, visibility, Copy link, Delete) | Flow 7 | None |
| Bucket page (owner and visitor) | Flow 7 | None |
| Send sheet | Flow 9 | Who appears as a recipient (Proposed default: mutual follows). |
| Own profile (Asking card, Stacks, Buckets, Saved, Reposts, Drafts) | Flows 7, 8, 9 | Follower and following counts aren't tappable; Proposed default keeps them that way in v1. Draft Delete has no undo; Proposed default adds one. |
| Public profile (with public Buckets tab and asks) | Flows 7, 8, 9 | None |
| Another user's profile (Asking card, Stacks, Buckets, Reposts) | Flows 7, 8, 9 | None |
| Ask sheet, Asking card, Past asks | Flow 9 | None |
| Private-answer warning sheet | Flow 9 | None |
| Connect dropdown | Flow 8 | None |
| Feature sheet | Flow 8 | None |
| Profile share sheet (own: Copy link, Share, Save image, More, Settings, Log out; other: plus Report and Block) | Flow 8 | Copy link, Share, Save image and More only show toasts. Proposed default: copy the URL, open the device share sheet, download a PNG profile card, open the device share sheet. |
| Block confirm | Flow 8 | None |
| Report menu and Report sheet (form, sent, already reported) | Flow 8 | Review and moderation tools are out of scope for v1. |
| Edit profile, photo menu, Move and scale | Flow 8 | None |
| Edit links | Flow 8 | None |
| Settings and privacy | Flow 8 | Help center and Terms and privacy: designed (in-app screens; placeholder legal wording). |
| Account and sign-in | Flows 8, 10 | None |
| Blocked accounts | Flow 8 | None |
| Manage stacks | Flows 2, 8 | None |
| Inbox: Activity (incl. ask notifications) | Flow 9 | None |
| Inbox: Messages thread list, thread with composer | Flow 9 | None |
| Sign-in sheet (start, email, code, profile setup) | Flow 10 | None |
| Create: Title, Description | Flow 1 | None |
| Create: Build editor (format toolbar, subheading field, Tags tray with Your own, link sheet, Edit reorder/delete, Undo) | Flow 1 | None |
| Create: Finalize (Arrange, Preview, theme, place and city, visibility, categories, Fix-before-publishing box) | Flow 1 | None |
| Create: title sheet | Flow 1 | None |
| Create: Published screen | Flow 1 | None |
| Edit mode: Save changes, Share update and note sheet | Flow 2 | None |
| Removed: Home Ask the group, Contact button sheet, old public-profile screen, old create editor, standalone Drafts step, Private account switch, Bold and Paragraph tools | C-9, D-5, D-9, Content rules | Not to be built. Wrapped stays built but switched off. |

**Required screens and states the design still doesn't show.** Everything listed as missing in the first draft has now been designed (sign-in, Remix, buckets, asks, link and unavailable pages, Messages, Private-answer warning, photo picker, reporting, content-rule validation). What remains:

- Review tools behind reports (Agreed for v1: simplest option). Every report is sent to a shared support inbox and logged in a spreadsheet (reporter, item, reason, details, time). The team reviews by hand and removes content or suspends accounts directly in the database. No admin screen and no auto-hiding in v1; a light admin page (list of reports with Dismiss, Remove content and Suspend, plus hiding an item after 3 reports) is the planned next step.
- Done: every sample Stack now uses heading + subheading items ("Name — note" lines were split into the two fields). Older "Name — note" lines, in saved data or when opened in the editor, are converted the same way and never become paragraphs. Item headings show semi-bold everywhere (Stack page, editor, previews), with subheadings regular and gray.
