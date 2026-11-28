"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, useTransition } from "react";
import { SearchIcon } from "@/components/icons";
import { FeedCard, TrendingCard } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import cards from "@/components/Cards.module.css";
import { EXPLORE_CATS, EXPLORE_CATS_SHOWN, categoryLabel, categoryStyle, plural, timeAgo } from "@/lib/format";
import type { Stack } from "@/lib/types";
import s from "./Explore.module.css";

type Category = { name: string; emoji: string; color: string; samples: string[] };
type Recent = { id: string; href: string; title: string; meta: string; emoji: string; color: string; publishedAt: string | null };

const RECENTS_KEY = "stack.recentSearches";

// Recent searches live in this browser only.
const NONE: string[] = [];
let cachedRaw: string | null = null;
let cached: string[] = NONE;
const recentsListeners = new Set<() => void>();

function readRecents(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(RECENTS_KEY);
  } catch {
    // Storage disabled: recents just won't persist.
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      const v = JSON.parse(raw ?? "[]");
      cached = Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 5) : NONE;
    } catch {
      cached = NONE;
    }
  }
  return cached;
}
function writeRecents(v: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(v));
  } catch {
    cachedRaw = null;
    cached = v;
  }
  recentsListeners.forEach((l) => l());
}
function subscribeRecents(l: () => void) {
  recentsListeners.add(l);
  window.addEventListener("storage", l);
  return () => {
    recentsListeners.delete(l);
    window.removeEventListener("storage", l);
  };
}

export default function ExploreScreen({
  query,
  category,
  trending,
  categories,
  recent,
  results,
  following,
  trendingCats,
}: {
  query: string;
  /** The category open (tapped in Explore), or null. */
  category: string | null;
  trending: Stack[];
  /** Each Trending Stack's category, shown on its band. */
  trendingCats: Record<string, string>;
  categories: Category[];
  recent: Recent[];
  results: Stack[] | null;
  following: string[];
}) {
  const router = useRouter();
  const [input, setInput] = useState(query);
  const [submitted, setSubmitted] = useState(query);
  const recents = useSyncExternalStore(subscribeRecents, readRecents, () => NONE);
  const [pending, startTransition] = useTransition();
  const [allCats, setAllCats] = useState(false);
  const catsRef = useRef<HTMLElement>(null);
  // The category being opened (before the server answers), or the one open.
  const [openCat, setOpenCat] = useState(category);
  const [prevCategory, setPrevCategory] = useState(category);
  if (category !== prevCategory) {
    setPrevCategory(category);
    setOpenCat(category);
  }

  const [prevQuery, setPrevQuery] = useState(query);
  if (query !== prevQuery) {
    setPrevQuery(query);
    setInput(query);
    setSubmitted(query);
  }

  const updateRecents = writeRecents;

  function submit(term: string) {
    const t = term.trim();
    if (!t) return;
    setInput(t);
    setSubmitted(t);
    updateRecents([t, ...recents.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, 5));
    startTransition(() => router.push(`/explore?q=${encodeURIComponent(t)}`));
  }

  /** Tapping a category chip or box: only the Stacks in that category (choice 2A). */
  function openCategory(name: string) {
    setInput("");
    setSubmitted("");
    setOpenCat(name);
    startTransition(() => router.push(`/explore?cat=${encodeURIComponent(name)}`));
  }

  /** Back: clears the search or category and returns to Explore. */
  function clear() {
    setInput("");
    setSubmitted("");
    setOpenCat(null);
    if (query || category) router.replace("/explore");
  }

  /** The dashed "More categories" chip: opens the full grid and scrolls to it. */
  function moreCategories() {
    setAllCats(true);
    requestAnimationFrame(() => catsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const showCategory = openCat !== null && submitted === "";
  const showResults = submitted !== "" || showCategory;
  const resultsReady = showResults && results !== null && !pending && (showCategory ? openCat === category : submitted === query);
  const shownCats = allCats ? categories : categories.slice(0, EXPLORE_CATS_SHOWN);

  return (
    <main className={shell.screen}>
      <header className={s.header}>
        <h1 className={s.title}>Explore</h1>
        <div className={s.searchRow}>
          {(input.length > 0 || showResults) && (
            <button className={s.back} onClick={clear} aria-label="Back to Explore">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
              Back
            </button>
          )}
          <form
            className={s.search}
            role="search"
            onSubmit={(e) => {
              e.preventDefault();
              submit(input);
            }}
          >
            <SearchIcon size={18} color="var(--muted-66)" width={2.2} />
            <input
              type="search"
              enterKeyHint="search"
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setSubmitted("");
                setOpenCat(null);
              }}
              placeholder="Search bars, books, gear, people…"
              aria-label="Search stacks"
            />
          </form>
        </div>
      </header>

      {!showResults ? (
        <div className={s.body}>
          <div className={s.chips}>
            {EXPLORE_CATS.slice(0, EXPLORE_CATS_SHOWN).map((name) => (
              <button key={name} className={s.chip} style={{ background: categoryStyle(name).color }} onClick={() => openCategory(name)}>
                <span aria-hidden>{categoryStyle(name).emoji}</span>
                {name}
              </button>
            ))}
            <button className={s.chipMore} onClick={moreCategories}>
              More categories
            </button>
          </div>

          {recents.length > 0 && (
            <div className={s.recents}>
              <div className={s.recentsHead}>
                <span className={s.recentsLabel}>Recent searches</span>
                <button className={s.clearRecents} onClick={() => updateRecents([])}>
                  Clear
                </button>
              </div>
              {recents.map((term) => (
                <div key={term} className={s.recentRow}>
                  <button className={s.recentTerm} onClick={() => submit(term)}>
                    {term}
                  </button>
                  <button className={s.recentRemove} aria-label={`Remove ${term}`} onClick={() => updateRecents(recents.filter((r) => r !== term))}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {trending.length > 0 && (
            <section style={{ paddingTop: 22 }}>
              <h2 className={s.sectionTitle} style={{ padding: "0 20px 12px" }}>
                🔥 Trending this week
              </h2>
              <div className={cards.trendingRow}>
                {trending.map((st) => (
                  <TrendingCard key={st.id} stack={st} category={trendingCats[st.id]} />
                ))}
              </div>
            </section>
          )}

          <section className={s.section} ref={catsRef} style={{ scrollMarginTop: 8 }}>
            <h2 className={s.sectionTitle} style={{ marginBottom: 12 }}>
              Categories
            </h2>
            <div className={s.grid}>
              {shownCats.map((c) => (
                <button key={c.name} className={s.category} style={{ background: c.color }} onClick={() => openCategory(c.name)}>
                  <span className={s.categoryHead}>
                    <span className={s.categoryName}>{categoryLabel(c.name)}</span>
                    <span className={s.categoryEmoji} aria-hidden>
                      {c.emoji}
                    </span>
                  </span>
                  <span className={s.samples}>
                    {c.samples.map((t, i) => (
                      <span key={i} className={s.sample}>
                        {t}
                      </span>
                    ))}
                  </span>
                </button>
              ))}
            </div>
            {categories.length > EXPLORE_CATS_SHOWN && (
              <button className={s.catsMore} onClick={() => setAllCats((v) => !v)} aria-expanded={allCats}>
                {allCats ? "Fewer categories" : `More categories · ${categories.length - EXPLORE_CATS_SHOWN} more`}
              </button>
            )}
          </section>

          {recent.length > 0 && (
            <section className={s.section}>
              <h2 className={s.sectionTitle} style={{ marginBottom: 6 }}>
                Recently added
              </h2>
              <div className={s.recentList}>
              {recent.map((r) => (
                <Link key={r.id} href={r.href} className={s.recentStack}>
                  <span className={s.recentSig} style={{ background: r.color }} aria-hidden>
                    {r.emoji}
                  </span>
                  <span className={s.recentMain}>
                    <span className={s.recentTitle}>{r.title}</span>
                    <span className={s.recentMeta}>{r.meta}</span>
                  </span>
                  <span className={s.recentWhen}>{timeAgo(r.publishedAt)}</span>
                </Link>
              ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <div className={s.results}>
          {showCategory && (
            <h2 className={s.catHeading}>
              <span className={s.catHeadingSig} style={{ background: categoryStyle(openCat).color }} aria-hidden>
                {categoryStyle(openCat).emoji}
              </span>
              {openCat}
            </h2>
          )}
          {!resultsReady ? (
            <div className={s.resultCount}>{showCategory ? "Loading…" : "Searching…"}</div>
          ) : (
            <>
              <div className={s.resultCount}>{plural(results.length, "stack")}</div>
              <div className={s.resultList}>
                {results.map((st) => (
                  <FeedCard key={st.id} stack={st} following={following.includes(st.author.id)} />
                ))}
              </div>
              {results.length === 0 && showCategory && (
                <div className={s.noResults}>
                  <div className={s.noResultsTitle}>Nothing in {openCat} yet</div>
                  <div className={s.noResultsText}>Pick it in Finalize when you publish a Stack, and it shows up here.</div>
                </div>
              )}
              {results.length === 0 && !showCategory && (
                <div className={s.noResults}>
                  <div className={s.noResultsTitle}>No results for “{submitted}”</div>
                  <div className={s.noResultsText}>Try a different word, or browse a topic instead.</div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </main>
  );
}
