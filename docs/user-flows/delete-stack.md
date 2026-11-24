# Delete a Stack or draft

[Functional spec — Flow 2](../stack-spec.md#delete) defines removal for Party Mode.

## Published Stack

1. The owner opens the Stack settings sheet from the visibility pill on Stack detail or in Manage stacks.
2. **Delete stack** changes to **Tap again to delete**. The second tap submits the deletion. Leaving the sheet before confirming leaves the Stack in place.
3. After server success, show **Stack deleted** and return to the previous screen if deletion started from Stack detail.

The Stack disappears from the profile, featured slot, Manage stacks, feeds, search, Saved and Reposts. Its old URL shows the same unavailable state used for inaccessible content. Comments and reposts can no longer expose the Stack. Other users' pins keep their last pick text and done state, without a Stack to open.

## Draft

The owner can delete a draft in Profile › Drafts or Manage stacks › Drafts. The spec proposes a five-second **Undo**. Removing an edit draft leaves the live Stack and its URL intact.

## Checks

- Enforce ownership at the server. Treat retries as idempotent and avoid partial deletion. If deletion fails, preserve the current state and offer retry.
- Verify a stale tab can't restore or overwrite a deleted Stack by saving, publishing, or refreshing.
- Verify a user's other Stacks and unrelated drafts are unaffected.
