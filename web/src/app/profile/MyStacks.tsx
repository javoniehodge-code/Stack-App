"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth, useToast } from "@/components/AppProviders";
import sheet from "@/components/Sheet.module.css";
import { plural, timeAgo } from "@/lib/format";
import { fetchProfile } from "@/lib/queries";
import { toUrl } from "@/lib/socials";
import { createClient } from "@/lib/supabase/client";
import type { Profile, Stack } from "@/lib/types";
import Featured from "./Featured";
import f from "./Featured.module.css";
import m from "./MyStacks.module.css";

const LINK_PRESETS: [string, string][] = [
  ["Subscribe to my newsletter", "you.substack.com"],
  ["Book a call", "calendly.com/you"],
  ["Shop my picks", "yourshop.com"],
  ["Email me", "mailto:you@example.com"],
];

const meta = (st: Stack) => {
  const when = timeAgo(st.published_at);
  return `${plural(st.line_count, "line")} · Updated ${when === "just now" ? when : `${when} ago`}`;
};

/** Your own Stacks tab: featured stack and link, then all stacks with reordering and pinning. */
export default function MyStacks({ profile, stacks }: { profile: Profile; stacks: Stack[] }) {
  const router = useRouter();
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
  const [sheetOpen, setSheetOpen] = useState<null | "pin" | "link">(null);
  const [pinDraft, setPinDraft] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [linkDraft, setLinkDraft] = useState({ label: "", url: "" });
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

  function openLink() {
    setLinkDraft({ label: profile.featured_link_label ?? "", url: (profile.featured_link_url ?? "").replace(/^https?:\/\//, "") });
    setSheetOpen("link");
  }

  async function saveLink(remove = false) {
    const url = remove ? "" : toUrl(linkDraft.url);
    const ok = await updateProfile(
      url ? { featured_link_label: linkDraft.label.trim() || "Visit my link", featured_link_url: url } : { featured_link_label: null, featured_link_url: null },
    );
    if (ok) setSheetOpen(null);
  }

  return (
    <div className={m.wrap}>
      <Featured profile={profile} stacks={stacks} onChange={openPin} onEditLink={openLink} />

      <div className={m.listHead}>
        <span className={f.sectionLabel} style={{ margin: 0 }}>
          All stacks
        </span>
        {rows.length > 0 && (
          <button className={m.reorder} style={{ color: reordering ? "var(--accent)" : "var(--muted-66)" }} onClick={() => setReordering((r) => !r)}>
            {reordering ? "Done" : "Reorder"}
          </button>
        )}
      </div>
      {rows.map((st, i) => {
        const pinned = st.id === profile.pinned_stack_id;
        const open = () => !reordering && router.push(`/s/${st.id}`);
        return (
          <div
            key={st.id}
            className={m.row}
            role={reordering ? undefined : "link"}
            tabIndex={reordering ? undefined : 0}
            onClick={open}
            onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && open()}
            style={{ cursor: reordering ? "default" : "pointer" }}
          >
            <div className={m.rowMain}>
              <div className={m.rowTitle}>
                {st.title}
                {!reordering && " ↗"}
              </div>
              <div className={m.rowMeta}>{meta(st)}</div>
            </div>
            {pinned && !reordering && <span className={m.pinnedTag}>PINNED</span>}
            {reordering && (
              <div className={m.controls}>
                <button
                  className={m.control}
                  disabled={busy}
                  onClick={() => updateProfile({ pinned_stack_id: pinned ? null : st.id })}
                  title={pinned ? "Unpin" : "Pin to featured"}
                  aria-label={pinned ? "Unpin" : "Pin to featured"}
                  aria-pressed={pinned}
                  style={pinned ? { background: "oklch(32% 0.02 160)", borderColor: "oklch(50% 0.04 160)" } : undefined}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill={pinned ? "var(--accent)" : "none"} stroke={pinned ? "var(--accent)" : "oklch(80% 0.01 165)"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 17v5" />
                    <path d="M9 10.8V4h6v6.8l3 3.2H6z" />
                  </svg>
                </button>
                <button className={m.control} onClick={() => move(st.id, -1)} disabled={i === 0} title="Move up" aria-label="Move up">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="oklch(80% 0.01 165)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 14l6-6 6 6" />
                  </svg>
                </button>
                <button className={m.control} onClick={() => move(st.id, 1)} disabled={i === rows.length - 1} title="Move down" aria-label="Move down">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="oklch(80% 0.01 165)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M6 10l6 6 6-6" />
                  </svg>
                </button>
              </div>
            )}
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
                <button key={st.id} className={m.choice} onClick={() => setPinDraft(st.id)} aria-pressed={on} style={{ background: on ? "oklch(32% 0.02 160)" : "transparent" }}>
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

      {sheetOpen === "link" && (
        <div className={sheet.scrim} onClick={() => setSheetOpen(null)}>
          <form
            className={sheet.sheet}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              saveLink();
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="link-title"
          >
            <div className={sheet.grabber} />
            <div id="link-title" className={m.sheetTitle}>
              Featured link
            </div>
            <div className={m.sheetText}>One button under your featured stack.</div>
            <label className={m.fieldLabel} htmlFor="link-label">
              Button text
            </label>
            <input
              id="link-label"
              className={m.field}
              style={{ marginBottom: 12 }}
              value={linkDraft.label}
              maxLength={40}
              onChange={(e) => setLinkDraft((d) => ({ ...d, label: e.target.value }))}
              placeholder="Subscribe to my newsletter"
            />
            <label className={m.fieldLabel} htmlFor="link-url">
              URL
            </label>
            <input
              id="link-url"
              className={m.field}
              value={linkDraft.url}
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              onChange={(e) => setLinkDraft((d) => ({ ...d, url: e.target.value }))}
              placeholder="yournewsletter.com"
            />
            <div className={m.presets}>
              {LINK_PRESETS.map(([label, url]) => (
                <button key={label} type="button" className={m.preset} onClick={() => setLinkDraft({ label, url })}>
                  {label}
                </button>
              ))}
            </div>
            <div className={m.sheetButtons}>
              <button type="button" className={m.remove} disabled={busy} onClick={() => saveLink(true)}>
                Remove
              </button>
              <button type="submit" className={sheet.primary} style={{ flex: 1, margin: 0 }} disabled={busy}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
