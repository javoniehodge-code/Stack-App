// Username rules, shared by profile setup and Edit profile. The database enforces the same rules
// (profiles_handle_check and handle_is_reserved() in supabase/migrations/20261125000000_email_code_sign_in.sql).

/** Names the app uses for its own pages. Keep in sync with handle_is_reserved() in the database. */
export const RESERVED_HANDLES = [
  "explore", "me", "new", "drafts", "inbox", "settings", "help", "terms", "privacy", "buckets", "login",
  "signup", "api", "admin", "about", "support", "stack",
  "s", "u", "create", "profile", "notifications", "auth",
  // the app's files at the top level (a username can contain a dot)
  "favicon.ico", "robots.txt", "sitemap.xml", "manifest.json", "manifest.webmanifest", "icon.png", "apple-icon.png",
];

export const HANDLE_MAX = 30;

/** Lowercases, drops a leading @ and removes spaces, the way the username field does while typing. */
export const normalizeHandle = (v: string) => v.trim().replace(/^@/, "").toLowerCase().replace(/\s/g, "");

/** Why a username can't be used, or null when it's fine (availability is checked on the server). */
export function handleProblem(h: string): string | null {
  if (!h) return "3–30 characters: letters, numbers, dots and underscores.";
  if (h.length < 3) return "At least 3 characters.";
  if (h.length > HANDLE_MAX) return "At most 30 characters.";
  if (!/^[a-z0-9._]+$/.test(h)) return "Only letters, numbers, dots and underscores.";
  if (/^[._]|[._]$/.test(h)) return "Can’t start or end with a dot or underscore.";
  if (RESERVED_HANDLES.includes(h)) return `@${h} isn’t available. Try another.`;
  return null;
}
