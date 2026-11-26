"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearPending, savePending, takePending, type PendingSignIn } from "@/lib/pendingSignIn";
import { createClient } from "@/lib/supabase/client";
import { resetStore } from "@/lib/store";
import type { Profile } from "@/lib/types";
import AuthSheet from "./AuthSheet";
import styles from "./AppShell.module.css";

type AuthCtx = {
  viewer: Profile | null;
  setViewer: (p: Profile | null) => void;
  /**
   * Runs `action` now if signed in; otherwise asks the viewer to sign in first. `resume` names the action for a
   * sign-in that leaves the page (Google): a component registers it with useResume, so it can be finished on return.
   */
  requireAuth: (action: (() => void) | null, message: string, resume?: string) => void;
};
const AuthContext = createContext<AuthCtx | null>(null);
type Attempt = { id: number; message: string; action: (() => void) | null; resume: string | null; notice: string; opener: HTMLElement | null };

/**
 * Finishes a named action after a sign-in that left the page. `rest` is what follows the registered key in the
 * action's name (for `reply:<stack>` registered and `reply:<stack>:<comment>` resumed, it's the comment id);
 * `state` is what `stash` returned before leaving. It runs once, with the viewer signed in, and must do the work
 * directly rather than through requireAuth.
 */
type Resumer = { run: (rest: string, state: unknown) => void; stash?: () => unknown };
const ResumeContext = createContext<Map<string, Resumer> | null>(null);

/** Registers how to finish the action named `key` (see Resumer). Null registers nothing. */
export function useResume(key: string | null, run: Resumer["run"], stash?: Resumer["stash"]) {
  const map = useContext(ResumeContext);
  const latest = useRef({ run, stash });
  useEffect(() => {
    latest.current = { run, stash };
  });
  useEffect(() => {
    if (!map || !key) return;
    const r: Resumer = { run: (rest, state) => latest.current.run(rest, state), stash: () => latest.current.stash?.() };
    map.set(key, r);
    return () => {
      if (map.get(key) === r) map.delete(key);
    };
  }, [map, key]);
}

/** The registered resumer whose key is the longest `:`-separated prefix of `name`, and the rest of the name. */
function findResumer(map: Map<string, Resumer>, name: string): [Resumer, string] | null {
  const parts = name.split(":");
  for (let i = parts.length; i > 0; i--) {
    const r = map.get(parts.slice(0, i).join(":"));
    if (r) return [r, parts.slice(i).join(":")];
  }
  return null;
}

// What the sign-in sheet says when it reopens after Google.
const GOOGLE_NOTICE: Record<string, string> = {
  cancelled: "",
  existing: "This Gmail inbox already has a Stack account. Continue with email to sign in to it. To use Google next time, connect it in Settings › Account and sign-in.",
  failed: "Couldn’t sign in with Google. Try again, or continue with email.",
};
/** A button on a toast, such as Undo. */
export type ToastAction = { label: string; run: () => void };
const ToastContext = createContext<(msg: string, action?: ToastAction) => void>(() => {});
const BackContext = createContext<(fallback?: unknown) => void>(() => {});

export const useAuth = () => useContext(AuthContext)!;
export const useToast = () => useContext(ToastContext);
/**
 * Retraces in-app navigation, or goes to the feed (or `fallback`, a path) when the viewer arrived from elsewhere.
 * It can be passed straight to onClick; anything but a string is ignored.
 */
export const useBack = () => useContext(BackContext);

export default function AppProviders({ initialViewer, children }: { initialViewer: Profile | null; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [viewer, setViewer] = useState(initialViewer);
  // One sign-in attempt per sheet: its message, the action to run after signing in, and what opened it (for
  // returning focus). Only the current attempt can complete; a cancelled or replaced one is ignored.
  const [sheet, setSheet] = useState<Attempt | null>(null);
  const attempt = useRef<Attempt | null>(null);
  const attempts = useRef(0);
  const [toast, setToast] = useState<{ msg: string; action?: ToastAction } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [resumers] = useState(() => new Map<string, Resumer>());

  // Count in-app navigations so Back knows whether there is anywhere to go back to.
  const depth = useRef(0);
  useEffect(() => {
    depth.current++;
  }, [pathname]);
  const back = useCallback(
    (fallback?: unknown) => {
      if (depth.current > 1) router.back();
      else router.push(typeof fallback === "string" ? fallback : "/");
    },
    [router],
  );

  useEffect(() => {
    const { data } = createClient().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setViewer(null);
        resetStore();
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  /** Opens the sign-in sheet for a new attempt, replacing any open one. */
  const openAttempt = useCallback((message: string, action: (() => void) | null, resume: string | null, notice = "") => {
    const opener = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const a: Attempt = { id: ++attempts.current, message, action, resume, notice, opener };
    attempt.current = a;
    setSheet(a);
  }, []);

  const requireAuth = useCallback(
    (action: (() => void) | null, message: string, resume?: string) => {
      if (viewer) {
        action?.();
        return;
      }
      openAttempt(message, action, resume ?? null);
    },
    [viewer, openAttempt],
  );

  /**
   * Continue with Google for attempt `a`: saves what's needed to finish its action on return, then leaves for
   * Google. Resolves with an error message if Google couldn't be reached (the page stays).
   */
  const startGoogle = async (a: Attempt): Promise<string | null> => {
    const path = window.location.pathname + window.location.search;
    const found = a.resume ? findResumer(resumers, a.resume) : null;
    savePending({ path, message: a.message, resume: a.resume, state: found?.[0].stash?.() ?? null });
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(path)}` },
    });
    if (!error) return null;
    clearPending();
    return "Couldn’t reach Google. Check your connection and try again.";
  };

  const runResume = (p: PendingSignIn) => {
    const found = p.resume ? findResumer(resumers, p.resume) : null;
    found?.[0].run(found[1], p.state);
  };

  // Back from Google (the callback adds ?signin=<result>): finish the saved action, or reopen the sheet. Any other
  // page load drops a saved action, since the visitor left the sign-in. Runs after the page's own effects, so the
  // page's resumers are registered by then.
  useEffect(() => {
    const pending = takePending();
    const url = new URL(window.location.href);
    const result = url.searchParams.get("signin");
    if (!result) return;
    url.searchParams.delete("signin");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    const resume = pending?.resume ? () => runResume(pending) : null;
    // Signed in to an account with a profile: the page already shows it signed in.
    if (result === "google" && initialViewer) return resume?.();
    // Signed in without a profile yet: the sheet continues at choosing a name. Otherwise it starts over.
    openAttempt(pending?.message ?? "Sign in or create an account.", resume, pending?.resume ?? null, GOOGLE_NOTICE[result] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /** Puts focus back on what opened the sheet, once the sheet is gone, if it's still on the page. */
  const refocus = (a: Attempt) =>
    requestAnimationFrame(() => {
      if (a.opener?.isConnected) a.opener.focus({ preventScroll: true });
    });

  const cancelAttempt = useCallback((id: number) => {
    const a = attempt.current;
    if (!a || a.id !== id) return;
    attempt.current = null;
    setSheet(null);
    refocus(a);
  }, []);

  // A toast with an action stays up longer, so there's time to tap it.
  const showToast = useCallback((msg: string, action?: ToastAction) => {
    setToast({ msg, action });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), action ? 5000 : 1800);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  /** Completes attempt `id`: signs the app in and runs its action once. False if that attempt is no longer open. */
  const completeAttempt = (id: number, profile: Profile) => {
    const a = attempt.current;
    if (!a || a.id !== id) return false;
    attempt.current = null;
    setViewer(profile);
    setSheet(null);
    resetStore();
    a.action?.();
    router.refresh();
    refocus(a);
    return true;
  };

  return (
    <AuthContext.Provider value={{ viewer, setViewer, requireAuth }}>
      <ResumeContext.Provider value={resumers}>
      <ToastContext.Provider value={showToast}>
        <BackContext.Provider value={back}>
          {children}
          {toast && (
            <div className={`${styles.toast} ${toast.action ? styles.toastAction : ""}`} role="status">
              <span>{toast.msg}</span>
              {toast.action && (
                <button
                  className={styles.toastButton}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    clearTimeout(toastTimer.current);
                    setToast(null);
                    toast.action?.run();
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </div>
          )}
          {sheet && (
            <AuthSheet
              key={sheet.id}
              message={sheet.message}
              notice={sheet.notice}
              onGoogle={() => startGoogle(sheet)}
              isCurrent={() => attempt.current?.id === sheet.id}
              onCancel={() => cancelAttempt(sheet.id)}
              onSignedIn={(p) => completeAttempt(sheet.id, p)}
            />
          )}
        </BackContext.Provider>
      </ToastContext.Provider>
      </ResumeContext.Provider>
    </AuthContext.Provider>
  );
}
