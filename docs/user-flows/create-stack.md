# Create Stack — Logged-In User

## Entry Point

- User clicks **Create** while logged in.

## Flow

1. User enters a title or selects **Skip**.
2. User enters a description or selects **Skip**.
3. User builds the Stack by adding:
   - Sections
   - Lines
   - Optional subheadings associated with lines
   - Optional links associated with lines
4. User can rearrange, reorder, edit, or delete sections and lines.
   - Any subheading or links associated with a line move with that line.
5. User selects **Finalize** when finished building the Stack.
6. On the Finalize screen, the user can:
   - Preview the Stack
   - Select a privacy setting
   - Add optional location information
7. User publishes the Stack.
8. At any point before publishing, the user can save the Stack as a draft and return to it later.

## Visibility and Distribution

- Privacy selection controls **visibility**: who may access the Stack.
- Publishing controls whether the Stack becomes an active published version.
- Feed distribution is a separate action from visibility and should not be implied by a visibility change alone.
- Canonical visibility, profile-privacy, feed-distribution, and cooldown behavior is defined in [`stack-visibility.md`](./stack-visibility.md).

## Rules

1. A published Stack must contain:
   - A title
   - At least one line item
2. Only authenticated users can create Stacks.
3. Public/private visibility behavior follows [`stack-visibility.md`](./stack-visibility.md).
4. Only the Stack owner can edit or delete the Stack.
5. Subheadings and links associated with a line remain attached to that line when it is reordered.
6. Drafts do not appear on public surfaces.
7. A draft may exist without satisfying the requirements for publication.

## Failure Cases

1. A Stack's visibility or distribution does not match the rules in [`stack-visibility.md`](./stack-visibility.md).
2. A Stack without a title is published.
3. A Stack without at least one line item is published.
4. An unauthenticated user is able to create or publish a Stack.
5. The user loses internet connectivity and loses all unsaved Stack progress.
6. Another user is able to edit or delete the Stack.
7. Reordering a line causes its associated subheading or links to become detached or reordered incorrectly.
8. Publishing creates duplicate copies of the same Stack.
9. A Stack appears successfully published to the user but was not actually saved to the database.
10. The user deletes a draft unintentionally without being asked to confirm the deletion.

## Expected Results

- A valid published Stack is saved successfully and persists after page refresh.
- The Stack belongs to the authenticated user who created it.
- Sections, lines, subheadings, links, and their ordering are saved correctly.
- The selected privacy setting is preserved.
- Visibility and feed distribution follow [`stack-visibility.md`](./stack-visibility.md).
- Drafts remain available to the owner and can be resumed later.
- A user cannot publish until the minimum publication requirements are satisfied.
- Another user cannot modify or delete the Stack.
- Saving, publishing, or retrying an action does not unintentionally create duplicate Stacks.

## Current Issues / Product Changes Needed

1. A user can currently create a Stack without a title.
   - This is acceptable for a draft.
   - Publishing should be blocked until a title exists.
2. Add a clear prompt when a user attempts to publish without a title or at least one line item.
3. Add profile tabs or another control allowing the profile owner to switch between:
   - Public profile view
   - Owner-only profile view
4. When deleting a draft:
   - Require confirmation before deletion.
   - Make the destructive action visually clear.
   - Display the Delete action in red.
