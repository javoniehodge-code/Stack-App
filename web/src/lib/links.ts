// Readable addresses (agreed Nov 27; spec, URLs): a Stack is /{username}/{slug} and a profile is /{username}. The
// older /s/{id} and /u/{username} addresses still work: they forward here (app/s/[id], app/u/[handle]).
import { RESERVED_HANDLES } from "./handles";

/** A Stack's address: /stackapp/cities-to-travel-to, or /s/{id} for one without a slug or author (it forwards). */
export function stackPath(stack: { id: string; slug?: string | null; author?: { handle?: string | null } | null }) {
  const handle = stack.author?.handle;
  return stack.slug && handle ? `/${handle}/${stack.slug}` : `/s/${stack.id}`;
}

/**
 * Whether a path is a Stack's page, which fills the screen (no tab bar): /s/{id}, or /{username}/{slug}, two parts
 * whose first isn't one of the app's own pages (those are all reserved usernames, so no username can match one).
 */
export function isStackPath(path: string) {
  if (path.startsWith("/s/")) return true;
  const parts = path.split("/").filter(Boolean);
  return parts.length === 2 && !RESERVED_HANDLES.includes(decodeURIComponent(parts[0]).toLowerCase());
}

/** A profile's address: /stackapp. */
export const profilePath = (handle: string) => `/${handle.toLowerCase()}`;
