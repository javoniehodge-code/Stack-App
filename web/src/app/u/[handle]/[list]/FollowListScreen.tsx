"use client";

import Link from "next/link";
import { useAuth, useBack } from "@/components/AppProviders";
import { BackIcon } from "@/components/icons";
import { FollowButton } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import { initials } from "@/lib/format";
import type { FollowPerson } from "@/lib/queries";
import { useIsFollowing } from "@/lib/store";
import type { Profile } from "@/lib/types";
import { useStackActions } from "@/lib/useStackActions";
import p from "@/app/profile/Profile.module.css";
import s from "./FollowList.module.css";

function Row({ person, following }: { person: FollowPerson; following: boolean }) {
  const { viewer } = useAuth();
  const a = useStackActions();
  const isFollowing = useIsFollowing(person.id, following);
  const me = viewer?.id === person.id;
  return (
    <div className={s.row}>
      <Link href={a.authorHref(person)} className={s.person}>
        <span className={s.avatar}>{initials(person.name)}</span>
        <span className={s.names}>
          <span className={s.name}>{person.name}</span>
          <span className={s.handle}>@{person.handle}</span>
          {person.bio && <span className={s.bio}>{person.bio}</span>}
        </span>
      </Link>
      {!me && <FollowButton small following={isFollowing} onClick={() => a.toggleFollow(person, isFollowing)} />}
    </div>
  );
}

/** Followers or Following for one person, with a tab to switch between them. */
export default function FollowListScreen({ profile, kind, people, following }: { profile: Profile; kind: "followers" | "following"; people: FollowPerson[]; following: string[] }) {
  const back = useBack();
  const { viewer } = useAuth();
  const mine = viewer?.id === profile.id;
  const base = `/u/${profile.handle}`;
  const empty =
    kind === "followers"
      ? mine
        ? "No followers yet. Share a stack to get started."
        : `No one follows @${profile.handle} yet.`
      : mine
        ? "You're not following anyone yet. Find people on Explore."
        : `@${profile.handle} isn't following anyone yet.`;
  return (
    <main className={shell.screen}>
      <header className={s.header}>
        <button onClick={back} className={p.back}>
          <BackIcon />
          Back
        </button>
        <h1 className={s.title}>{profile.name}</h1>
        <div className={s.tabs} role="tablist">
          {(["followers", "following"] as const).map((k) => (
            <Link key={k} href={`${base}/${k}`} replace role="tab" aria-selected={k === kind} className={`${s.tab} ${k === kind ? s.tabOn : ""}`}>
              {k === "followers" ? "Followers" : "Following"}
            </Link>
          ))}
        </div>
      </header>
      <div className={s.list}>
        {people.map((person) => (
          <Row key={person.id} person={person} following={following.includes(person.id)} />
        ))}
        {people.length === 0 && <div className={s.empty}>{empty}</div>}
      </div>
    </main>
  );
}
