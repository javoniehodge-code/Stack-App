"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth, useToast } from "@/components/AppProviders";
import shell from "@/components/AppShell.module.css";
import { ShareSheet } from "@/components/Share";
import { editedDay } from "@/components/StackView";
import { EditPill, VIS, useVisibilityEditor } from "@/components/Visibility";
import { plural } from "@/lib/format";
import { SHOW_DRAFTS } from "@/lib/navFlags";
import { useVisibilityLookup } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { Stack, StackRow, Visibility } from "@/lib/types";
import p from "../../profile/Profile.module.css";
import SettingsHeader from "../SettingsHeader";
import s from "./Manage.module.css";

export type Filter = "all" | Visibility | "drafts";

const TABS: [Filter, string][] = [
  ["all", "All"],
  ["public", "Public"],
  ["unlisted", "Invite Only"],
  ["private", "Private"],
  ["drafts", "Drafts"],
];

const HINTS: Record<Filter, string> = {
  all: "Everything you've made. Tap Edit to change a stack or who can see it.",
  public: "Shown on your profile, in search, and to anyone with the link.",
  unlisted: "Only people with the link can view. Good for itineraries and one-off recommendations.",
  private: "Only you can see these. Use them to collect ideas for yourself.",
  drafts: "Unfinished stacks. Only you can see them until you publish.",
};

/** Your stacks and drafts, filtered by who can see them, with an Edit pill on each stack. */
export default function ManageScreen({ data, initialFilter = "all" }: { data: { stacks: Stack[]; drafts: StackRow[] } | null; initialFilter?: Filter }) {
  const router = useRouter();
  const toast = useToast();
  const { requireAuth } = useAuth();
  const visOf = useVisibilityLookup();
  // Back from an edit whose changes were kept as a draft: open on Drafts (this screen is reached in-app then).
  const [showDrafts] = useState(() => {
    try {
      return typeof window !== "undefined" && sessionStorage.getItem(SHOW_DRAFTS) === "1";
    } catch {
      return false;
    }
  });
  const [filter, setFilter] = useState<Filter>(showDrafts ? "drafts" : initialFilter);
  // ...and reload so the new draft is listed.
  useEffect(() => {
    if (!showDrafts) return;
    try {
      sessionStorage.removeItem(SHOW_DRAFTS);
    } catch {}
    router.refresh();
  }, [showDrafts, router]);
  const [removed, setRemoved] = useState<Set<string>>(() => new Set());
  // The stack whose share sheet is open (from a row's link button).
  const [sharing, setSharing] = useState<Stack | null>(null);
  const vis = useVisibilityEditor((id) => {
    setRemoved((r) => new Set(r).add(id));
    router.refresh();
  });

  if (!data) {
    return (
      <main className={`${shell.screen} ${p.gate}`}>
        <h1 className={p.gateTitle}>Sign in to manage your stacks</h1>
        <button className={p.gateButton} onClick={() => requireAuth(null, "Sign in to manage your stacks.")}>
          Sign in / Create account
        </button>
      </main>
    );
  }

  const stacks = data.stacks.filter((st) => !removed.has(st.id));
  const drafts = data.drafts.filter((d) => !removed.has(d.id));
  const by = (v: Visibility) => stacks.filter((st) => visOf(st) === v);
  const counts: Record<Filter, number> = {
    all: stacks.length + drafts.length,
    public: by("public").length,
    unlisted: by("unlisted").length,
    private: by("private").length,
    drafts: drafts.length,
  };
  const shownStacks = filter === "drafts" ? [] : filter === "all" ? stacks : by(filter);
  const shownDrafts = filter === "all" || filter === "drafts" ? drafts : [];
  const empty = shownStacks.length + shownDrafts.length === 0;

  async function deleteDraft(id: string) {
    setRemoved((r) => new Set(r).add(id));
    const { error } = await createClient().from("stacks").delete().eq("id", id);
    if (error) {
      setRemoved((r) => {
        const next = new Set(r);
        next.delete(id);
        return next;
      });
      toast("Couldn't delete the draft.");
    } else router.refresh();
  }

  const go = (href: string) => () => router.push(href);

  return (
    <main className={shell.screen}>
      <SettingsHeader title="Manage stacks">
        <div className={s.tabs} role="tablist">
          {TABS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={filter === key} className={`${s.tab} ${filter === key ? s.tabOn : ""}`} onClick={() => setFilter(key)}>
              {label}
              <span className={s.tabCount}>{counts[key]}</span>
            </button>
          ))}
        </div>
      </SettingsHeader>
      <div className={s.scroll}>
        <div className={s.hint}>{HINTS[filter]}</div>
        {shownStacks.map((st) => {
          const edited = editedDay(st.published_at, st.updated_at);
          return (
            <div key={st.id} className={s.row} role="link" tabIndex={0} onClick={go(`/s/${st.id}`)} onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && go(`/s/${st.id}`)()}>
              <div className={s.main}>
                <div className={s.title}>{st.title}</div>
                <div className={s.meta}>
                  {plural(st.line_count, "line")} · {VIS[visOf(st)].label}
                  {edited && ` · Updated ${edited}`}
                </div>
              </div>
              {visOf(st) !== "private" && (
                <button
                  type="button"
                  className={s.share}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSharing(st);
                  }}
                  aria-label={`Share ${st.title}`}
                  title="Share link"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
                    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
                  </svg>
                </button>
              )}
              <EditPill onClick={() => vis.openWithEdit(st)} />
            </div>
          );
        })}
        {shownDrafts.map((d) => (
          <div key={d.id} className={s.row} role="link" tabIndex={0} onClick={go(`/create?draft=${d.id}`)} onKeyDown={(e) => e.target === e.currentTarget && e.key === "Enter" && go(`/create?draft=${d.id}`)()}>
            <div className={s.main}>
              <div className={s.title}>{d.title || "Untitled stack"}</div>
              <div className={s.meta}>
                {d.edit_of ? "Unsaved edits to a published stack" : `${plural(d.line_count, "line")} · publishes as ${VIS[d.visibility ?? "public"].label.toLowerCase()}`}
              </div>
            </div>
            <div className={s.draftSide}>
              <span className={s.draftTag}>DRAFT</span>
              <button
                className={s.draftDelete}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteDraft(d.id);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {empty && <div className={s.empty}>{filter === "drafts" ? "No drafts." : `No ${filter === "all" ? "" : `${filter} `}stacks yet.`}</div>}
      </div>
      {vis.sheet}
      {sharing && <ShareSheet stack={sharing} onClose={() => setSharing(null)} />}
    </main>
  );
}
