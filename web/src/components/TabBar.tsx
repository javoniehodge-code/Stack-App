"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { fetchUnreadCount, onNotificationsChanged } from "@/lib/notifications";
import { createClient } from "@/lib/supabase/client";
import { useAuth, useResume } from "./AppProviders";
import { BellIcon, FeedTabIcon, PlusIcon, ProfileTabIcon, SearchIcon } from "./icons";
import styles from "./AppShell.module.css";
import { isStackPath } from "@/lib/links";

const ON = "var(--text)";
const OFF = "var(--muted-56)";

/** Unread notifications for the signed-in viewer; refreshed on navigation, focus and reads. */
function useUnreadCount(path: string) {
  const { viewer } = useAuth();
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!viewer) return;
    let live = true;
    const load = () => fetchUnreadCount(createClient()).then((n) => live && setCount(n));
    load();
    window.addEventListener("focus", load);
    const off = onNotificationsChanged(load);
    return () => {
      live = false;
      window.removeEventListener("focus", load);
      off();
    };
  }, [viewer, path]);
  return viewer ? count : 0;
}

export default function TabBar() {
  const path = usePathname();
  const router = useRouter();
  const { viewer, requireAuth } = useAuth();
  // Back from a Google sign-in started by Create: go on to Create.
  useResume("create", () => router.push("/new"));
  const unread = useUnreadCount(path);
  // The create flow and stack pages are full screen.
  // The editor and a Stack's page fill the screen (a Stack is at /{username}/{slug}, or the older /s/{id}).
  if (path.startsWith("/create") || path === "/new" || path.startsWith("/drafts/") || isStackPath(path)) return null;
  const c = (active: boolean) => (active ? ON : OFF);
  return (
    <nav className={styles.tabBar} aria-label="Main">
      <Link href="/" className={styles.tab} style={{ color: c(path === "/") }} aria-current={path === "/" ? "page" : undefined}>
        <FeedTabIcon color={c(path === "/")} />
        Feed
      </Link>
      <Link href="/explore" className={styles.tab} style={{ color: c(path === "/explore") }} aria-current={path === "/explore" ? "page" : undefined}>
        <SearchIcon size={21} color={c(path === "/explore")} />
        Explore
      </Link>
      <Link
        href="/new"
        className={styles.tab}
        style={{ color: OFF }}
        onClick={(e) => {
          // Signed out: sign in first, then go to Create.
          if (viewer) return;
          e.preventDefault();
          requireAuth(() => router.push("/new"), "Sign in or create an account to start a stack.", "create");
        }}
      >
        <span className={styles.createPill}>
          <PlusIcon />
        </span>
        Create
      </Link>
      <Link
        href="/notifications"
        className={styles.tab}
        style={{ color: c(path === "/notifications") }}
        aria-current={path === "/notifications" ? "page" : undefined}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <span className={styles.bellWrap}>
          <BellIcon color={c(path === "/notifications")} />
          {unread > 0 && <span className={styles.badge}>{unread > 99 ? "99+" : unread}</span>}
        </span>
        Notifications
      </Link>
      <Link href="/profile" className={styles.tab} style={{ color: c(path === "/profile") }} aria-current={path === "/profile" ? "page" : undefined}>
        <ProfileTabIcon color={c(path === "/profile")} />
        Profile
      </Link>
    </nav>
  );
}
