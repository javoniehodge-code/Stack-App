"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth, useToast } from "@/components/AppProviders";
import sheet from "@/components/Sheet.module.css";
import { GridCard } from "@/components/StackCards";
import { VIS } from "@/components/Visibility";
import { plural, timeAgo } from "@/lib/format";
import { fetchProfile } from "@/lib/queries";
import { useVisibility } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Stack } from "@/lib/types";
import Featured from "./Featured";
import f from "./Featured.module.css";
import m from "./MyStacks.module.css";

const meta = (st: Stack) => {
  const when = timeAgo(st.published_at);
  return `${plural(st.line_count, "line")} · Updated ${when === "just now" ? when : `${when} ago`}`;
};

/** Your own Stacks tab: featured stack, then all stacks as a grid (a list with controls while reordering). */
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
  const [sheetOpen, setSheetOpen] = useState<null | "pin">(null);
  const [pinDraft, setPinDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
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

  function openPin() {
    setPinDraft(profile.pinned_stack_id ?? rows[0]?.id ?? null);
    setNoteDraft(profile.pin_note);
    setSheetOpen("pin");
  }

  return (
    <div className={m.wrap}>
      <Featured profile={profile} stacks={stacks} onChange={openPin} />

      <div className={m.listHead}>
        <span className={f.sectionLabel} style={{ margin: 0 }}>
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
                  title={pinned ? "Unpin" : "Pin to featured"}
                  aria-label={pinned ? "Unpin" : "Pin to featured"}
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
      {reordering && <div className={m.hint}>Use the arrows to set the order visitors see. Tap the pin to feature a stack.</div>}
      {rows.length === 0 && <div className={m.empty}>No stacks yet.</div>}

      {sheetOpen === "pin" && (
        <div className={sheet.scrim} onClick={() => setSheetOpen(null)}>
          <div className={sheet.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="pin-title">
            <div className={sheet.grabber} />
            <div id="pin-title" className={m.sheetTitle}>
              Pin a stack
            </div>
            <div className={m.sheetText}>Shows at the top of your profile. Change it anytime.</div>
            {rows.map((st) => {
              const on = st.id === pinDraft;
              return (
                <button key={st.id} className={m.choice} onClick={() => setPinDraft(st.id)} aria-pressed={on} style={{ background: on ? "oklch(91.8% 0.03 60)" : "transparent" }}>
                  <span className={m.rowMain}>
                    <span className={m.choiceTitle}>{st.title}</span>
                    <span className={m.choiceMeta}>{meta(st)}</span>
                  </span>
                  <span className={m.radio} style={{ borderColor: on ? "var(--accent)" : "var(--handle)" }}>
                    <span style={{ background: on ? "var(--accent)" : "transparent" }} />
                  </span>
                </button>
              );
            })}
            {rows.length === 0 && <div className={m.sheetText}>Publish a stack first, then pin it here.</div>}
            <label className={m.fieldLabel} htmlFor="pin-note" style={{ margin: "16px 0 6px" }}>
              Caption
            </label>
            <input id="pin-note" className={m.field} value={noteDraft} maxLength={60} onChange={(e) => setNoteDraft(e.target.value)} placeholder="One line on why this one" />
            <button
              className={sheet.primary}
              style={{ marginTop: 16 }}
              disabled={busy}
              onClick={async () => {
                if (await updateProfile({ pinned_stack_id: pinDraft, pin_note: noteDraft.trim() })) setSheetOpen(null);
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** " · Invite Only" / " · Private" after a row's meta line. */
function VisSuffix({ stack }: { stack: Stack }) {
  const v = useVisibility(stack);
  return v === "public" ? null : <span className={m.visSuffix}> · {VIS[v].label}</span>;
}
