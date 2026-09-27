"use client";

import { useState } from "react";
import { setVisibility, useVisibility } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { StackRow, Visibility } from "@/lib/types";
import { useToast } from "./AppProviders";
import v from "./Visibility.module.css";

export const VIS: Record<Visibility, { label: string; short: string; long: string; toast: string }> = {
  public: { label: "Public", short: "Profile, search and link", long: "On your profile, in search, and anyone with the link", toast: "Now public" },
  unlisted: { label: "Unlisted", short: "Anyone with the link", long: "Only people with the link. Hidden from your profile and search", toast: "Now unlisted · link only" },
  private: { label: "Private", short: "Only you", long: "Only you. Great for personal notes and collecting ideas", toast: "Now private · only you" },
};
const ORDER: Visibility[] = ["public", "unlisted", "private"];

/** Globe, link or lock. */
export function VisIcon({ value, size = 13, color = "var(--accent)" }: { value: Visibility; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {value === "public" && (
        <>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17" />
          <ellipse cx="12" cy="12" rx="3.8" ry="8.5" />
        </>
      )}
      {value === "unlisted" && (
        <>
          <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
          <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
        </>
      )}
      {value === "private" && (
        <>
          <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
          <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
        </>
      )}
    </svg>
  );
}

/** The rounded "🌐 Public ▾" button that opens the visibility sheet. */
export function VisibilityPill({ value, onClick }: { value: Visibility; onClick: () => void }) {
  return (
    <button
      type="button"
      className={v.pill}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={`Visibility: ${VIS[value].label}. Change`}
    >
      <VisIcon value={value} />
      {VIS[value].label}
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--muted-66)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M6 9.5l6 6 6-6" />
      </svg>
    </button>
  );
}

/** Amber "🔗 Unlisted" / "🔒 Private" tag for your own non-public stacks. */
export function VisibilityBadge({ value }: { value: Visibility }) {
  if (value === "public") return null;
  return (
    <span className={v.badge}>
      <VisIcon value={value} size={11} color="var(--warn)" />
      {VIS[value].label}
    </span>
  );
}

/** "Who can see this stack?" with the three options and, for published stacks, a two-tap Delete. */
export function VisibilitySheet({
  title,
  value,
  note,
  onPick,
  onClose,
  onDelete,
}: {
  title: string;
  value: Visibility;
  note?: string;
  onPick: (v: Visibility) => void;
  onClose: () => void;
  onDelete?: () => Promise<boolean>;
}) {
  const [armed, setArmed] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function del() {
    if (!onDelete || deleting) return;
    if (!armed) return setArmed(true);
    setDeleting(true);
    if (!(await onDelete())) {
      setDeleting(false);
      setArmed(false);
    }
  }

  return (
    <div className={v.scrim} onClick={onClose}>
      <div className={v.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="vis-title">
        <div className={v.grabber} />
        <div id="vis-title" className={v.heading}>
          Who can see this stack?
        </div>
        {note && <div className={v.note}>{note}</div>}
        <div className={v.stackTitle}>{title}</div>
        {ORDER.map((k) => {
          const on = k === value;
          return (
            <button key={k} type="button" className={`${v.option} ${on ? v.optionOn : ""}`} onClick={() => onPick(k)} aria-pressed={on}>
              <span className={v.optionIcon}>
                <VisIcon value={k} size={18} color="oklch(86% 0.05 160)" />
              </span>
              <span className={v.optionText}>
                <span className={v.optionLabel}>{VIS[k].label}</span>
                <span className={v.optionDesc}>{VIS[k].long}</span>
              </span>
              <span className={v.radio}>
                <span />
              </span>
            </button>
          );
        })}
        {onDelete && (
          <>
            <div className={v.divider} />
            <button type="button" className={`${v.delete} ${armed ? v.deleteArmed : ""}`} onClick={del} disabled={deleting}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4.5 6.5h15" />
                <path d="M9.5 6.5V4.5h5v2" />
                <path d="M6.5 6.5l1 13h9l1-13" />
              </svg>
              {deleting ? "Deleting…" : armed ? "Tap again to delete" : "Delete stack"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

type Target = Pick<StackRow, "id" | "title" | "visibility">;

/**
 * Opens the visibility sheet for one of your published stacks and saves the choice.
 * Render `sheet` somewhere in the screen. `onDeleted` runs after Delete stack succeeds.
 */
export function useVisibilityEditor(onDeleted: (id: string) => void) {
  const toast = useToast();
  const [target, setTarget] = useState<{ stack: Target; note?: string } | null>(null);
  const current = useVisibility(target?.stack ?? { id: "", visibility: "public" });

  async function pick(next: Visibility) {
    if (!target) return;
    const { id } = target.stack;
    setTarget(null);
    if (next === current) return;
    const prev = current;
    setVisibility(id, next);
    const { error } = await createClient().rpc("set_stack_visibility", { p_id: id, p_visibility: next });
    if (error) {
      setVisibility(id, prev);
      // PGRST202: the stack_visibility migration hasn't run yet.
      toast(error.code === "PGRST202" ? "Visibility isn't available yet. Try again later." : "Couldn't change who can see this stack.");
      return;
    }
    toast(VIS[next].toast);
  }

  async function remove() {
    if (!target) return false;
    const { id } = target.stack;
    // RLS only lets authors delete their own stacks; an empty result means nothing was removed.
    const { data, error } = await createClient().from("stacks").delete().eq("id", id).select("id");
    if (error || !data?.length) {
      toast("Couldn't delete this stack. Try again.");
      return false;
    }
    setTarget(null);
    toast("Stack deleted");
    onDeleted(id);
    return true;
  }

  const sheet = target && (
    <VisibilitySheet title={target.stack.title} value={current} note={target.note} onPick={pick} onClose={() => setTarget(null)} onDelete={remove} />
  );
  return { open: (stack: Target, note?: string) => setTarget({ stack, note }), sheet };
}
