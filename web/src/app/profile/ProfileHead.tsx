"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/AppProviders";
import SocialLinks from "@/components/SocialLinks";
import { fmtCount, initials, plural } from "@/lib/format";
import type { Profile, Stack } from "@/lib/types";
import f from "./Featured.module.css";
import p from "./Profile.module.css";

/** The fixed bar above a profile: a wordmark or Back on the left, Share profile on the right. */
export function ProfileBar({ handle, children }: { handle: string; children: React.ReactNode }) {
  const toast = useToast();
  async function share() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/u/${handle}`);
      toast("Profile link copied");
    } catch {
      toast("Couldn't copy the link.");
    }
  }
  return (
    <header className={p.bar}>
      <div className={p.barRow}>
        {children}
        <button className={p.share} onClick={share}>
          ↗ Share profile
        </button>
      </div>
    </header>
  );
}

/** Centered avatar, name, bio, socials, the two action buttons and the counts. */
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
      <div className={p.heroAvatar}>{initials(profile.name)}</div>
      <h1 className={p.heroName}>{profile.name}</h1>
      <div className={p.heroHandle}>@{profile.handle}</div>
      {profile.bio && <div className={p.heroBio}>{profile.bio}</div>}
      <SocialLinks socials={profile.socials} />
      <div className={p.actions}>{children}</div>
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
  );
}

/** A visitor's view of the featured stack: the pinned one, or the first stack when nothing is pinned. */
export function FeaturedStack({ profile, stacks }: { profile: Profile; stacks: Stack[] }) {
  const router = useRouter();
  const st = stacks.find((s) => s.id === profile.pinned_stack_id) ?? stacks[0];
  if (!st) return null;
  const note = (st.id === profile.pinned_stack_id && profile.pin_note) || st.description;
  const open = () => router.push(`/s/${st.id}`);
  return (
    <section className={p.featured}>
      <div className={f.sectionLabel}>Featured</div>
      <div className={f.card} role="link" tabIndex={0} onClick={open} onKeyDown={(e) => e.key === "Enter" && open()} style={{ cursor: "pointer" }}>
        <span className={f.kicker}>Featured stack · {plural(st.line_count, "line")}</span>
        <div className={f.title}>{st.title}</div>
        {note && <div className={f.note}>{note}</div>}
        <div className={f.explore}>Explore this stack →</div>
      </div>
    </section>
  );
}

export function ProfileFooter() {
  return (
    <div className={p.footer}>
      Explore the internet, curated by people · <span>Stack</span>
    </div>
  );
}
