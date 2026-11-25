// A sign-in that leaves the page (Continue with Google) can't keep the action that asked for it in memory. Before
// leaving, the app saves what it needs to finish that action once the visitor is back: the page to return to,
// the sign-in message, which action to resume and any state the action needs (such as an unsent comment).
//
// It lives in this tab's sessionStorage only, expires after 15 minutes, and is read exactly once, on the next
// page load. A load that isn't the return from Google drops it: leaving the page cancels the action.

const KEY = "stack-pending-sign-in";
const MAX_AGE_MS = 15 * 60 * 1000;

export type PendingSignIn = { path: string; message: string; resume: string | null; state: unknown; at: number };

/**
 * A same-site path to return to, or "/" for anything else: other sites, protocol-relative URLs, and paths with
 * backslashes or control characters (URL parsers drop tabs and newlines, so "/<tab>/evil.example" would become
 * "//evil.example"). A first filter only: returnUrl() below is the check that counts.
 */
export function safePath(path: string | null | undefined): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) return "/";
  return path;
}

/** The URL to send the browser back to: `path` on `origin`, or the home page if the parsed result isn't on `origin`. */
export function returnUrl(path: string | null | undefined, origin: string): URL {
  const home = new URL("/", origin);
  try {
    const url = new URL(safePath(path), home);
    return url.origin === home.origin ? url : home;
  } catch {
    return home;
  }
}

export function savePending(p: Omit<PendingSignIn, "at">) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...p, path: safePath(p.path), at: Date.now() }));
  } catch {
    // Storage unavailable (private mode limits): sign-in still works, the action just isn't resumed.
  }
}

export function clearPending() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
}

/** Reads and removes the saved sign-in, if there is a recent one. */
export function takePending(): PendingSignIn | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as PendingSignIn;
    if (typeof p?.at !== "number" || Date.now() - p.at > MAX_AGE_MS || typeof p.message !== "string") return null;
    return { path: safePath(p.path), message: p.message, resume: typeof p.resume === "string" ? p.resume : null, state: p.state ?? null, at: p.at };
  } catch {
    return null;
  }
}
