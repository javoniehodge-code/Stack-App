"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/AppProviders";
import { FeedCard } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import cards from "@/components/Cards.module.css";
import { PAGE_SIZE, fetchFeed } from "@/lib/queries";
import { createClient } from "@/lib/supabase/client";
import type { FeedItem, Stack } from "@/lib/types";
import s from "./Feed.module.css";

type Tab = "forYou" | "following";
type FeedState = { stacks: FeedItem[]; page: number; done: boolean; loading: boolean };

export default function FeedScreen({ initial }: { initial: Stack[] }) {
  const { viewer } = useAuth();
  const [tab, setTab] = useState<Tab>("forYou");
  const [feeds, setFeeds] = useState<Record<Tab, FeedState | null>>({
    forYou: { stacks: initial, page: 0, done: initial.length < PAGE_SIZE, loading: false },
    following: null,
  });
  const [menuOpen, setMenuOpen] = useState(false);
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
    setMenuOpen(false);
    if (t === tab) return;
    setTab(t);
    railRef.current?.scrollTo({ top: 0 });
    if (feeds[t] === null) load(t, 0);
  }

  // Load the next page when the last card comes into view.
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

  // Escape closes the For you / Following menu.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const option = (t: Tab, label: string) => (
    <button role="menuitemradio" aria-checked={tab === t} className={s.menuItem} onClick={() => selectTab(t)}>
      {label}
      {tab === t && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
    </button>
  );
  const empty = feed && !feed.loading && feed.stacks.length === 0;

  return (
    <main className={shell.screen}>
      <header className={s.header}>
        <div className={s.bar}>
          <h1 className={s.wordmark}>
            stack<span className={s.dot}>.</span>
          </h1>
          <div className={s.picker}>
            <button className={s.pill} onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
              {tab === "following" ? "Following" : "For you"}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-66)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={menuOpen ? s.chevronOpen : s.chevron}>
                <path d="M6 9.5l6 6 6-6" />
              </svg>
            </button>
            {menuOpen && (
              <div className={s.menu} role="menu" aria-label="Feed">
                {option("forYou", "For you")}
                {option("following", "Following")}
              </div>
            )}
          </div>
        </div>
      </header>
      {menuOpen && <div className={s.menuScrim} onClick={() => setMenuOpen(false)} aria-hidden />}

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
        <div ref={railRef} className={cards.feedScroll}>
          {feed?.stacks.map((st) => <FeedCard key={st.id} stack={st} />)}
          {feed && !feed.done && (
            <div ref={sentinelRef} className={cards.feedLoading}>
              Loading…
            </div>
          )}
          {!feed && <div className={cards.feedLoading}>Loading…</div>}
        </div>
      )}
    </main>
  );
}
