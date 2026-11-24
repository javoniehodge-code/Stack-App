# Edit a published Stack

[Functional spec — Flow 2](../stack-spec.md#flow-2-change-a-published-stack-edit-visibility-delete) controls editing and sharing updates.

- The owner opens **Edit stack** from the visibility pill on Stack detail or in Manage stacks. The existing content opens at **Build** with the same tools and limits as creation. A saved edit draft can be reopened from either Drafts tab.
- **Save changes** validates and updates the live Stack. The next load of the existing shared link shows the new content, and the Stack keeps its feed position.
- **Share update** validates and saves, then resurfaces the Public Stack to followers and moves it up the owner's profile below the featured Stack. It accepts an optional note up to 40 characters and is available once every seven days per Stack. A visibility change does not reset the cooldown.
- Exiting with changes keeps an owner-only edit draft and leaves the live version as it was. Refresh restores the saved draft.
- Existing Stacks still display under the legacy content rules until edited. The editor converts legacy paragraph and bold lines into bulleted picks and flags content that must be corrected before saving, as proposed in the spec.

## Identity and errors

- The Stack ID, first-publish slug, social activity and references to surviving pick IDs persist through edits and reorder. Pins for removed picks keep their text snapshot and lose the link to the pick.
- Failed saves keep edits available for retry. If another device updated the Stack since editing began, show the conflict dialog and replace the newer version only after explicit confirmation.
- Verify an unauthorized user or a stale editor for a deleted Stack cannot save changes. See [Delete a Stack or draft](delete-stack.md).
