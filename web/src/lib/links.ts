// Readable addresses (agreed Nov 27; spec, URLs): a Stack is /{username}/{slug} and a profile is /{username}. The
// older /s/{id} and /u/{username} addresses still work: they forward here (app/s/[id], app/u/[handle]).

/** A Stack's address: /stackapp/cities-to-travel-to, or /s/{id} for one without a slug or author (it forwards). */
export function stackPath(stack: { id: string; slug?: string | null; author?: { handle?: string | null } | null }) {
  const handle = stack.author?.handle;
  return stack.slug && handle ? `/${handle}/${stack.slug}` : `/s/${stack.id}`;
}

/** A profile's address: /stackapp. */
export const profilePath = (handle: string) => `/${handle.toLowerCase()}`;
