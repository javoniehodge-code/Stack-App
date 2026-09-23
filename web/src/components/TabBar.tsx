"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FeedTabIcon, PlusIcon, ProfileTabIcon, SearchIcon } from "./icons";
import styles from "./AppShell.module.css";

const ON = "var(--text)";
const OFF = "var(--muted-56)";

export default function TabBar() {
  const path = usePathname();
  if (path.startsWith("/create")) return null;
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
      <Link href="/create" className={styles.tab} style={{ color: OFF }}>
        <span className={styles.createPill}>
          <PlusIcon />
        </span>
        Create
      </Link>
      <Link href="/profile" className={styles.tab} style={{ color: c(path === "/profile") }} aria-current={path === "/profile" ? "page" : undefined}>
        <ProfileTabIcon color={c(path === "/profile")} />
        Profile
      </Link>
    </nav>
  );
}
