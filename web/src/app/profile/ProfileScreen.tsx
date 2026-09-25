"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth, useToast } from "@/components/AppProviders";
import { SearchIcon } from "@/components/icons";
import SocialLinks from "@/components/SocialLinks";
import { ListCard } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import cards from "@/components/Cards.module.css";
import { fmtCount, initials } from "@/lib/format";
import { useEngagement } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { Stack, StackRow } from "@/lib/types";
import { useStackActions } from "@/lib/useStackActions";
import EditProfileSheet from "./EditProfileSheet";
import MyStacks from "./MyStacks";
import p from "./Profile.module.css";

export type ProfileTab = "mine" | "saved" | "forked" | "drafts";
type Data = { mine: Stack[]; saved: Stack[]; drafts: StackRow[]; counts: { followers: number; following: number } };

export default function ProfileScreen({ data, initialTab }: { data: Data | null; initialTab: ProfileTab }) {
  const { viewer, requireAuth } = useAuth();
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [editing, setEditing] = useState(false);
  const [prevTab, setPrevTab] = useState(initialTab);
  if (initialTab !== prevTab) {
    setPrevTab(initialTab);
    setTab(initialTab);
  }

  if (!viewer || !data) {
    return (
      <main className={`${shell.screen} ${p.gate}`}>
        <h1 className={p.gateTitle}>Sign in to see your profile</h1>
        <div className={p.gateText}>Create a free account to save your lists, follow people, and track your forks.</div>
        <button className={p.gateButton} onClick={() => requireAuth(null, "Create a free account to save your lists, follow people, and track your forks.")}>
          Sign in / Create account
        </button>
      </main>
    );
  }

  const tabStyle = (t: ProfileTab) => ({
    color: tab === t ? "var(--text)" : "var(--muted-56)",
    borderBottomColor: tab === t ? "var(--accent)" : "transparent",
  });
  const forked = data.mine.filter((x) => x.forked_from_id);

  return (
    <main className={shell.screen}>
      <header className={p.header}>
        <div className={p.topRow}>
          <div className={p.avatar}>{initials(viewer.name)}</div>
          <button className={p.editButton} onClick={() => setEditing(true)}>
            Edit profile
          </button>
        </div>
        <h1 className={p.name}>{viewer.name}</h1>
        <div className={p.handle}>@{viewer.handle}</div>
        {viewer.bio && <div className={p.bio}>{viewer.bio}</div>}
        <SocialLinks socials={viewer.socials} />
        <div style={{ height: 14 }} />
        <div className={p.stats}>
          <span>
            <strong>{data.mine.length}</strong> Stacks
          </span>
          <span>
            <strong>{fmtCount(data.counts.followers)}</strong> Followers
          </span>
          <span>
            <strong>{fmtCount(data.counts.following)}</strong> Following
          </span>
        </div>
        <div className={p.tabs} role="tablist">
          {(
            [
              ["mine", "Stacks"],
              ["saved", "Saved"],
              ["forked", "Forked"],
              ["drafts", "Drafts" + (data.drafts.length ? ` · ${data.drafts.length}` : "")],
            ] as const
          ).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={p.tab} style={tabStyle(t)} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </div>
      </header>
      <div className={p.body}>
        {tab === "drafts" && <Drafts drafts={data.drafts} />}
        {tab === "saved" && <Saved saved={data.saved} />}
        {tab === "mine" && <MyStacks profile={viewer} stacks={data.mine} />}
        {tab === "forked" && (
          <>
            {forked.map((st) => (
              <ListCard key={st.id} stack={st} />
            ))}
            {forked.length === 0 && <div className={cards.empty}>Nothing here yet.</div>}
          </>
        )}
      </div>
      {editing && <EditProfileSheet onClose={() => setEditing(false)} />}
    </main>
  );
}

function Drafts({ drafts }: { drafts: StackRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [rows, setRows] = useState(drafts);
  const [prevDrafts, setPrevDrafts] = useState(drafts);
  if (drafts !== prevDrafts) {
    setPrevDrafts(drafts);
    setRows(drafts);
  }

  async function remove(id: string) {
    const prev = rows;
    setRows((r) => r.filter((d) => d.id !== id));
    const { error } = await createClient().from("stacks").delete().eq("id", id);
    if (error) {
      setRows(prev);
      toast("Couldn't delete the draft.");
    } else router.refresh();
  }

  if (rows.length === 0) return <div className={cards.empty}>No drafts yet.</div>;
  return rows.map((d) => (
    <div key={d.id} className={p.draftRow} role="link" tabIndex={0} onClick={() => router.push(`/create?draft=${d.id}`)} onKeyDown={(e) => e.key === "Enter" && router.push(`/create?draft=${d.id}`)}>
      <div style={{ minWidth: 0 }}>
        <div className={p.draftTitle}>{d.title || "Untitled draft"}</div>
        <div className={p.draftMeta}>Draft · {d.line_count} lines</div>
      </div>
      <button
        className={p.draftDelete}
        onClick={(e) => {
          e.stopPropagation();
          remove(d.id);
        }}
      >
        Delete
      </button>
    </div>
  ));
}

function Saved({ saved }: { saved: Stack[] }) {
  const [filter, setFilter] = useState("");
  const f = filter.trim().toLowerCase();
  const rows = saved.filter((x) => !f || x.title.toLowerCase().includes(f) || ("@" + x.author.handle).includes(f) || x.author.name.toLowerCase().includes(f));
  return (
    <>
      {saved.length > 0 && (
        <div className={p.filterWrap}>
          <label className={p.filter}>
            <SearchIcon size={14} color="var(--muted-56)" width={2.2} />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter saved stacks" aria-label="Filter saved stacks" />
          </label>
        </div>
      )}
      {rows.map((st) => (
        <SavedRow key={st.id} stack={st} />
      ))}
      {rows.length === 0 && <div className={cards.empty}>{saved.length === 0 ? "Nothing saved yet." : "No saved stacks match."}</div>}
    </>
  );
}

function SavedRow({ stack }: { stack: Stack }) {
  const router = useRouter();
  const e = useEngagement(stack);
  const a = useStackActions();
  const open = () => router.push(`/s/${stack.id}`);
  return (
    <div className={p.savedRow} role="link" tabIndex={0} onClick={open} onKeyDown={(ev) => ev.key === "Enter" && open()} style={{ opacity: e.saved ? 1 : 0.5 }}>
      <div className={p.savedMain}>
        <div className={p.savedTitle}>{stack.title}</div>
        <div className={p.savedMeta}>
          @{stack.author.handle} · {stack.line_count} lines
        </div>
      </div>
      <button
        className={p.unsave}
        aria-label={e.saved ? "Unsave" : "Save again"}
        onClick={(ev) => {
          ev.stopPropagation();
          a.toggleSave(stack.id, e);
        }}
      >
        {e.saved ? "◆" : "◇"}
      </button>
    </div>
  );
}
