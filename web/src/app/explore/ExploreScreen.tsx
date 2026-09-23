"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, useTransition } from "react";
import { SearchIcon } from "@/components/icons";
import { ListCard, TrendingCard } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import cards from "@/components/Cards.module.css";
import { EXPLORE_CATS, plural, timeAgo } from "@/lib/format";
import type { Stack } from "@/lib/types";
import s from "./Explore.module.css";

type Category = { name: string; dot: string; samples: string[] };
type Recent = { id: string; title: string; meta: string; dot: string; publishedAt: string | null };

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
  trending,
  categories,
  recent,
  results,
  following,
}: {
  query: string;
  trending: Stack[];
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

  function clear() {
    setInput("");
    setSubmitted("");
    if (query) router.replace("/explore");
  }

  const showResults = submitted !== "";
  const resultsReady = showResults && results !== null && submitted === query && !pending;

  return (
    <main className={shell.screen}>
      <header className={s.header}>
        <h1 className={s.title}>Explore</h1>
        <div className={s.searchRow}>
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
              }}
              placeholder="Search bars, books, gear, people…"
              aria-label="Search stacks"
            />
          </form>
          {input.length > 0 && (
            <button className={s.cancel} onClick={clear}>
              Cancel
            </button>
          )}
        </div>
      </header>

      {!showResults ? (
        <div className={s.body}>
          <div className={s.chips}>
            {EXPLORE_CATS.map((name) => (
              <button key={name} className={s.chip} onClick={() => submit(name)}>
                {name}
              </button>
            ))}
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
                Trending this week
              </h2>
              <div className={cards.trendingRow}>
                {trending.map((st) => (
                  <TrendingCard key={st.id} stack={st} />
                ))}
              </div>
            </section>
          )}

          <section className={s.section}>
            <h2 className={s.sectionTitle} style={{ marginBottom: 12 }}>
              Categories
            </h2>
            <div className={s.grid}>
              {categories.map((c) => (
                <button key={c.name} className={s.category} onClick={() => submit(c.name)}>
                  <span className={s.categoryHead}>
                    <span className={s.dot} style={{ background: c.dot }} />
                    <span className={s.categoryName}>{c.name}</span>
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
          </section>

          {recent.length > 0 && (
            <section className={s.section}>
              <h2 className={s.sectionTitle} style={{ marginBottom: 6 }}>
                Recently added
              </h2>
              {recent.map((r) => (
                <Link key={r.id} href={`/s/${r.id}`} className={s.recentStack}>
                  <span className={s.dot} style={{ background: r.dot }} />
                  <span className={s.recentMain}>
                    <span className={s.recentTitle}>{r.title}</span>
                    <span className={s.recentMeta}>{r.meta}</span>
                  </span>
                  <span className={s.recentWhen}>{timeAgo(r.publishedAt)}</span>
                </Link>
              ))}
            </section>
          )}
        </div>
      ) : (
        <div className={s.results}>
          {!resultsReady ? (
            <div className={s.resultCount}>Searching…</div>
          ) : (
            <>
              <div className={s.resultCount}>{plural(results.length, "stack")}</div>
              {results.map((st) => (
                <ListCard key={st.id} stack={st} following={following.includes(st.author.id)} />
              ))}
              {results.length === 0 && (
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
