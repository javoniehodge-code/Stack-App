# Stack and bucket visibility

[Functional spec — core rules](../stack-spec.md#core-concepts-and-data-model) and [Flow 3](../stack-spec.md#access-rules) define access across Party Mode.

| Visibility | Who can open it | Discovery |
| --- | --- | --- |
| Public | Anyone, including signed-out visitors | Stacks can appear on profiles, feeds, Explore and search. Public buckets appear on profiles. |
| Unlisted | Anyone with the link | Excluded from public profiles and discovery. Links can be passed on. |
| Private | The owner | Excluded from public profiles and discovery. A shared URL grants no access. |

New Stacks default to Public and new buckets default to Private. Drafts are owner-only. Profiles are public, and only Public Stacks contribute to the public Stack count. There is no owner preview toggle: the owner always sees everything they own, and everyone else gets the public profile at `/{handle}`. On the owner's profile the Stacks tab is a dropdown: **Public** or **Private & unlisted** ([Flow 8](../stack-spec.md#own-profile)). Buckets follow [Flow 7](../stack-spec.md#bucket-visibility-agreed-d-7).

## Changes and sharing

- The owner sets visibility in Finalize or changes it from the settings sheet on Stack detail or in Manage stacks. Save the change on the server before confirming it.
- Switching to Unlisted removes the Stack from discovery while keeping its link accessible. Switching to Private blocks existing links for non-owners, hides other people's saves and reposts, and leaves their pin snapshots without access to the Stack. Saves and reposts can return where accessible if visibility changes back.
- Making a Stack Public makes it eligible for discovery while preserving its existing chronology. To actively promote it again, use **Share update**. The seven-day cooldown belongs to the Stack and survives visibility changes.
- Public and Unlisted Stack links have a 1200×630 preview. Unlisted pages use `noindex`. Private and deleted Stacks use a generic preview and unavailable page without their content.

## Checks

- Test each visibility while signed out, signed in as the owner, and signed in as another person.
- After a change, verify the shared link, profile, feed, search, Explore, and stale repost or preview references all honor access rules. Enforce access at the server even for a viewer who already has the URL.
- Verify changing visibility never duplicates the Stack, resets the cooldown, or discloses non-public titles, thumbnails or counts on a public profile.
