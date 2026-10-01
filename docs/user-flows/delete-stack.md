# Delete Stack

## Entry Points

### Published Stack — Manage Stacks

1. User opens their profile.
2. User selects **Manage Stacks**.
3. User opens the actions menu for a published Stack.
4. User selects **Delete**.
5. User receives a clear confirmation that deletion is permanent.
6. User can:
   - Cancel
   - Confirm Delete
7. If confirmed, the Stack is deleted.

### Published Stack — Stack Page

This entry point is not yet built.

1. Owner opens a Stack from their profile.
2. Owner opens the top-right Stack settings menu.
3. Available actions include:
   - Edit
   - Privacy
   - Delete
4. Owner selects **Delete**.
5. Owner receives a clear confirmation that deletion is permanent.
6. Owner can:
   - Cancel
   - Confirm Delete
7. If confirmed, the Stack is deleted.

### Draft — Manage Stacks

1. User opens **Manage Stacks**.
2. User selects **Delete** on a draft.
3. User receives a clear confirmation that deletion is permanent.
4. User can:
   - Cancel
   - Confirm Delete
5. If confirmed, the draft is deleted.

### Draft — Profile Drafts Tab

1. User opens the **Drafts** tab on their profile.
2. User selects **Delete** on a draft.
3. User receives a clear confirmation that deletion is permanent.
4. User can:
   - Cancel
   - Confirm Delete
5. If confirmed, the draft is deleted.

---

## Rules

1. Stack deletion is permanent from the user's perspective.
2. Only the Stack owner may delete a Stack or draft.
3. Every deletion requires explicit confirmation.
4. The confirmation must clearly state that deletion is permanent.
5. The user must always have the ability to cancel before deletion occurs.
6. Deleting a draft of an existing published Stack does not modify or delete the published Stack.
7. Deleting a published Stack does not accidentally delete unrelated drafts or other Stacks.
8. Deleted Stacks cannot remain publicly accessible through:
   - Feed
   - Search
   - Profile
   - Direct URL
   - Reposts
9. A deletion operation should behave atomically from the user's perspective:
   - It succeeds completely, or
   - It fails without leaving the Stack in a partially deleted user-visible state.
10. Delete operations should be idempotent. Repeated delete requests must not create errors, duplicate side effects, or corrupt related data.
11. Stack management controls are available from owner-controlled profile surfaces, not from the feed.

---

## Published Stack Deletion

When a published Stack is successfully deleted:

- It disappears from the owner's profile.
- It disappears from the feed.
- It disappears from search.
- It is no longer available through reposts.
- Its direct URL no longer displays the Stack.
- Existing comments are no longer accessible through the deleted Stack.
- Existing reposts can no longer expose the deleted Stack's content.

The URL should display:

**Stack no longer available**

rather than exposing deleted content.

---

## Draft Deletion

When a draft is successfully deleted:

- The draft disappears from all owner-only draft surfaces.
- If the draft was an edited version of a currently published Stack, the published Stack remains unchanged.
- No public content is affected.

---

## Stack Open in Another Tab

If a Stack is deleted while it is open in another browser tab:

1. The deletion still succeeds.
2. The stale tab must not be able to restore or overwrite the deleted Stack.
3. If the user attempts to edit, save, publish, or refresh from the stale tab, the app should recognize that the Stack no longer exists.
4. The user should see **Stack no longer available** or an equivalent deleted-state message.

---

## Deletion Failure

If deletion cannot be completed:

- The app should not tell the user that the Stack was deleted.
- The user should receive a clear error message.
- The user should be able to retry.
- The Stack should remain in a consistent state.

The user should not be asked to manually resume a partially completed deletion.

---

## Failure Cases

1. A user other than the owner can delete a Stack.
2. A Stack is deleted without confirmation.
3. Canceling the confirmation still deletes the Stack.
4. A deleted public Stack remains in the feed.
5. A deleted Stack remains on the owner's profile.
6. A deleted Stack remains searchable.
7. A deleted Stack's URL still reveals its content.
8. A repost continues exposing the contents of a deleted Stack.
9. Deleting an edited draft also deletes the currently published Stack.
10. Deleting one Stack accidentally deletes another Stack.
11. A Stack is partially deleted and remains visible on some surfaces.
12. A stale browser tab can recreate or overwrite a Stack after it has been deleted.
13. Double-clicking Delete or retrying the request causes data corruption or an unexpected error.
14. The interface reports successful deletion when the backend deletion actually failed.

---

## Expected Results

1. Deleting a published public Stack removes it from:
   - Feed
   - Search
   - Owner's profile
   - Direct public access
2. Deleting a private Stack permanently removes it from the owner's available Stacks.
3. Only the owner can delete a Stack.
4. The owner receives a clear permanent-deletion warning before deletion.
5. The owner can cancel the deletion.
6. Comments and reposts associated with a deleted Stack no longer provide access to that Stack.
7. The deleted Stack's URL displays **Stack no longer available**.
8. Deleting a draft of a published Stack leaves the published Stack unchanged.
9. A Stack open in another tab cannot be restored or modified after deletion.
10. Failed deletion leaves the Stack in a consistent state and gives the user the ability to retry.
11. Successful deletion leaves no publicly accessible copy of the Stack.

---

## Current Issues / Product Changes Needed

1. Published Stack deletion currently uses a weak confirmation such as **Tap again to delete**.
   - Replace with a clear confirmation dialog.
   - Clearly state that deletion is permanent.
   - Include **Cancel** and **Delete** actions.
   - Make the destructive Delete action visually distinct.

2. Draft deletion is currently a one-click action.
   - Add the same explicit confirmation behavior.

3. Expand the Stack-owner settings menu on Stack pages to include:
   - Edit
   - Privacy
   - Delete

4. Do not expose owner editing/settings controls when the owner encounters their own Stack in the feed.
   - Stack management should occur through owner-controlled profile and management surfaces.
