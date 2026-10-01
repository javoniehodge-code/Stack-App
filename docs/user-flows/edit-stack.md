# Edit Existing Stack

## Entry Points

### Primary Entry Point

1. An authenticated user selects **Manage** on their profile page.
2. The user is taken to a page where they can choose which Stack they want to manage.
3. The user selects **Edit** from the Stack's dropdown menu.
4. The user is taken to the third screen of the Create Stack flow with the existing Stack content loaded.

### Secondary Entry Point — Needed

1. A user opens a Stack they own.
2. The existing privacy/settings control in the top-right menu should also include:
   - Edit
   - Delete
   - Privacy settings
3. Selecting **Edit** opens the Stack editor.

## Flow

1. The user opens an existing published Stack in the editor.
2. The user can edit, add, reorder, or delete:
   - Title
   - Description
   - Sections
   - Lines
   - Subheadings
   - Links
3. Changes do not immediately modify the currently published Stack.
4. The user can save the edited version as a draft at any point.
5. If the edited Stack does not contain:
   - A title
   - At least one line item
   the user cannot publish the edited version.
6. When ready, the user has two publishing options:

### Publish

- Replaces the currently published version with the edited version.
- Does not create a new Stack.
- Does not send the Stack back into the feed as an update.
- Does not change its position on the user's profile.
- Updates the **Last Updated** date.

### Publish & Share Update

- Replaces the currently published version with the edited version.
- Does not create a duplicate Stack.
- User is prompted to enter an optional update note describing the changes.
- The Stack is distributed into the feed as an updated Stack.
- The Stack moves to the top of the user's profile as though newly published, subject to pinned Stacks retaining precedence.
- Updates the **Last Updated** date.
- Begins a 7-day cooldown before that Stack can be shared to the feed as an update again.

7. Update notes disappear after 7 days.
8. The user should be informed when entering an update note that the note will only be shown for 7 days.
9. Each edited draft records the version of the published Stack it was created from.
10. If the published Stack changes before that draft is published, the draft becomes stale.
11. A stale draft cannot silently overwrite the newer published version. The user must be warned and choose whether to:
   - Continue with the stale draft and intentionally replace the current published version, or
   - Discard the stale draft and edit the latest published version instead.

## Rules

1. To **Publish** or **Publish & Share Update**, the edited Stack must contain:
   - A title
   - At least one line item
2. A user may save an edited Stack as a draft without a title or line item.
3. An unpublished edit exists separately from the currently published version.
4. Saving an edited Stack as a draft does not modify:
   - The currently published Stack
   - Its position in the feed
   - Its position on the profile
   - Its privacy setting
5. Draft versions of published Stacks are visible only to the owner.
6. Deleting an edited draft does not delete or modify the currently published Stack.
7. Publishing an edited Stack replaces the currently published version rather than creating a new Stack.
8. A published Stack retains its original publication date.
9. Every published edit updates the Stack's **Last Updated** date.
10. A Stack may only be shared to the feed as an update once during any 7-day cooldown period.
11. Regular publishing remains available during the cooldown period.
12. Pinned Stacks retain precedence over Stacks moved upward because of **Publish & Share Update**.
13. A Stack must contain an actual change before **Publish & Share Update** is available.
14. Update notes are temporary and disappear after 7 days.
15. Each draft stores the published Stack version it was based on.
16. If the current published version no longer matches the draft's base version, publishing requires an explicit stale-draft conflict decision from the owner.
17. Stale-draft conflicts should use version checking rather than automatic merging.

## Failure Cases

1. The user loses internet connectivity and unsaved edits are permanently lost.
2. A user can use **Publish & Share Update** more than once during the 7-day cooldown.
3. A user makes no actual changes but is still able to use **Publish & Share Update**.
4. Publishing an edited Stack creates a duplicate instead of replacing the existing Stack.
5. Deleting an edited draft deletes or modifies the published Stack.
6. Saving an edited draft unintentionally modifies the public Stack.
7. A draft version becomes publicly visible.
8. The Stack loses its original publication date after an edit.
9. Reordering lines causes associated subheadings or links to become detached.
10. A Stack without a title or line item can be published.
11. A user who does not own the Stack can edit, publish, or delete it.
12. **Publish & Share Update** moves a Stack above a pinned Stack.
13. A stale draft silently overwrites a newer published version without warning.
14. Double-clicking a publishing action creates duplicate updates or duplicate Stack records.
15. An update note continues appearing after its 7-day display period.

## Expected Results

1. An edited and published Stack replaces the existing version without creating a duplicate.
2. An edited Stack published using **Publish & Share Update** also replaces the existing version without creating a duplicate.
3. A Stack published using **Publish & Share Update**:
   - Appears at the top of the appropriate feed
   - Moves to the top of the user's non-pinned Stacks
   - Does not supersede pinned Stacks
4. A Stack published using **Publish** remains in its existing profile/feed position.
5. Unpublished edits are stored as drafts.
6. Draft versions of published Stacks are not publicly accessible.
7. Draft changes do not affect the currently published Stack.
8. Deleting an edited draft leaves the currently published Stack unchanged.
9. The Stack retains its original publication date after every edit.
10. The **Last Updated** date reflects the most recent published edit.
11. Users cannot share another feed update for the same Stack until the 7-day cooldown expires.
12. Users can continue editing and publishing normally during the cooldown period.
13. Update notes disappear after 7 days.
14. If a draft was created from an older published version, the owner is warned before it can replace the newer version.
15. A stale draft never overwrites a newer published version silently.

## Current Issues / Product Changes Needed

1. If a user deletes the title, they can currently still save and share the Stack.
   - Draft saving should remain allowed.
   - Publishing should be blocked until a title and at least one line item exist.
2. The current labels **Save** and **Save & Share Update** are confusing because **Save Draft** also exists.
   - Rename **Save** → **Publish**
   - Rename **Save & Share Update** → **Publish & Share Update**
3. Update notes currently remain indefinitely.
   - Update notes should disappear after 7 days.
   - The user should be told this when entering an update note.
4. Add a second Edit entry point directly from a Stack owned by the user.
   - Expand the existing top-right settings/privacy menu to include:
     - Edit
     - Delete
     - Privacy settings
5. Add version tracking for edited drafts so stale drafts can be detected before publication.
