"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { resetStore } from "@/lib/store";
import type { Profile } from "@/lib/types";
import AuthSheet from "./AuthSheet";
import styles from "./AppShell.module.css";

type AuthCtx = {
  viewer: Profile | null;
  setViewer: (p: Profile | null) => void;
  /** Runs `action` now if signed in; otherwise asks the viewer to sign in first. */
  requireAuth: (action: (() => void) | null, message: string) => void;
};
const AuthContext = createContext<AuthCtx | null>(null);
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
  const [sheet, setSheet] = useState<{ message: string } | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const [toast, setToast] = useState<{ msg: string; action?: ToastAction } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  const requireAuth = useCallback(
    (action: (() => void) | null, message: string) => {
      if (viewer) {
        action?.();
        return;
      }
      pending.current = action;
      setSheet({ message });
    },
    [viewer],
  );

  // A toast with an action stays up longer, so there's time to tap it.
  const showToast = useCallback((msg: string, action?: ToastAction) => {
    setToast({ msg, action });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), action ? 4500 : 1800);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const onSignedIn = (profile: Profile) => {
    setViewer(profile);
    setSheet(null);
    resetStore();
    const action = pending.current;
    pending.current = null;
    action?.();
    router.refresh();
  };

  return (
    <AuthContext.Provider value={{ viewer, setViewer, requireAuth }}>
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
              message={sheet.message}
              onCancel={() => {
                pending.current = null;
                setSheet(null);
              }}
              onSignedIn={onSignedIn}
            />
          )}
        </BackContext.Provider>
      </ToastContext.Provider>
    </AuthContext.Provider>
  );
}
