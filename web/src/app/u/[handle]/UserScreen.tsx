"use client";

import { useState } from "react";
import { useBack } from "@/components/AppProviders";
import { BackIcon } from "@/components/icons";
import { CompactCard, FollowButton } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import cards from "@/components/Cards.module.css";
import { fmtCount, initials } from "@/lib/format";
import { useIsFollowing } from "@/lib/store";
import type { Profile, Stack } from "@/lib/types";
import { useStackActions } from "@/lib/useStackActions";
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
  const tabStyle = (t: typeof tab) => ({
    color: tab === t ? "var(--text)" : "var(--muted-56)",
    borderBottomColor: tab === t ? "var(--accent)" : "transparent",
  });

  return (
    <main className={shell.screen}>
      <header className={p.header} style={{ paddingTop: "calc(var(--safe-top) + 12px)" }}>
        <button onClick={back} className={p.back}>
          <BackIcon />
          Back
        </button>
        <div className={p.topRow}>
          <div className={p.avatar} style={{ fontSize: 19 }}>
            {initials(profile.name)}
          </div>
          <FollowButton className={p.pillButton} following={isFollowing} onClick={() => a.toggleFollow(profile, isFollowing)} style={{ fontWeight: 700 }} />
        </div>
        <h1 className={p.name}>{profile.name}</h1>
        <div className={p.handle} style={{ marginTop: 2, marginBottom: 0 }}>
          @{profile.handle}
        </div>
        {profile.bio && (
          <div className={p.bio} style={{ marginTop: 10, marginBottom: 0, color: "var(--text-2)", maxWidth: "none" }}>
            {profile.bio}
          </div>
        )}
        <div className={p.stats} style={{ margin: "14px 0 16px" }}>
          <span>
            <strong>{stacks.length}</strong> Stacks
          </span>
          <span>
            <strong>{fmtCount(followers)}</strong> Followers
          </span>
          <span>
            <strong>{fmtCount(counts.following)}</strong> Following
          </span>
        </div>
        <div className={p.tabs} role="tablist">
          <button role="tab" aria-selected={tab === "stacks"} className={p.tab} style={tabStyle("stacks")} onClick={() => setTab("stacks")}>
            Stacks
          </button>
          <button role="tab" aria-selected={tab === "reposts"} className={p.tab} style={tabStyle("reposts")} onClick={() => setTab("reposts")}>
            Reposts
          </button>
        </div>
      </header>
      <div className={cards.userList}>
        {list.map((st) => (
          <CompactCard key={st.id} stack={st} repostedBy={tab === "reposts" ? firstName : undefined} />
        ))}
        {list.length === 0 && <div className={cards.empty}>{tab === "reposts" ? "No reposts yet." : "No stacks yet."}</div>}
      </div>
    </main>
  );
}
