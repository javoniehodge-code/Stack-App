"use client";

import Link from "next/link";
import { useAuth } from "@/components/AppProviders";
import { ProfileShareButton } from "@/components/ProfileShare";
import { SocialIcon } from "@/components/SocialLinks";
import { FeedCard } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import { initials } from "@/lib/format";
import { socialLinks } from "@/lib/socials";
import { useVisibilityLookup } from "@/lib/store";
import type { Stack } from "@/lib/types";
import { ProfileBar, ProfileFooter } from "../ProfileHead";
import p from "../Profile.module.css";

/** How many stacks the public profile shows before "N of M stacks". */
const SHOWN = 4;

/** Your profile as people with the link see it: name, social icons and your first public stacks as feed cards. */
export default function PublicPreviewScreen({ stacks }: { stacks: Stack[] }) {
  const { viewer } = useAuth();
  const visOf = useVisibilityLookup();
  if (!viewer) return null;

  // The pinned stack comes first, like on your profile.
  const pub = stacks
    .filter((st) => visOf(st) === "public")
    .sort((a, b) => Number(b.id === viewer.pinned_stack_id) - Number(a.id === viewer.pinned_stack_id));
  const shown = pub.slice(0, SHOWN);
  const countLabel = !pub.length ? "No public stacks yet" : shown.length < pub.length ? `${shown.length} of ${pub.length} stacks` : pub.length === 1 ? "1 stack" : `${pub.length} stacks`;
  const socials = socialLinks(viewer.socials);

  return (
    <main className={shell.screen}>
      <ProfileBar right={<ProfileShareButton profile={viewer} stackCount={pub.length} own />}>
        <span className={p.wordmark}>
          stack<span className={p.wordmarkDot}>.</span>
        </span>
      </ProfileBar>
      <div className={p.scroll}>
        <div className={p.previewBanner}>
          <span>Previewing your public profile</span>
          <Link href="/profile" replace className={p.previewDone}>
            Done
          </Link>
        </div>
        <div className={p.publicHero}>
          <div className={p.publicAvatar}>{initials(viewer.name)}</div>
          <h1 className={p.publicName}>{viewer.name}</h1>
          {socials.length > 0 && (
            <div className={p.publicSocials}>
              {socials.map((l) => (
                <a key={l.key} href={l.href} target={l.key === "email" ? undefined : "_blank"} rel="noopener noreferrer nofollow" title={l.label} aria-label={l.label} className={p.publicSocial}>
                  <SocialIcon name={l.key} size={20} />
                </a>
              ))}
            </div>
          )}
        </div>
        <div className={p.publicStacks}>
          <div className={p.publicCount}>{countLabel}</div>
          <div className={p.publicCards}>
            {shown.map((st) => (
              <FeedCard key={st.id} stack={st} />
            ))}
          </div>
        </div>
        <ProfileFooter />
      </div>
    </main>
  );
}
