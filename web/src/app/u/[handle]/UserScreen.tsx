"use client";

import { useState } from "react";
import { useAuth, useBack } from "@/components/AppProviders";
import { BackIcon } from "@/components/icons";
import { ProfileShareButton } from "@/components/ProfileShare";
import { FollowButton, GridCard } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import cards from "@/components/Cards.module.css";
import { useIsFollowing } from "@/lib/store";
import type { Profile, Stack } from "@/lib/types";
import { useStackActions } from "@/lib/useStackActions";
import { ConnectMenu, ProfileBar, ProfileFooter, ProfileHero } from "@/app/profile/ProfileHead";
import p from "@/app/profile/Profile.module.css";
import BlockSheet from "./BlockSheet";

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
  const [blocking, setBlocking] = useState(false);
  const { requireAuth } = useAuth();
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
      <ProfileBar
        right={
          <ProfileShareButton
            profile={profile}
            stackCount={stacks.length}
            own={false}
            onBlock={() => requireAuth(() => setBlocking(true), "Sign in to block accounts.")}
          />
        }
      >
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
            style={isFollowing ? { borderColor: "var(--handle)" } : undefined}
          />
          <ConnectMenu profile={profile} />
        </ProfileHero>
        <div className={p.tabs} role="tablist" style={{ padding: "24px 20px 0", borderBottom: "1px solid var(--line)" }}>
          <button role="tab" aria-selected={tab === "stacks"} className={p.tab} style={tabStyle("stacks")} onClick={() => setTab("stacks")}>
            Stacks
          </button>
          <button role="tab" aria-selected={tab === "reposts"} className={p.tab} style={tabStyle("reposts")} onClick={() => setTab("reposts")}>
            Reposts
          </button>
        </div>
        {list.length > 0 ? (
          <div className={cards.userGrid}>
            {list.map((st) => (
              <GridCard key={st.id} stack={st} visitor repost={tab === "reposts"} />
            ))}
          </div>
        ) : (
          <div className={cards.empty}>{tab === "reposts" ? "No reposts yet." : "No stacks yet."}</div>
        )}
        <ProfileFooter />
      </div>
      {blocking && <BlockSheet profile={profile} onClose={() => setBlocking(false)} />}
    </main>
  );
}
