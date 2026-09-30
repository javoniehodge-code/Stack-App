"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth, useToast } from "@/components/AppProviders";
import { GridCard } from "@/components/StackCards";
import { VIS } from "@/components/Visibility";
import { plural, timeAgo } from "@/lib/format";
import { fetchProfile } from "@/lib/queries";
import { useVisibility } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Stack } from "@/lib/types";
import m from "./MyStacks.module.css";

const meta = (st: Stack) => {
  const when = timeAgo(st.published_at);
  return `${plural(st.line_count, "line")} · Updated ${when === "just now" ? when : `${when} ago`}`;
};

/** Your own Stacks tab: all stacks as a grid (a list with controls while reordering). */
export default function MyStacks({ profile, stacks }: { profile: Profile; stacks: Stack[] }) {
  const toast = useToast();
  const { setViewer } = useAuth();
  const [order, setOrder] = useState(() => stacks.map((s) => s.id));
  const [prevStacks, setPrevStacks] = useState(stacks);
  if (stacks !== prevStacks) {
    setPrevStacks(stacks);
    setOrder(stacks.map((s) => s.id));
  }
  const byId = new Map(stacks.map((s) => [s.id, s]));
  const rows = order.map((id) => byId.get(id)).filter((s): s is Stack => !!s);

  const [reordering, setReordering] = useState(false);
  const [busy, setBusy] = useState(false);

  async function updateProfile(fields: Partial<Profile>) {
    setBusy(true);
    const sb = createClient();
    const { error } = await sb.from("profiles").update(fields).eq("id", profile.id);
    const data = error ? null : await fetchProfile(sb, "id", profile.id);
    setBusy(false);
    if (error || !data) {
      toast("Couldn't save that. Try again.");
      return false;
    }
    setViewer(data as Profile);
    return true;
  }

  async function move(id: string, dir: -1 | 1) {
    const i = order.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const prev = order;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
    const { error } = await createClient().rpc("set_stack_order", { p_ids: next });
    if (error) {
      setOrder(prev);
      toast("Couldn't save the new order.");
    }
  }

  return (
    <div className={m.wrap}>
      <div className={m.listHead}>
        <span className={m.sectionLabel} style={{ margin: 0 }}>
          All stacks
        </span>
        {rows.length > 0 && (
          <div className={m.headLinks}>
            <Link href="/settings/stacks" className={m.reorder} style={{ color: "var(--accent)" }}>
              Manage
            </Link>
            <button className={m.reorder} style={{ color: reordering ? "var(--accent)" : "var(--muted-66)" }} onClick={() => setReordering((r) => !r)}>
              {reordering ? "Done" : "Reorder"}
            </button>
          </div>
        )}
      </div>
      {!reordering && rows.length > 0 && (
        <div className={m.grid}>
          {rows.map((st) => (
            <GridCard key={st.id} stack={st} pinned={st.id === profile.pinned_stack_id} />
          ))}
        </div>
      )}
      {reordering &&
        rows.map((st, i) => {
          const pinned = st.id === profile.pinned_stack_id;
          return (
            <div key={st.id} className={m.row}>
              <div className={m.rowMain}>
                <div className={m.rowTitle}>{st.title}</div>
                <div className={m.rowMeta}>
                  {meta(st)}
                  <VisSuffix stack={st} />
                </div>
              </div>
              <div className={m.controls}>
                <button
                  className={m.control}
                  disabled={busy}
                  onClick={() => updateProfile({ pinned_stack_id: pinned ? null : st.id })}
                  title={pinned ? "Unpin" : "Pin"}
                  aria-label={pinned ? "Unpin" : "Pin"}
                  aria-pressed={pinned}
                  style={pinned ? { background: "oklch(91.8% 0.03 60)", borderColor: "oklch(60% 0.03 60)" } : undefined}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill={pinned ? "var(--accent)" : "none"} stroke={pinned ? "var(--accent)" : "oklch(28.6% 0.006 80)"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 17v5" />
                    <path d="M9 10.8V4h6v6.8l3 3.2H6z" />
                  </svg>
                </button>
                <button className={m.control} onClick={() => move(st.id, -1)} disabled={i === 0} title="Move up" aria-label="Move up">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="oklch(28.6% 0.006 80)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 14l6-6 6 6" />
                  </svg>
                </button>
                <button className={m.control} onClick={() => move(st.id, 1)} disabled={i === rows.length - 1} title="Move down" aria-label="Move down">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="oklch(28.6% 0.006 80)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 10l6 6 6-6" />
                  </svg>
                </button>
              </div>
            </div>
          );
        })}
      {reordering && <div className={m.hint}>Use the arrows to set the order visitors see. Tap the pin to highlight a stack.</div>}
      {rows.length === 0 && <div className={m.empty}>No stacks yet.</div>}

    </div>
  );
}

/** " · Invite Only" / " · Private" after a row's meta line. */
function VisSuffix({ stack }: { stack: Stack }) {
  const v = useVisibility(stack);
  return v === "public" ? null : <span className={m.visSuffix}> · {VIS[v].label}</span>;
}
