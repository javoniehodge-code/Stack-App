"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useToast } from "@/components/AppProviders";
import shell from "@/components/AppShell.module.css";
import { systemShare } from "@/components/Share";
import { StackPaper } from "@/components/StackView";
import { initials, MAX_DESCRIPTION, MAX_HEAD, MAX_ITEMS, MAX_LABEL, MAX_NOTE, MAX_SECTIONS, MAX_TITLE, MAX_TOTAL } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { Draft, Visibility } from "@/lib/types";
import p from "../profile/Profile.module.css";
import s from "./Create.module.css";

type Step = "title" | "description" | "build" | "review";
type Line = { id: string; text: string; link: string; note: string };
type Sec = { id: string; headed: boolean; label: string; lines: Line[] };
// Tags are no longer edited here; a draft keeps the ones it already had.
type Work = { title: string; description: string; tags: string[]; visibility: Visibility; location: string; sections: Sec[] };
type Sel = { kind: "line" | "sec"; id: string } | null;
type SaveState = "idle" | "saving" | "saved" | "error" | "over";

const STEPS: Record<Step, [number, string]> = { title: [1, "Title"], description: [2, "Description"], build: [3, "Build"], review: [4, "Finalize"] };
const PRIVACY: [Visibility, string, string][] = [
  ["public", "Public", "Anyone can find it on your profile and in search"],
  ["unlisted", "Invite Only", "Only people with the link"],
  ["private", "Private", "Only you"],
];
const FAV_BG = ["oklch(45% 0.13 30)", "oklch(38% 0.08 250)", "oklch(40% 0.09 150)", "oklch(28% 0.01 80)", "oklch(46% 0.13 60)"];
const UNTITLED = "Untitled draft";

let nextId = 1;
const uid = () => `k${nextId++}`;
const newLine = (text = "", link = "", note = ""): Line => ({ id: uid(), text, link, note });

/** Site name, domain and a colored letter tile for a link (no fetching). */
function linkMeta(url: string) {
  const domain = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0];
  const base = domain.split(".")[0] ?? domain;
  const name = base.charAt(0).toUpperCase() + base.slice(1);
  let h = 0;
  for (const c of domain) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return { domain, name, letter: name.charAt(0).toUpperCase(), bg: FAV_BG[h % FAV_BG.length] };
}

function fromDraft(d: Draft): Work {
  const sections: Sec[] = d.sections.map((sec, i) => ({
    id: uid(),
    headed: i > 0 || !!sec.label.trim(),
    label: sec.label,
    lines: sec.lines.map((l) => newLine(l.text, l.link, l.note ?? "")),
  }));
  if (!sections.length) sections.push({ id: uid(), headed: false, label: "", lines: [] });
  return { title: d.title === UNTITLED ? "" : d.title, description: d.description, tags: d.tags, visibility: d.visibility, location: d.location, sections };
}

const counts = (w: Work) => {
  let n = 0;
  let k = 0;
  w.sections.forEach((sec) => sec.lines.forEach((l) => (l.text.trim() && n++, l.link && k++)));
  return { n, k };
};
const n0 = (x: number) => x.toLocaleString("en-US");

/**
 * What in this stack is over a size limit, in words (empty when it fits). Mirrors the database's checks, which
 * count only items with a heading. Stacks made before the limits can be over; they save again once trimmed.
 */
function limitProblems(w: Work): string[] {
  const out: string[] = [];
  const items = w.sections.flatMap((sec) => sec.lines.filter((l) => l.text.trim()));
  const headed = w.sections.filter((sec) => sec.headed);
  let total = w.title.trim().length + w.description.trim().length;
  headed.forEach((sec) => (total += sec.label.trim().length));
  items.forEach((l) => (total += l.text.trim().length + l.note.trim().length));
  if (w.title.trim().length > MAX_TITLE) out.push(`Shorten the title to ${MAX_TITLE} characters.`);
  if (w.description.trim().length > MAX_DESCRIPTION) out.push(`Shorten the description to ${n0(MAX_DESCRIPTION)} characters.`);
  if (w.sections.length > MAX_SECTIONS) out.push(`Use at most ${MAX_SECTIONS} subsections (this has ${w.sections.length}).`);
  if (headed.some((sec) => sec.label.trim().length > MAX_LABEL)) out.push(`Keep subsection titles to ${MAX_LABEL} characters.`);
  if (items.length > MAX_ITEMS) out.push(`Use at most ${MAX_ITEMS} items (this has ${items.length}).`);
  const longHeads = items.filter((l) => l.text.trim().length > MAX_HEAD).length;
  if (longHeads) out.push(`Shorten ${longHeads === 1 ? "1 item heading" : `${longHeads} item headings`} to ${MAX_HEAD} characters.`);
  if (items.some((l) => l.note.trim().length > MAX_NOTE)) out.push(`Keep item notes to ${MAX_NOTE} characters.`);
  if (total > MAX_TOTAL) out.push(`Trim the text to ${n0(MAX_TOTAL)} characters in all (this has ${n0(total)}).`);
  return out;
}

const hasContent = (w: Work) => !!(w.title.trim() || w.description.trim() || w.sections.some((sec) => sec.lines.some((l) => l.text.trim() || l.link)));

/** A pasted link: letter tile, site name and domain. */
function LinkCard({ link, onRemove }: { link: string; onRemove?: () => void }) {
  const m = linkMeta(link);
  return (
    <div className={s.linkCard}>
      <span className={s.fav} style={{ background: m.bg }}>
        {m.letter}
      </span>
      <span className={s.linkText}>
        <span className={s.linkTitle}>{m.name}</span>
        <span className={s.linkDomain}>{m.domain}</span>
      </span>
      {onRemove ? (
        <button className={s.linkRemove} onClick={onRemove} aria-label="Remove link">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-60)" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
          </svg>
        </button>
      ) : (
        <a className={s.linkArrow} href={link} target="_blank" rel="noopener noreferrer nofollow ugc" aria-label={`Open ${m.domain}`} onClick={(e) => e.stopPropagation()}>
          ↗
        </a>
      )}
    </div>
  );
}

/** The four-step create flow: title, description, build (edit in place), finalize. Drafts save automatically. */
export default function CreateScreen({ initial, start }: { initial: Draft; start: "title" | "build" }) {
  const router = useRouter();
  const { viewer, requireAuth } = useAuth();
  const toast = useToast();
  const [work, setWork] = useState<Work>(() => fromDraft(initial));
  const [step, setStep] = useState<Step>(start);
  const [preview, setPreview] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [linkOpen, setLinkOpen] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [sheet, setSheet] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [save, setSave] = useState<SaveState>(initial.id ? "saved" : "idle");
  const [published, setPublished] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // The draft's id once it has been saved, and a queue so saves never overlap (the first one creates the row).
  const idRef = useRef<string | null>(initial.id);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const dirty = useRef(false);
  const workRef = useRef(work);
  useEffect(() => {
    workRef.current = work;
  }, [work]);

  const persist = useCallback(
    (status: "draft" | "published", title?: string) => {
      const run = async (): Promise<string | null> => {
        const w = workRef.current;
        const t = (title ?? w.title).trim();
        const args = {
          p_id: idRef.current,
          p_title: status === "draft" && !t ? UNTITLED : t,
          p_sections: w.sections.map((sec) => ({ label: sec.headed ? sec.label : "", lines: sec.lines.map((l) => ({ text: l.text, note: l.note.trim() || null, link: l.link || null })) })),
          p_tags: w.tags,
          p_status: status,
          p_forked_from: initial.forkedFromId,
          p_style: initial.style,
          p_description: w.description.trim(),
          p_visibility: w.visibility,
        };
        const sb = createClient();
        let { data, error } = await sb.rpc("save_stack", { ...args, p_location: w.location.trim() });
        // Before the line_notes_location migration runs, save_stack has no p_location and the database drops
        // line notes. Keep them by writing "Line — note", which stacks show as the same head and gray note.
        if (error?.code === "PGRST202") {
          const folded = w.sections.map((sec) => ({
            label: sec.headed ? sec.label : "",
            lines: sec.lines.map((l) => ({ text: (l.note.trim() && l.text.trim() ? `${l.text.trim()} — ${l.note.trim()}` : l.text).slice(0, 500), link: l.link || null })),
          }));
          ({ data, error } = await sb.rpc("save_stack", { ...args, p_sections: folded }));
        }
        if (error) return error.message;
        idRef.current = data as string;
        return null;
      };
      const next = queue.current.then(run, run);
      queue.current = next;
      return next;
    },
    [initial.forkedFromId, initial.style],
  );

  const edit = (fn: (w: Work) => Work) => {
    setWork(fn);
    dirty.current = true;
    if (viewer) setSave("saving");
  };

  // Autosave a moment after the last change, once there's something to keep.
  useEffect(() => {
    if (!viewer || !dirty.current || published) return;
    const t = setTimeout(async () => {
      if (!hasContent(workRef.current)) return setSave("idle");
      // Over a limit: nothing is saved until it's trimmed (the banner says what to change).
      if (limitProblems(workRef.current).length) return setSave("over");
      dirty.current = false;
      const err = await persist("draft");
      setSave(err ? "error" : "saved");
    }, 1200);
    return () => clearTimeout(t);
  }, [work, viewer, persist, published]);

  // Focus the field that was just added or selected.
  const focusId = useRef<string | null>(null);
  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-fid="${id}"]`);
    if (!el) return;
    focusId.current = null;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });

  const mapLine = (id: string, fn: (l: Line) => Line) => edit((w) => ({ ...w, sections: w.sections.map((sec) => ({ ...sec, lines: sec.lines.map((l) => (l.id === id ? fn(l) : l)) })) }));

  function addLine(secId: string, afterId?: string) {
    if (work.sections.reduce((n, sec) => n + sec.lines.length, 0) >= MAX_ITEMS) return toast(`A stack can have at most ${MAX_ITEMS} items.`);
    const l = newLine();
    focusId.current = l.id;
    edit((w) => ({
      ...w,
      sections: w.sections.map((sec) => {
        if (sec.id !== secId) return sec;
        const lines = [...sec.lines];
        const i = afterId ? lines.findIndex((x) => x.id === afterId) : -1;
        if (i >= 0) lines.splice(i + 1, 0, l);
        else lines.push(l);
        return { ...sec, lines };
      }),
    }));
    setSel({ kind: "line", id: l.id });
    setLinkOpen(null);
  }

  function moveLine(id: string, dir: -1 | 1) {
    edit((w) => {
      const secs = w.sections.map((x) => ({ ...x, lines: [...x.lines] }));
      const si = secs.findIndex((x) => x.lines.some((l) => l.id === id));
      if (si < 0) return w;
      const cur = secs[si].lines;
      const i = cur.findIndex((l) => l.id === id);
      const j = i + dir;
      if (j >= 0 && j < cur.length) [cur[i], cur[j]] = [cur[j], cur[i]];
      else if (dir < 0 && si > 0) secs[si - 1].lines.push(...cur.splice(i, 1));
      else if (dir > 0 && si < secs.length - 1) secs[si + 1].lines.unshift(...cur.splice(i, 1));
      return { ...w, sections: secs };
    });
  }

  function deleteLine(id: string) {
    edit((w) => ({ ...w, sections: w.sections.map((sec) => ({ ...sec, lines: sec.lines.filter((l) => l.id !== id) })) }));
    setSel(null);
    setLinkOpen(null);
  }

  function addSection() {
    if (work.sections.length >= MAX_SECTIONS) return toast(`A stack can have at most ${MAX_SECTIONS} subsections.`);
    const sid = uid();
    focusId.current = sid;
    edit((w) => ({ ...w, sections: [...w.sections, { id: sid, headed: true, label: "", lines: [newLine()] }] }));
    setSel({ kind: "sec", id: sid });
    setLinkOpen(null);
  }

  function addTopSection() {
    const first = work.sections[0];
    if (!first || first.headed) return;
    focusId.current = first.id;
    edit((w) => ({ ...w, sections: w.sections.map((x, i) => (i === 0 ? { ...x, headed: true, label: "", lines: x.lines.length ? x.lines : [newLine()] } : x)) }));
    setSel({ kind: "sec", id: first.id });
    setLinkOpen(null);
  }

  function moveSection(id: string, dir: -1 | 1) {
    edit((w) => {
      const i = w.sections.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= w.sections.length || !w.sections[i].headed || !w.sections[j].headed) return w;
      const secs = [...w.sections];
      [secs[i], secs[j]] = [secs[j], secs[i]];
      return { ...w, sections: secs };
    });
  }

  function removeSection(id: string) {
    edit((w) => {
      const i = w.sections.findIndex((x) => x.id === id);
      if (i < 0) return w;
      if (i === 0) return { ...w, sections: w.sections.map((x, k) => (k === 0 ? { ...x, headed: false, label: "" } : x)) };
      const secs = w.sections.map((x) => ({ ...x, lines: [...x.lines] }));
      secs[i - 1].lines.push(...secs[i].lines);
      secs.splice(i, 1);
      return { ...w, sections: secs };
    });
    setSel(null);
  }

  function submitLink(id: string, raw: string) {
    const v = raw.trim();
    setLinkOpen(null);
    setLinkDraft("");
    if (!v) return;
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    if (!/^https?:\/\/[^\s.]+\.\S+$/i.test(url) || url.length > 2048) return toast("That doesn't look like a link.");
    mapLine(id, (l) => ({ ...l, link: url }));
  }



  function goBuild() {
    setStep("build");
    setSel(null);
    // With nothing written yet, open the first line for typing.
    if (work.sections.some((sec) => sec.lines.some((l) => l.text.trim() || l.link))) return;
    const first = work.sections[0]?.lines[0];
    const l = first ?? newLine();
    if (!first) setWork((w) => ({ ...w, sections: w.sections.map((x, i) => (i === 0 ? { ...x, lines: [l] } : x)) }));
    focusId.current = l.id;
    setSel({ kind: "line", id: l.id });
  }

  const flush = async () => {
    const over = limitProblems(workRef.current)[0];
    if (over) {
      setSave("over");
      return over;
    }
    dirty.current = false;
    setSave("saving");
    const err = await persist("draft");
    setSave(err ? "error" : "saved");
    return err;
  };

  function exit() {
    if (!hasContent(work)) return router.push("/");
    requireAuth(async () => {
      const err = await flush();
      if (err) return toast(`Couldn't save: ${err}`);
      toast("Draft saved");
      router.push("/profile?tab=drafts");
      router.refresh();
    }, "Sign in to keep this draft.");
  }

  function saveDraft() {
    if (!hasContent(work)) return toast("Add something first, then save it as a draft.");
    requireAuth(async () => {
      const err = await flush();
      toast(err ? `Couldn't save: ${err}` : "Draft saved. Pick it up anytime from Profile › Drafts.");
    }, "Sign in to save this stack as a draft.");
  }

  async function doPublish(title: string) {
    setBusy(true);
    dirty.current = false;
    const err = await persist("published", title);
    setBusy(false);
    if (err) return toast(err.includes("sign in") ? "Sign in to continue." : `Couldn't publish: ${err}`);
    setSheet(false);
    setWork((w) => ({ ...w, title }));
    setPublished(idRef.current);
    router.refresh();
  }

  function publish() {
    if (!counts(work).n) return toast("Add a line with some text to publish.");
    const over = limitProblems(work)[0];
    if (over) return toast(over);
    if (!work.title.trim()) {
      focusId.current = "sheet";
      setTitleDraft("");
      setSheet(true);
      return;
    }
    requireAuth(() => doPublish(work.title.trim()), "Sign in to publish this stack and share it with others.");
  }

  function startOver() {
    idRef.current = null;
    dirty.current = false;
    setWork(fromDraft({ ...initial, id: null, title: "", description: "", tags: [], sections: [], forkedFromId: null, visibility: "public", location: "" }));
    setStep("title");
    setPreview(false);
    setSel(null);
    setPublished(null);
    setSave("idle");
    router.replace("/create");
  }

  async function share(id: string) {
    const url = `${window.location.origin}/s/${id}`;
    const r = await systemShare({ title: work.title, url });
    if (r !== "unsupported") return;
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied to clipboard");
    } catch {
      toast("Couldn't copy the link");
    }
  }

  // Signed-out visitors sign in first (the Create tab asks before coming here).
  if (!viewer) {
    return (
      <main className={`${shell.screen} ${p.gate}`}>
        <h1 className={p.gateTitle}>Sign in to start a stack</h1>
        <div className={p.gateText}>Create a free account to make stacks, save drafts, and share them.</div>
        <button className={p.gateButton} onClick={() => requireAuth(null, "Sign in or create an account to start a stack.")}>
          Sign in / Create account
        </button>
        <Link href="/" className={s.gateBack}>
          Back to the feed
        </Link>
      </main>
    );
  }

  const { n, k } = counts(work);
  const problems = limitProblems(work);
  const countLabel = n === 0 ? "No lines yet" : `${n} ${n === 1 ? "line" : "lines"}${k ? ` · ${k} ${k === 1 ? "link" : "links"}` : ""}`;
  const shownTitle = work.title.trim() || "Untitled Stack";

  if (published) {
    return (
      <main className={`${shell.screen} ${s.done}`}>
        <button className={`${s.exit} ${s.doneExit}`} onClick={() => router.replace("/profile")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
          </svg>
          Exit
        </button>
        <div className={s.doneIcon}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--warn)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        </div>
        <h1 className={s.doneTitle}>Your Stack is live</h1>
        <div className={s.doneMeta}>
          {shownTitle} · {countLabel}
        </div>
        <div className={s.doneActions}>
          <button className={s.primary} onClick={() => share(published)}>
            Share
          </button>
          {/* Replace, so leaving the stack page doesn't land back in the finished create flow. */}
          <Link href={`/s/${published}?from=create`} replace className={s.secondary}>
            View your Stack
          </Link>
          <button className={s.quiet} onClick={startOver}>
            Start another Stack
          </button>
        </div>
      </main>
    );
  }

  const [stepNum, stepName] = STEPS[step];
  const allIds = work.sections.flatMap((sec) => sec.lines.map((l) => l.id));
  const clearSel = () => {
    setSel(null);
    setLinkOpen(null);
  };

  const arrow = (d: "up" | "down") => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted-72)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={d === "up" ? "M6 14.5l6-6 6 6" : "M6 9.5l6 6 6-6"} />
    </svg>
  );

  const header = !preview && (
    <header className={s.header}>
      <div className={s.headerRow}>
        <div>
          <button className={s.exit} onClick={exit}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
            </svg>
            Exit
          </button>
        </div>
        <div className={s.status}>
          {step !== "title" && step !== "description" && (
            <>
              <span className={s.statusDot} data-state={save === "over" ? "error" : save} />
              {save === "saving" ? "Saving…" : save === "saved" ? "Saved just now" : save === "error" ? "Couldn't save" : save === "over" ? "Too long to save" : "New draft"}
            </>
          )}
        </div>
        <div className={s.headerEnd}>
          <button className={s.saveDraft} onClick={saveDraft}>
            Save draft
          </button>
        </div>
      </div>
      <div className={s.progress}>
        <div className={s.segments}>
          {[1, 2, 3, 4].map((i) => (
            <span key={i} className={i <= stepNum ? s.segOn : s.seg} />
          ))}
        </div>
        <span className={s.stepLabel}>
          {stepNum}/4 · {stepName}
        </span>
      </div>
    </header>
  );

  let num = 0;
  let pn = 0;

  return (
    <main className={`${shell.screen} ${step === "review" && preview ? s.previewMain : ""}`}>
      {header}

      {step === "title" && (
        <div className={s.prompt}>
          <input
            ref={(el) => {
              if (el && !el.dataset.f) {
                el.dataset.f = "1";
                el.focus();
              }
            }}
            className={s.promptTitle}
            value={work.title}
            maxLength={MAX_TITLE}
            onChange={(e) => edit((w) => ({ ...w, title: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                setStep("description");
              }
            }}
            aria-label="Title"
          />
          <div className={s.promptText}>What would you like to call this Stack?</div>
          <button className={s.skip} onClick={() => setStep("description")}>
            {work.title.trim() ? "Next" : "Skip"}
          </button>
        </div>
      )}

      {step === "description" && (
        <div className={s.prompt}>
          <textarea
            ref={(el) => {
              if (el && !el.dataset.f) {
                el.dataset.f = "1";
                el.focus();
              }
            }}
            className={s.promptDesc}
            value={work.description}
            rows={1}
            maxLength={MAX_DESCRIPTION}
            onChange={(e) => edit((w) => ({ ...w, description: e.target.value.slice(0, MAX_DESCRIPTION) }))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                goBuild();
              }
            }}
            aria-label="Description"
          />
          <div className={s.promptText}>What is this Stack about?</div>
          <button className={s.skip} onClick={goBuild}>
            {work.description.trim() ? "Next" : "Skip"}
          </button>
        </div>
      )}
      {step === "description" && (
        <footer className={s.promptFooter}>
          <button className={s.back} onClick={() => setStep("title")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M14.5 5.5L8 12l6.5 6.5" />
            </svg>
            Back
          </button>
        </footer>
      )}

      {step === "build" && (
        <>
          <div className={s.scroll}>
            <div className={s.author}>
              <span className={s.avatar}>{initials(viewer.name)}</span>
              <span className={s.authorText}>
                <span className={s.authorName}>{viewer.name}</span>
                <span className={s.authorMeta}>@{viewer.handle} · Draft, only you can see it</span>
              </span>
            </div>
            <input
              className={s.buildTitle}
              data-empty={!work.title || undefined}
              value={work.title}
              maxLength={MAX_TITLE}
              onChange={(e) => edit((w) => ({ ...w, title: e.target.value }))}
              onFocus={clearSel}
              placeholder="Add a title"
              aria-label="Title"
            />
            <textarea
              className={s.buildDesc}
              data-empty={!work.description || undefined}
              value={work.description}
              rows={1}
              maxLength={MAX_DESCRIPTION}
              onChange={(e) => edit((w) => ({ ...w, description: e.target.value.slice(0, MAX_DESCRIPTION) }))}
              onFocus={clearSel}
              placeholder="Add a description (optional)"
              aria-label="Description"
            />
            <div style={{ height: 14 }} />
            {problems.length > 0 && (
              <div className={s.limitBanner} role="alert">
                <strong>This stack is over a size limit, so it won&apos;t save yet.</strong>
                <ul>
                  {problems.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </div>
            )}
            {!work.sections[0]?.headed && (
              <button className={s.addSub} onClick={addTopSection}>
                + Add subsection
              </button>
            )}

            {work.sections.map((sec, si) => {
              const secSel = sel?.kind === "sec" && sel.id === sec.id;
              return (
                <div key={sec.id} className={s.section}>
                  {sec.headed && (
                    <div className={s.sectionHead}>
                      <input
                        data-fid={sec.id}
                        className={s.sectionInput}
                        value={sec.label}
                        maxLength={Math.max(MAX_LABEL, sec.label.length)}
                        onChange={(e) => {
                          const v = e.target.value;
                          edit((w) => ({ ...w, sections: w.sections.map((x) => (x.id === sec.id ? { ...x, label: v } : x)) }));
                        }}
                        onFocus={() => {
                          setSel({ kind: "sec", id: sec.id });
                          setLinkOpen(null);
                        }}
                        placeholder="Subsection heading"
                        aria-label="Subsection heading"
                      />
                      {secSel && (
                        <div className={s.controls}>
                          <button className={s.control} onClick={() => moveSection(sec.id, -1)} disabled={!(si > 0 && work.sections[si - 1].headed)} aria-label="Move subsection up">
                            {arrow("up")}
                          </button>
                          <button className={s.control} onClick={() => moveSection(sec.id, 1)} disabled={si >= work.sections.length - 1} aria-label="Move subsection down">
                            {arrow("down")}
                          </button>
                          <button className={s.textControl} onClick={() => removeSection(sec.id)}>
                            Remove heading
                          </button>
                          <span style={{ flex: 1 }} />
                          <button className={s.doneBtn} onClick={clearSel}>
                            Done
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {sec.lines.map((l) => {
                    num++;
                    const n2 = String(num).padStart(2, "0");
                    const isSel = sel?.kind === "line" && sel.id === l.id;
                    if (!isSel) {
                      return (
                        <div
                          key={l.id}
                          className={`${s.line} ${l.id === sec.lines[sec.lines.length - 1].id ? "" : s.lineDivided}`}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            focusId.current = l.id;
                            setSel({ kind: "line", id: l.id });
                            setLinkOpen(null);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              focusId.current = l.id;
                              setSel({ kind: "line", id: l.id });
                            }
                          }}
                        >
                          <span className={s.num}>{n2}</span>
                          <div className={s.lineBody}>
                            <div className={l.text ? s.lineText : s.lineEmpty}>{l.text || "Empty line — tap to write"}</div>
                            {l.note.trim() && <div className={s.lineNote}>{l.note}</div>}
                            {l.link && <span className={s.visit}>Visit site ↗</span>}
                          </div>
                        </div>
                      );
                    }
                    const open = linkOpen === l.id;
                    return (
                      <div key={l.id} className={s.lineEdit}>
                        <div className={s.lineEditRow}>
                          <span className={s.num} style={{ paddingTop: 2 }}>
                            {n2}
                          </span>
                          <div className={s.lineInputs}>
                          <textarea
                            data-fid={l.id}
                            className={s.lineInput}
                            value={l.text}
                            rows={1}
                            // Older headings can be longer; they keep their text so it can be trimmed by hand.
                            maxLength={Math.max(MAX_HEAD, l.text.length)}
                            // Lines are single-line: pasted line breaks become spaces; Enter adds the next line.
                            onChange={(e) => {
                              const v = e.target.value.replace(/\s*\n\s*/g, " ").slice(0, Math.max(MAX_HEAD, l.text.length));
                              mapLine(l.id, (x) => ({ ...x, text: v }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                addLine(sec.id, l.id);
                              }
                            }}
                            placeholder={num === 1 ? "Write your first line" : "Write a line"}
                            aria-label={`Line ${num}`}
                          />
                          <textarea
                            className={s.noteInput}
                            value={l.note}
                            rows={1}
                            maxLength={Math.max(MAX_NOTE, l.note.length)}
                            onChange={(e) => {
                              const v = e.target.value.replace(/\s*\n\s*/g, " ").slice(0, Math.max(MAX_NOTE, l.note.length));
                              mapLine(l.id, (x) => ({ ...x, note: v }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                addLine(sec.id, l.id);
                              }
                            }}
                            placeholder="Add a subheading (optional)"
                            aria-label={`Note for line ${num}`}
                          />
                          </div>
                        </div>
                        <div className={s.lineTools}>
                          {l.link && !open && <LinkCard link={l.link} onRemove={() => mapLine(l.id, (x) => ({ ...x, link: "" }))} />}
                          {open && (
                            <>
                              <div className={s.linkField}>
                                <span className={s.linkArrowIcon}>↗</span>
                                <input
                                  data-fid={`link-${l.id}`}
                                  className={s.linkInput}
                                  type="url"
                                  inputMode="url"
                                  autoCapitalize="none"
                                  autoCorrect="off"
                                  value={linkDraft}
                                  onChange={(e) => setLinkDraft(e.target.value)}
                                  onPaste={(e) => {
                                    const t = e.clipboardData.getData("text");
                                    if (t.trim()) {
                                      e.preventDefault();
                                      submitLink(l.id, t);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      e.preventDefault();
                                      submitLink(l.id, linkDraft);
                                    }
                                  }}
                                  placeholder="Paste a link"
                                  aria-label={`Link for line ${num}`}
                                />
                              </div>
                              <div className={s.linkButtons}>
                                <button className={s.pillPrimary} onClick={() => submitLink(l.id, linkDraft)}>
                                  Add
                                </button>
                                <button
                                  className={s.pillSecondary}
                                  onClick={() => {
                                    setLinkOpen(null);
                                    setLinkDraft("");
                                  }}
                                >
                                  Cancel
                                </button>
                              </div>
                            </>
                          )}
                          {!l.link && !open && (
                            <button
                              className={s.addLink}
                              onClick={() => {
                                focusId.current = `link-${l.id}`;
                                setLinkOpen(l.id);
                                setLinkDraft("");
                              }}
                            >
                              + Add link
                            </button>
                          )}
                          <div className={s.controls} style={{ marginTop: 10 }}>
                            <button className={s.control} onClick={() => moveLine(l.id, -1)} disabled={l.id === allIds[0]} aria-label="Move line up">
                              {arrow("up")}
                            </button>
                            <button className={s.control} onClick={() => moveLine(l.id, 1)} disabled={l.id === allIds[allIds.length - 1]} aria-label="Move line down">
                              {arrow("down")}
                            </button>
                            <button className={s.control} onClick={() => deleteLine(l.id)} aria-label="Delete line">
                              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted-72)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
                              </svg>
                            </button>
                            <span className={s.addedBy}>Added by you</span>
                            <button className={s.doneBtn} onClick={clearSel}>
                              Done
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <button className={s.addLine} onClick={() => addLine(sec.id)}>
                    <span className={s.addLinePlus}>+</span>
                    Add line
                  </button>
                </div>
              );
            })}
            <button className={s.addSubBottom} onClick={addSection}>
              + Add subsection
            </button>
          </div>
          <footer className={s.footer}>
            <button
              className={s.back}
              onClick={() => {
                setStep("description");
                clearSel();
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14.5 5.5L8 12l6.5 6.5" />
              </svg>
              Back
            </button>
            <button
              className={s.primary}
              style={{ flex: 1 }}
              aria-disabled={!(n || k)}
              onClick={() => {
                if (!(n || k)) return toast("Write a line first.");
                setStep("review");
                clearSel();
              }}
            >
              Finalize
            </button>
          </footer>
        </>
      )}

      {step === "review" && !preview && (
        <>
          <div className={s.scroll} style={{ paddingTop: 10 }}>
            <h1 className={s.finalHeading}>Finalize</h1>
            <button className={s.previewCard} onClick={() => setPreview(true)}>
              <span className={s.previewIcon}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </span>
              <span className={s.previewText}>
                <span className={s.previewTitle}>Preview your Stack</span>
                <span className={s.previewSub}>See exactly what visitors will see</span>
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted-66)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9.5 5.5L16 12l-6.5 6.5" />
              </svg>
            </button>

            <div className={s.card} style={{ paddingBottom: 8 }}>
              <div className={s.cardLabel}>Privacy</div>
              {PRIVACY.map(([key, label, desc]) => {
                const on = work.visibility === key;
                return (
                  <button key={key} className={s.privacyRow} onClick={() => edit((w) => ({ ...w, visibility: key }))} aria-pressed={on}>
                    <span className={s.radio} data-on={on || undefined}>
                      <span />
                    </span>
                    <span className={s.privacyText}>
                      <span className={s.privacyLabel} style={{ fontWeight: on ? 700 : 600 }}>
                        {label}
                      </span>
                      <span className={s.privacyDesc}>{desc}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <div className={s.card} style={{ marginTop: 14 }}>
              <div className={s.placeTitle}>Is this Stack about a place?</div>
              <div className={s.placeHelp}>Add a city or area so people can find it locally.</div>
              <label className={s.placeField}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
                  <circle cx="12" cy="10" r="2.4" />
                </svg>
                <input
                  className={s.placeInput}
                  value={work.location}
                  maxLength={80}
                  onChange={(e) => {
                    const v = e.target.value;
                    edit((w) => ({ ...w, location: v }));
                  }}
                  placeholder="e.g. Mexico City, or Brooklyn, NY"
                  aria-label="Location"
                />
              </label>
            </div>
            {!n && <div className={s.cantPublish}>Add a line with some text to publish.</div>}
          </div>
          <footer className={s.footer}>
            <button className={s.back} onClick={() => setStep("build")}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14.5 5.5L8 12l6.5 6.5" />
              </svg>
              Back
            </button>
            <button className={s.primary} style={{ flex: 1 }} aria-disabled={!n} disabled={busy} onClick={publish}>
              {busy ? "Publishing…" : "Publish"}
            </button>
          </footer>
        </>
      )}

      {step === "review" && preview && (
        <>
          <header className={s.previewHeader}>
            <button className={s.back} onClick={() => setPreview(false)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14.5 5.5L8 12l6.5 6.5" />
              </svg>
              Back
            </button>
            <span className={s.previewLabel}>Preview · {PRIVACY.find(([key]) => key === work.visibility)?.[1]}</span>
            <div className={s.headerEnd}>
              <button className={s.publishPill} aria-disabled={!n} disabled={busy} onClick={publish}>
                Publish
              </button>
            </div>
          </header>
          <div className={s.previewPage}>
            <StackPaper
              updated={`Updated ${new Date().toLocaleString("en-US", { month: "short", year: "numeric" })}${n ? ` · ${n} ${n === 1 ? "line" : "lines"}` : ""}`}
              author={
                <div className={s.pvAuthor}>
                  <span className={s.pvAvatar}>{initials(viewer.name)}</span>
                  <span className={s.pvName}>{viewer.name}</span>
                  <span className={s.pvHandle}>@{viewer.handle}</span>
                </div>
              }
              title={shownTitle}
              description={work.description.trim()}
              lines={work.sections.flatMap((sec) =>
                sec.lines
                  .filter((l) => l.text.trim())
                  .map((l, i) => ({
                    num: String(++pn).padStart(2, "0"),
                    label: i === 0 && sec.headed && sec.label.trim() ? sec.label : null,
                    head: l.text,
                    note: l.note.trim(),
                    link: l.link || null,
                  })),
              )}
              footer={
                <>
                  <span className={s.pvIcon} style={{ fontSize: 18 }}>
                    ♡
                  </span>
                  <span className={s.pvIcon}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--muted-66)" strokeWidth="2" strokeLinejoin="round" aria-hidden>
                      <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
                    </svg>
                  </span>
                  <span className={s.pvIcon}>
                    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="var(--muted-66)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M17 2l4 4-4 4" />
                      <path d="M3 11V9a3 3 0 0 1 3-3h15" />
                      <path d="M7 22l-4-4 4-4" />
                      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
                    </svg>
                  </span>
                  <span style={{ flex: 1 }} />
                  <span className={s.pvShare}>
                    Share
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="var(--muted-66)" stroke="var(--muted-66)" strokeWidth="1" strokeLinejoin="round" aria-hidden>
                      <path d="M13.5 4.5v4.2C7 9.3 3.6 13.4 3 19.5c2.4-3.4 5.6-4.9 10.5-5v4.3L21 11.6z" />
                    </svg>
                  </span>
                </>
              }
            />
          </div>
        </>
      )}

      {sheet && (
        <div className={s.scrim} onClick={() => setSheet(false)}>
          <div className={s.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="name-title">
            <div className={s.grabber} />
            <div id="name-title" className={s.sheetTitle}>
              Name your Stack to publish
            </div>
            <div className={s.sheetText}>Everything else stays as it is.</div>
            <input
              data-fid={"sheet"}
              className={s.sheetInput}
              value={titleDraft}
              maxLength={MAX_TITLE}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && titleDraft.trim() && requireAuth(() => doPublish(titleDraft.trim()), "Sign in to publish this stack and share it with others.")}
              placeholder="e.g. Tokyo ramen worth the line"
              aria-label="Title"
            />
            <button className={s.primary} style={{ marginTop: 14, width: "100%" }} aria-disabled={!titleDraft.trim()} disabled={busy} onClick={() => titleDraft.trim() && requireAuth(() => doPublish(titleDraft.trim()), "Sign in to publish this stack and share it with others.")}>
              {busy ? "Publishing…" : "Publish"}
            </button>
            <button className={s.quiet} style={{ width: "100%", marginTop: 4 }} onClick={() => setSheet(false)}>
              Not now
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
