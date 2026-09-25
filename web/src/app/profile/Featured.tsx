"use client";

import { useRouter } from "next/navigation";
import { plural } from "@/lib/format";
import type { Profile, Stack } from "@/lib/types";
import f from "./Featured.module.css";

export function EditIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted-72)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </svg>
  );
}

/**
 * The pinned stack and featured link at the top of a profile. Owners get the
 * Change / edit-link controls; visitors see only what has been set.
 */
export default function Featured({
  profile,
  stacks,
  onChange,
  onEditLink,
}: {
  profile: Profile;
  stacks: Stack[];
  onChange?: () => void;
  onEditLink?: () => void;
}) {
  const router = useRouter();
  const owner = !!onChange;
  const pinned = stacks.find((s) => s.id === profile.pinned_stack_id) ?? null;
  const hasLink = !!(profile.featured_link_label && profile.featured_link_url);
  if (!pinned && !hasLink) return null;

  const open = () => pinned && router.push(`/s/${pinned.id}`);
  return (
    <section>
      <div className={f.sectionLabel}>Featured</div>
      {(pinned || owner) && (
        <div
          className={f.card}
          role={pinned ? "link" : undefined}
          tabIndex={pinned ? 0 : undefined}
          onClick={open}
          onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && open()}
          style={{ cursor: pinned ? "pointer" : "default" }}
        >
          <div className={f.cardTop}>
            <span className={f.kicker}>Featured stack · {pinned ? plural(pinned.line_count, "line") : "none"}</span>
            {owner && (
              <button
                className={f.change}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange();
                }}
              >
                Change
              </button>
            )}
          </div>
          <div className={f.title}>{pinned ? `${pinned.title} ↗` : "Pick a stack to feature"}</div>
          {pinned ? profile.pin_note && <div className={f.note}>{profile.pin_note}</div> : <div className={f.note}>Tap Change to choose one.</div>}
        </div>
      )}
      {(hasLink || owner) && (
        <div className={f.linkRow}>
          {hasLink ? (
            <a className={f.linkButton} href={profile.featured_link_url!} target="_blank" rel="noopener noreferrer nofollow">
              {profile.featured_link_label} ↗
            </a>
          ) : (
            <button className={f.addLink} onClick={onEditLink}>
              + Add a featured link
            </button>
          )}
          {owner && (
            <button className={f.editLink} onClick={onEditLink} title="Edit featured link" aria-label="Edit featured link">
              <EditIcon />
            </button>
          )}
        </div>
      )}
    </section>
  );
}
