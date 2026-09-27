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
 * The pinned stack at the top of your own Stacks tab, with a Change button.
 * Visitors see FeaturedStack in ProfileHead instead.
 */
export default function Featured({
  profile,
  stacks,
  onChange,
}: {
  profile: Profile;
  stacks: Stack[];
  onChange: () => void;
}) {
  const router = useRouter();
  const pinned = stacks.find((s) => s.id === profile.pinned_stack_id) ?? null;

  const open = () => pinned && router.push(`/s/${pinned.id}`);
  return (
    <section>
      <div className={f.sectionLabel}>Featured</div>
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
          <button
            className={f.change}
            onClick={(e) => {
              e.stopPropagation();
              onChange();
            }}
          >
            Change
          </button>
        </div>
        <div className={f.title}>{pinned ? `${pinned.title} ↗` : "Pick a stack to feature"}</div>
        {pinned ? profile.pin_note && <div className={f.note}>{profile.pin_note}</div> : <div className={f.note}>Tap Change to choose one.</div>}
      </div>
    </section>
  );
}
