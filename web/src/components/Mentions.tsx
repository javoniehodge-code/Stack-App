"use client";

import { useEffect, useState } from "react";
import { initials } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import s from "./Mentions.module.css";

type Person = { handle: string; name: string };
type Field = HTMLInputElement | HTMLTextAreaElement;

// The "@partial" being typed just before the caret.
const PARTIAL = /(^|[^a-zA-Z0-9._])@([a-zA-Z0-9._]{1,30})$/;

/**
 * @mention autocomplete for a text field. Call `track` from the field's
 * onChange, spread `onKeyDown`, and render <MentionList> next to the field.
 */
export function useMentions(value: string, setValue: (v: string) => void) {
  const [query, setQuery] = useState<{ q: string; end: number; el: Field } | null>(null);
  const [results, setResults] = useState<{ q: string; people: Person[] }>({ q: "", people: [] });
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!query) return;
    const q = query.q;
    const t = setTimeout(async () => {
      const { data } = await createClient()
        .from("profiles")
        .select("handle,name")
        .or(`handle.ilike."${q}*",name.ilike."${q}*"`)
        .order("handle")
        .limit(5);
      setResults({ q, people: (data ?? []) as Person[] });
      setActive(0);
    }, 150);
    return () => clearTimeout(t);
  }, [query]);

  const people = query && results.q === query.q ? results.people : [];

  function track(el: Field) {
    const end = el.selectionStart ?? el.value.length;
    const m = PARTIAL.exec(el.value.slice(0, end));
    setQuery(m ? { q: m[2].toLowerCase(), end, el } : null);
  }

  function choose(p: Person) {
    if (!query) return;
    const start = query.end - query.q.length - 1;
    const next = `${value.slice(0, start)}@${p.handle} ${value.slice(query.end)}`;
    const caret = start + p.handle.length + 2;
    const el = query.el;
    setValue(next);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret);
    });
  }

  /** Arrow keys, Enter/Tab and Escape while suggestions are open. Returns true when it handled the key. */
  function onKeyDown(e: React.KeyboardEvent) {
    if (!people.length) return false;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i + (e.key === "ArrowDown" ? 1 : people.length - 1)) % people.length);
      return true;
    }
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      choose(people[active]);
      return true;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setQuery(null);
      return true;
    }
    return false;
  }

  return { people, active, choose, track, onKeyDown, close: () => setQuery(null) };
}

/** Suggestions shown above the field while typing an @mention. */
export function MentionList({ people, active, choose }: { people: Person[]; active: number; choose: (p: Person) => void }) {
  if (!people.length) return null;
  return (
    <div className={s.list} role="listbox" aria-label="Mention someone">
      {people.map((p, i) => (
        <button
          key={p.handle}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`${s.item} ${i === active ? s.itemActive : ""}`}
          // mousedown so the field keeps focus
          onMouseDown={(e) => {
            e.preventDefault();
            choose(p);
          }}
        >
          <span className={s.avatar}>{initials(p.name)}</span>
          <span className={s.names}>
            <span className={s.name}>{p.name}</span>
            <span className={s.handle}>@{p.handle}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
