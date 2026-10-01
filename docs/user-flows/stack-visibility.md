# Stack Visibility

## Core Model

Visibility determines who is allowed to access a Stack.

Distribution determines whether a Stack is actively surfaced into the feed.

Changing visibility does not automatically create a feed event.

## Entry Points

Stack visibility can be set or changed from:

1. The **Finalize** screen when creating a Stack.
2. The Stack owner's Stack page using the top-right settings menu.
3. The **Manage Stacks** screen.

Only the Stack owner may change its visibility.

## Visibility States

For the current intended product, Stacks have two primary visibility states:

- **Public**
- **Private**

The existing **Invite Only** visibility state should eventually be removed and replaced by group-based access controls.

Drafts are unpublished content and are always owner-only.

## Public Stacks

### Viewing

- Authenticated users can view public Stacks.
- Non-authenticated visitors can view public Stacks.
- Public Stacks appear on the public version of the owner's profile.
- Public Stacks are eligible to appear in search.
- Public Stacks may be accessed by their public URL.

### Feed

A public Stack may appear in the feed when:

- It is first published publicly.
- The owner uses **Publish & Share Update** on an eligible edited Stack.
- A previously private Stack is changed to public and the owner chooses **Share to Feed**.

Simply changing a Stack to public does not automatically push it into the feed.

### Engagement

Authenticated users may:

- Comment
- Repost
- Share

unless another rule prevents the interaction, such as a block relationship.

Non-authenticated viewers may view public Stacks but cannot perform authenticated interactions.

## Changing Public → Private

The owner may change a public Stack to private at any time.

Once the change succeeds:

- The Stack disappears from the feed.
- The Stack disappears from public search.
- The Stack disappears from the public version of the owner's profile.
- Existing public links no longer grant public access.
- Anyone other than the owner attempting to open the previous URL receives an unavailable/private state.
- Existing feed references, reposts, or other public references must no longer expose the Stack's private content.

Changing the Stack to private does not reset any existing feed-sharing cooldown.

## Private Stacks

### Viewing

- Only the owner can view a private Stack unless access is later explicitly granted through the future Groups system.
- Private Stacks do not appear in:
  - Feed
  - Public search
  - Public profile views

### URLs

- A private Stack may retain a URL.
- Possessing or receiving the URL does **not** grant access.
- Unauthorized viewers opening the URL cannot see the Stack content.

### Engagement

Private Stacks cannot be:

- Publicly commented on
- Publicly reposted
- Publicly discovered

## Changing Private → Public

When an owner changes a Stack from private to public:

1. The Stack becomes visible on the owner's public profile.
2. The Stack becomes eligible for public search.
3. The owner chooses whether to **Share to Feed**.

### Share to Feed

If the owner chooses to share it:

- The Stack is pushed into the feed.
- The Stack behaves similarly to a newly published Stack.
- It moves to the top of the owner's non-pinned Stacks.
- Pinned Stacks retain precedence.
- A 7-day feed-sharing cooldown begins.

### Do Not Share to Feed

If the owner makes the Stack public without sharing it:

- It is not inserted into the feed as a new item.
- It appears on the public profile according to its original chronological position.

Example:

- Stack originally created: July 2026
- Another Stack created: August 2026
- Private July Stack becomes public: January 2027

If the owner does not share it to the feed, the July Stack remains below the August Stack based on its original publication chronology.

It becomes eligible for search immediately after becoming public.

## Feed-Sharing Cooldown

1. Sharing a Stack to the feed begins a 7-day cooldown for that Stack.
2. During the cooldown, the Stack cannot be shared to the feed again.
3. Editing the Stack does not reset or bypass the cooldown.
4. Changing Public → Private → Public does not reset or bypass the cooldown.
5. The cooldown belongs to the Stack itself, not to its current visibility state.
6. Normal edits and **Publish** remain available during the cooldown.
7. **Publish & Share Update** remains unavailable until the cooldown expires.

## Profile Privacy

Profile-level privacy takes precedence over Stack-level public visibility.

### Public → Private Profile

If an owner changes their profile from public to private:

- Public Stacks no longer appear in the public feed.
- Public Stacks no longer appear in public search.
- Public Stacks are no longer visible through the user's public profile.
- Public Stack URLs no longer grant public access.

The Stack's underlying visibility setting may remain `public`, but profile privacy prevents public access.

### Private → Public Profile

If the owner later makes the profile public again:

- Public Stacks become publicly accessible again.
- Public Stacks become eligible for search again.
- Existing Stacks are **not automatically pushed back into the feed**.
- Their chronological profile ordering is preserved.

Only the following should create a new feed event:

- A newly published public Stack
- An eligible **Publish & Share Update**
- A private Stack changed to public where the owner explicitly selects **Share to Feed**

Existing cooldowns continue to apply.

## Future Access Model

Invite Only is expected to be replaced by group-based access.

A Stack may remain non-public while being accessible to specific groups.

Group access does not make a Stack eligible for public feed or public search.

## Rules

1. Only the Stack owner can change Stack visibility.
2. Visibility can be changed at any time.
3. Private Stacks are never publicly discoverable.
4. Possession of a private Stack's URL does not grant access.
5. Public Stack visibility is subordinate to profile-level privacy.
6. Profile privacy changes must not modify the underlying Stack visibility unnecessarily.
7. Feed-sharing cooldowns belong to the Stack and survive visibility changes.
8. Switching Public → Private → Public cannot bypass a cooldown.
9. Making a private Stack public does not automatically create a feed event.
10. Pinned Stacks retain precedence when another Stack is shared to the feed.
11. Drafts are always private to their owner.
12. Future Groups access may grant specific users access to otherwise non-public Stacks without making those Stacks publicly discoverable.

## Failure Cases

1. A public Stack fails to appear on the owner's public profile.
2. An eligible public Stack cannot be found through search.
3. A private Stack appears in the feed.
4. A private Stack appears in public search.
5. A private Stack appears on the public version of the owner's profile.
6. Another user can access a private Stack merely by knowing its URL.
7. An unauthorized user can comment on or repost a private Stack.
8. A public Stack remains accessible after the owner changes it to private.
9. Cached, feed, repost, or search surfaces continue exposing private Stack content after a privacy change.
10. Public Stacks remain publicly available after the owner makes their entire profile private.
11. Public Stacks are automatically pushed into the feed when a private profile becomes public.
12. A user bypasses the 7-day cooldown by switching Public → Private → Public.
13. Editing a Stack incorrectly resets its feed-sharing cooldown.
14. Changing visibility creates a duplicate Stack.
15. A user other than the owner can modify Stack visibility.
16. Making a private Stack public without selecting **Share to Feed** incorrectly moves it to the top of the profile.
17. Making a private Stack public without selecting **Share to Feed** incorrectly creates a new feed event.

## Expected Results

1. Owners can change Stack visibility at any time.
2. Public Stacks are accessible to authenticated and non-authenticated viewers when the owner's profile is public.
3. Public Stacks appear on the owner's public profile.
4. Public Stacks are eligible for search.
5. Private Stacks never appear on public surfaces.
6. Private Stack URLs do not grant unauthorized access.
7. Changing Public → Private removes public access across feed, profile, search, and direct URL.
8. Changing Private → Public makes the Stack publicly accessible and searchable.
9. When changing Private → Public, the owner decides whether to share it to the feed.
10. If shared to the feed:
    - The Stack receives a new feed event.
    - It moves to the top of the owner's non-pinned Stacks.
    - A 7-day cooldown begins.
11. If not shared to the feed:
    - No feed event occurs.
    - The Stack retains its chronological profile position.
12. Profile privacy overrides individual Stack visibility.
13. Returning a private profile to public does not automatically redistribute old Stacks into the feed.
14. Cooldowns persist through edits and privacy changes.
