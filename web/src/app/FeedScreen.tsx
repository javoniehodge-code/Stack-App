"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AppProviders";
import { SearchIcon } from "@/components/icons";
import { FeedSlide } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import cards from "@/components/Cards.module.css";
import { PAGE_SIZE, fetchFeed } from "@/lib/queries";
import { createClient } from "@/lib/supabase/client";
import type { Stack } from "@/lib/types";
import s from "./Feed.module.css";

type Tab = "forYou" | "following";
type FeedState = { stacks: Stack[]; page: number; done: boolean; loading: boolean };

export default function FeedScreen({ initial }: { initial: Stack[] }) {
  const { viewer } = useAuth();
  const [tab, setTab] = useState<Tab>("forYou");
  const [feeds, setFeeds] = useState<Record<Tab, FeedState | null>>({
    forYou: { stacks: initial, page: 0, done: initial.length < PAGE_SIZE, loading: false },
    following: null,
  });
  const railRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Server data changes when the viewer signs in or out (router.refresh).
  const [prevInitial, setPrevInitial] = useState(initial);
  if (initial !== prevInitial) {
    setPrevInitial(initial);
    setFeeds({ forYou: { stacks: initial, page: 0, done: initial.length < PAGE_SIZE, loading: false }, following: null });
    setTab("forYou");
  }

  const feed = feeds[tab];

  async function load(which: Tab, page: number) {
    setFeeds((f) => ({ ...f, [which]: { ...(f[which] ?? { stacks: [], page: 0, done: false }), loading: true } }));
    try {
      const more = await fetchFeed(createClient(), viewer?.id ?? null, { page, following: which === "following" });
      setFeeds((f) => {
        const prev = page === 0 ? [] : (f[which]?.stacks ?? []);
        const seen = new Set(prev.map((x) => x.id));
        return { ...f, [which]: { stacks: [...prev, ...more.filter((x) => !seen.has(x.id))], page, done: more.length < PAGE_SIZE, loading: false } };
      });
    } catch {
      setFeeds((f) => ({ ...f, [which]: { ...(f[which] ?? { stacks: [], page: 0 }), done: true, loading: false } }));
    }
  }

  function selectTab(t: Tab) {
    if (t === tab) return;
    setTab(t);
    railRef.current?.scrollTo({ top: 0 });
    if (feeds[t] === null) load(t, 0);
  }

  // Load the next page when the last slide comes into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !feed || feed.done) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !feed.loading) load(tab, feed.page + 1);
    }, { root: railRef.current, rootMargin: "0px 0px 100% 0px" });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed, tab]);

  const tabStyle = (t: Tab) => ({
    color: tab === t ? "var(--text)" : "var(--muted-60)",
    borderBottomColor: tab === t ? "var(--accent)" : "transparent",
  });
  const empty = feed && !feed.loading && feed.stacks.length === 0;

  return (
    <main className={shell.screen}>
      <header className={s.header}>
        <div className={s.bar}>
          <h1 className={s.wordmark}>Stack</h1>
          <Link href="/explore" className={s.searchBtn} aria-label="Search">
            <SearchIcon />
          </Link>
        </div>
        <div className={s.tabs} role="tablist">
          <button role="tab" aria-selected={tab === "forYou"} className={s.tab} style={tabStyle("forYou")} onClick={() => selectTab("forYou")}>
            For You
          </button>
          <button role="tab" aria-selected={tab === "following"} className={s.tab} style={tabStyle("following")} onClick={() => selectTab("following")}>
            Following
          </button>
        </div>
      </header>

      {empty ? (
        <div className={s.empty}>
          <div className={s.emptyTitle}>Nothing here yet</div>
          <div className={s.emptyText}>
            {tab === "following" ? "Follow people whose taste you trust and their stacks land here." : "No stacks have been published yet. Be the first."}
          </div>
          <Link href={tab === "following" ? "/explore" : "/create"} className={s.emptyCta}>
            {tab === "following" ? "Find people" : "Create a stack"}
          </Link>
        </div>
      ) : (
        <div className={cards.rail}>
          <div ref={railRef} className={cards.railScroll}>
            {feed?.stacks.map((st) => <FeedSlide key={st.id} stack={st} />)}
            {feed && !feed.done && (
              <div ref={sentinelRef} className={`${cards.slide} ${cards.loadingSlide}`}>
                Loading…
              </div>
            )}
            {!feed && <div className={`${cards.slide} ${cards.loadingSlide}`}>Loading…</div>}
          </div>
        </div>
      )}
    </main>
  );
}
