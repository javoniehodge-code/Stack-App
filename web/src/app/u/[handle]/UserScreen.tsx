"use client";

import { useState } from "react";
import { useBack } from "@/components/AppProviders";
import { BackIcon } from "@/components/icons";
import { CompactCard, FollowButton } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import cards from "@/components/Cards.module.css";
import { useIsFollowing } from "@/lib/store";
import type { Profile, Stack } from "@/lib/types";
import { useStackActions } from "@/lib/useStackActions";
import { FeaturedStack, ProfileBar, ProfileFooter, ProfileHero } from "@/app/profile/ProfileHead";
import p from "@/app/profile/Profile.module.css";

export default function UserScreen({
  profile,
  stacks,
  reposts,
  counts,
  following,
}: {
  profile: Profile;
  stacks: Stack[];
  reposts: Stack[];
  counts: { followers: number; following: number };
  following: boolean;
}) {
  const back = useBack();
  const a = useStackActions();
  const [tab, setTab] = useState<"stacks" | "reposts">("stacks");
  const isFollowing = useIsFollowing(profile.id, following);
  const followers = counts.followers - (following ? 1 : 0) + (isFollowing ? 1 : 0);
  const firstName = profile.name.split(" ")[0];
  const list = tab === "stacks" ? stacks : reposts;
  const hasContact = !!(profile.featured_link_label && profile.featured_link_url);
  const tabStyle = (t: typeof tab) => ({
    color: tab === t ? "var(--text)" : "var(--muted-56)",
    borderBottomColor: tab === t ? "var(--accent)" : "transparent",
  });

  return (
    <main className={shell.screen}>
      <ProfileBar handle={profile.handle}>
        <button onClick={back} className={p.back} style={{ marginBottom: 0 }}>
          <BackIcon />
          Back
        </button>
      </ProfileBar>
      <div className={p.scroll}>
        <ProfileHero profile={profile} stackCount={stacks.length} followers={followers} following={counts.following}>
          <FollowButton
            className={p.actionButton}
            following={isFollowing}
            label={`Follow ${firstName}`}
            onClick={() => a.toggleFollow(profile, isFollowing)}
            style={isFollowing ? { borderColor: "var(--line-4)" } : undefined}
          />
          {hasContact && (
            <a className={p.contact} href={profile.featured_link_url!} target="_blank" rel="noopener noreferrer nofollow">
              <span>{profile.featured_link_label} ↗</span>
            </a>
          )}
        </ProfileHero>
        <FeaturedStack profile={profile} stacks={stacks} />
        <div className={p.tabs} role="tablist" style={{ padding: "24px 20px 0", borderBottom: "1px solid var(--line)" }}>
          <button role="tab" aria-selected={tab === "stacks"} className={p.tab} style={tabStyle("stacks")} onClick={() => setTab("stacks")}>
            Stacks
          </button>
          <button role="tab" aria-selected={tab === "reposts"} className={p.tab} style={tabStyle("reposts")} onClick={() => setTab("reposts")}>
            Reposts
          </button>
        </div>
        <div className={cards.userList} style={{ overflow: "visible" }}>
          {list.map((st) => (
            <CompactCard key={st.id} stack={st} repostedBy={tab === "reposts" ? firstName : undefined} />
          ))}
          {list.length === 0 && <div className={cards.empty}>{tab === "reposts" ? "No reposts yet." : "No stacks yet."}</div>}
        </div>
        <ProfileFooter />
      </div>
    </main>
  );
}
