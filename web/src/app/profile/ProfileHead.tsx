"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtCount, initials } from "@/lib/format";
import { socialLinks } from "@/lib/socials";
import type { Profile } from "@/lib/types";
import p from "./Profile.module.css";

/** The fixed bar above a profile: a wordmark or Back on the left, the share button on the right. */
export function ProfileBar({ children, right }: { children: React.ReactNode; right: React.ReactNode }) {
  return (
    <header className={p.bar}>
      <div className={p.barRow}>
        {children}
        {right}
      </div>
    </header>
  );
}

/** Avatar beside the name, handle and counts; the bio; then the two action buttons. */
export function ProfileHero({
  profile,
  stackCount,
  followers,
  following,
  children,
}: {
  profile: Profile;
  stackCount: number;
  followers: number;
  following: number;
  children: React.ReactNode;
}) {
  return (
    <div className={p.hero}>
      <div className={p.heroTop}>
        <div className={p.heroAvatar}>{initials(profile.name)}</div>
        <div className={p.heroNames}>
          <h1 className={p.heroName}>{profile.name}</h1>
          <div className={p.heroHandle}>@{profile.handle}</div>
          <div className={p.heroStats}>
            <span>
              <strong>{stackCount}</strong> Stacks
            </span>
            <Link href={`/u/${profile.handle}/followers`} className={p.statLink}>
              <strong>{fmtCount(followers)}</strong> Followers
            </Link>
            <Link href={`/u/${profile.handle}/following`} className={p.statLink}>
              <strong>{fmtCount(following)}</strong> Following
            </Link>
          </div>
        </div>
      </div>
      {profile.bio && <div className={p.heroBio}>{profile.bio}</div>}
      <div className={p.actions}>{children}</div>
    </div>
  );
}

/** "Connect ▾": the custom link, socials and email in a menu under the action buttons. */
export function ConnectMenu({ profile, onEditLinks }: { profile: Profile; onEditLinks?: () => void }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const items: { key: string; label: string; sub: string; href: string }[] = [];
  if (profile.featured_link_label && profile.featured_link_url)
    items.push({ key: "custom", label: profile.featured_link_label, sub: profile.featured_link_url.replace(/^(https?:\/\/|mailto:)/i, ""), href: profile.featured_link_url });
  for (const l of socialLinks(profile.socials)) {
    const raw = (profile.socials?.[l.key] ?? "").trim();
    const sub = l.key === "email" ? raw.replace(/^mailto:/i, "") : /^https?:\/\//i.test(raw) ? raw.replace(/^https?:\/\/(www\.)?/i, "") : "@" + raw.replace(/^@/, "");
    items.push({ key: l.key, label: l.label, sub, href: l.href });
  }

  return (
    <>
      <button className={`${p.actionButton} ${p.outline}`} style={open ? { background: "oklch(96.5% 0.004 80)" } : undefined} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        Connect
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted-72)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={open ? p.chevronOpen : p.chevron}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <>
          <div className={p.connectScrim} onClick={() => setOpen(false)} aria-hidden />
          <div className={p.connectMenu} role="menu" aria-label="Connect">
            {items.map((it) => (
              <a
                key={it.key}
                role="menuitem"
                className={p.connectItem}
                href={it.href}
                target={it.key === "email" ? undefined : "_blank"}
                rel="noopener noreferrer nofollow"
                onClick={() => setOpen(false)}
              >
                <span className={p.connectLabel}>{it.label}</span>
                <span className={p.connectSub}>{it.sub}</span>
                <span className={p.connectArrow} aria-hidden>
                  ↗
                </span>
              </a>
            ))}
            {items.length === 0 && <div className={p.connectEmpty}>No links added yet</div>}
            {onEditLinks && (
              <button
                role="menuitem"
                className={p.connectEdit}
                onClick={() => {
                  setOpen(false);
                  onEditLinks();
                }}
              >
                Edit links
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

export function ProfileFooter() {
  return (
    <div className={p.footer}>
      Explore the internet, curated by people · <span>Stack</span>
    </div>
  );
}
