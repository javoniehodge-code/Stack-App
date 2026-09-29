"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth, useToast } from "@/components/AppProviders";
import { SearchIcon } from "@/components/icons";
import { ProfileShareButton } from "@/components/ProfileShare";
import { ListCard } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import cards from "@/components/Cards.module.css";
import { plural } from "@/lib/format";
import { useEngagement } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { MyRepost, Stack, StackRow } from "@/lib/types";
import { useStackActions } from "@/lib/useStackActions";
import EditProfileSheet from "./EditProfileSheet";
import MyStacks from "./MyStacks";
import { ProfileBar, ProfileFooter, ProfileHero } from "./ProfileHead";
import p from "./Profile.module.css";

export type ProfileTab = "mine" | "saved" | "forked" | "reposts" | "drafts";
type Data = { mine: Stack[]; saved: Stack[]; reposts: MyRepost[]; drafts: StackRow[]; counts: { followers: number; following: number } };

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
  const hasContact = !!(viewer.featured_link_label && viewer.featured_link_url);

  return (
    <main className={shell.screen}>
      <ProfileBar right={<ProfileShareButton profile={viewer} stackCount={data.mine.length} own />}>
        <span className={p.wordmark}>
          stack<span className={p.wordmarkDot}>.</span>
        </span>
      </ProfileBar>
      <div className={p.scroll}>
        <ProfileHero profile={viewer} stackCount={data.mine.length} followers={data.counts.followers} following={data.counts.following}>
          <button className={`${p.actionButton} ${p.editProfile}`} style={{ maxWidth: "none" }} onClick={() => setEditing(true)}>
            Edit profile
          </button>
          {hasContact ? (
            <button className={p.contactMine} onClick={() => setEditing(true)} title="Edit custom link">
              <span>{viewer.featured_link_label} ↗</span>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="oklch(92.9% 0.03 60)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }} aria-hidden>
                <path d="M4 20h4L19 9l-4-4L4 16z" />
              </svg>
            </button>
          ) : (
            <button className={p.addContact} onClick={() => setEditing(true)}>
              + Add custom link
            </button>
          )}
        </ProfileHero>
        <div className={p.tabBar}>
          <div className={p.tabs} role="tablist">
            {(
              [
                ["mine", "Stacks"],
                ["saved", "Saved"],
                ["forked", "Forked"],
                ["reposts", "Reposts"],
                ["drafts", "Drafts" + (data.drafts.length ? ` · ${data.drafts.length}` : "")],
              ] as const
            ).map(([t, label]) => (
              <button key={t} role="tab" aria-selected={tab === t} className={p.tab} style={tabStyle(t)} onClick={() => setTab(t)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div>
          {tab === "drafts" && <Drafts drafts={data.drafts} />}
          {tab === "saved" && <Saved saved={data.saved} />}
          {tab === "mine" && <MyStacks profile={viewer} stacks={data.mine} />}
          {tab === "reposts" && <Reposts reposts={data.reposts} />}
          {tab === "forked" && (
            <>
              {forked.map((st) => (
                <ListCard key={st.id} stack={st} />
              ))}
              {forked.length === 0 && <div className={cards.empty}>Nothing here yet.</div>}
            </>
          )}
        </div>
        <ProfileFooter />
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

function Reposts({ reposts }: { reposts: MyRepost[] }) {
  if (reposts.length === 0) return <div className={cards.empty}>No reposts yet. Tap ↻ on any stack to share it here.</div>;
  return (
    <div className={p.reposts}>
      {reposts.map((r) => (
        <RepostRow key={r.stack.id} repost={r} />
      ))}
    </div>
  );
}

function RepostRow({ repost: { stack, note } }: { repost: MyRepost }) {
  const router = useRouter();
  const e = useEngagement(stack);
  const a = useStackActions();
  // Undone from the stack page in this session.
  if (!e.reposted) return null;
  const open = () => router.push(`/s/${stack.id}`);
  return (
    <div className={p.repostRow} role="link" tabIndex={0} onClick={open} onKeyDown={(ev) => ev.target === ev.currentTarget && ev.key === "Enter" && open()}>
      {note && <div className={p.repostNote}>{note}</div>}
      <div className={p.repostTitle}>{stack.title} →</div>
      <div className={p.repostMeta}>
        Originally curated by{" "}
        <Link href={a.authorHref(stack.author)} className={p.repostHandle} onClick={(ev) => ev.stopPropagation()}>
          @{stack.author.handle}
        </Link>{" "}
        · {plural(stack.line_count, "line")}
      </div>
    </div>
  );
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
