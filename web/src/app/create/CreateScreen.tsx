"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useBack, useToast } from "@/components/AppProviders";
import shell from "@/components/AppShell.module.css";
import { systemShare } from "@/components/Share";
import { StackPaper } from "@/components/StackView";
import { initials, isListFormat, splitTextLinks, MAX_DESCRIPTION, MAX_HEAD, MAX_ITEMS, MAX_LABEL, MAX_NOTE, MAX_PARAGRAPH, MAX_SECTIONS, MAX_TITLE, MAX_TOTAL } from "@/lib/format";
import { SHOW_DRAFTS } from "@/lib/navFlags";
import { createClient } from "@/lib/supabase/client";
import type { Draft, EditTarget, LineFormat, Visibility } from "@/lib/types";
import p from "../profile/Profile.module.css";
import s from "./Create.module.css";

type Step = "title" | "description" | "build" | "review";
/**
 * A line being edited. `picked` is false for a fresh line whose format hasn't been chosen yet (the format menu
 * shows under it); it starts as a paragraph.
 */
type Line = { id: string; text: string; link: string; note: string; format: LineFormat; bold: boolean; picked: boolean };
type Sec = { id: string; headed: boolean; label: string; lines: Line[] };
// Tags are no longer edited here; a draft keeps the ones it already had.
type Work = { title: string; description: string; tags: string[]; visibility: Visibility; location: string; sections: Sec[] };
type Sel = { kind: "line" | "sec"; id: string } | null;
type Pick = LineFormat | "section";
type SaveState = "idle" | "saving" | "saved" | "error" | "over";

const STEPS: Record<Step, [number, string]> = { title: [1, "Title"], description: [2, "Description"], build: [3, "Build"], review: [4, "Finalize"] };
const PRIVACY: [Visibility, string, string][] = [
  ["public", "Public", "Anyone can find it on your profile and in search"],
  ["unlisted", "Invite Only", "Only people with the link"],
  ["private", "Private", "Only you"],
];
/** The + menu: start a section, or a line in one of the four formats. */
const MENU: [Pick, string, React.ReactNode][] = [
  [
    "section",
    "Section",
    <svg key="i" width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden>
      <rect x="1" y="2" width="3" height="12" rx="1.5" fill="var(--accent)" />
      <path d="M8 5h13M8 11h9" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>,
  ],
  [
    "text",
    "Paragraph",
    <svg key="i" width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden>
      <path d="M2 3h18M2 8h18M2 13h11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>,
  ],
  [
    "num",
    "Numbered",
    <svg key="i" width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden>
      <text x="1" y="7" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="IBM Plex Mono, monospace">
        1
      </text>
      <text x="1" y="15" fontSize="7" fontWeight="700" fill="currentColor" fontFamily="IBM Plex Mono, monospace">
        2
      </text>
      <path d="M8 4.5h13M8 12.5h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>,
  ],
  [
    "bullet",
    "Bulleted",
    <svg key="i" width="22" height="16" viewBox="0 0 22 16" fill="none" aria-hidden>
      <circle cx="3" cy="4.5" r="2" fill="var(--accent)" />
      <circle cx="3" cy="12.5" r="2" fill="var(--accent)" />
      <path d="M8 4.5h13M8 12.5h13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>,
  ],
  [
    "bold",
    "Bold",
    <span key="i" className={s.menuBold} aria-hidden>
      B
    </span>,
  ],
];
/** Scrolls the format menu into view when it opens, so it doesn't sit behind the footer. */
const reveal = (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
const FAV_BG = ["oklch(45% 0.13 30)", "oklch(38% 0.08 250)", "oklch(40% 0.09 150)", "oklch(28% 0.01 80)", "oklch(46% 0.13 60)"];
const UNTITLED = "Untitled draft";

let nextId = 1;
const uid = () => `k${nextId++}`;
// New lines start with a regular-weight heading; the B button makes it bold.
const newLine = (format: LineFormat = "text", picked = true, bold = false): Line => ({ id: uid(), text: "", link: "", note: "", format, bold, picked });
const isEmpty = (l: Line) => !l.text.trim() && !l.note.trim() && !l.link;
/** Most characters a line's main text can have. */
const maxText = (f: LineFormat) => (f === "text" ? MAX_PARAGRAPH : MAX_HEAD);

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
    lines: sec.lines.map((l) => ({ id: uid(), text: l.text, link: l.link, note: l.note ?? "", format: l.format, bold: l.bold !== false, picked: true })),
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

/** Characters of text in the stack, counted like the database: title, description, headings, lines and details. */
function textTotal(w: Work) {
  let t = w.title.length + w.description.length;
  w.sections.forEach((sec) => {
    if (sec.headed) t += sec.label.length;
    sec.lines.forEach((l) => (t += l.text.length + (isListFormat(l.format) ? l.note.length : 0)));
  });
  return t;
}

/**
 * Cuts a field's new value to its own limit and to what's left of the stack's total. Text that was already
 * there is never cut, so an older, longer value can still be trimmed by hand.
 */
/**
 * A line with text switched to another format. A paragraph becoming a list line keeps its first sentence (or
 * the first 60 characters, at a word break) as the heading and moves the rest into the detail; a list line
 * becoming a paragraph or bold line joins its heading and detail. Nothing is cut: anything over a limit shows
 * in the counter until it's shortened.
 */
function convertLine(x: Line, type: LineFormat): Line {
  const flat = (t: string) => t.replace(/\s*\n+\s*/g, " ").trim();
  if (isListFormat(type)) {
    if (x.format === "bold") return { ...x, format: type, bold: true, picked: true };
    if (x.format !== "text") return { ...x, format: type, picked: true };
    const t = flat(x.text);
    let head = t;
    if (t.length > MAX_HEAD) {
      const m = t.match(new RegExp(`^(.{1,${MAX_HEAD}}?[.!?])(\\s|$)`));
      if (m) head = m[1];
      else {
        const cut = t.slice(0, MAX_HEAD);
        const sp = cut.lastIndexOf(" ");
        head = sp > 20 ? cut.slice(0, sp) : cut;
      }
    }
    const note = [t.slice(head.length).trim(), x.note.trim()].filter(Boolean).join(" ");
    return { ...x, format: type, text: head, note, bold: false, picked: true };
  }
  const head = x.text.trim();
  const note = isListFormat(x.format) ? x.note.trim() : "";
  const joined = head + (note ? (head ? (/[.!?]$/.test(head) ? " " : ". ") : "") + note : "");
  return { ...x, format: type, text: type === "bold" ? flat(joined) : joined, note: "", picked: true };
}

function capText(w: Work, next: string, prev: string, max: number) {
  const room = MAX_TOTAL - textTotal(w) + prev.length;
  const cap = Math.max(0, Math.min(max, room));
  return next.length > cap ? next.slice(0, Math.max(cap, Math.min(next.length, prev.length))) : next;
}

/**
 * What in this stack is over a size limit, in words (empty when it fits). Mirrors the database's checks, which
 * count only lines with text.
 */
function limitProblems(w: Work): string[] {
  const out: string[] = [];
  const items = w.sections.flatMap((sec) => sec.lines.filter((l) => l.text.trim()));
  const headed = w.sections.filter((sec) => sec.headed);
  let total = w.title.trim().length + w.description.trim().length;
  headed.forEach((sec) => (total += sec.label.trim().length));
  items.forEach((l) => (total += l.text.trim().length + (isListFormat(l.format) ? l.note.trim().length : 0)));
  if (w.title.trim().length > MAX_TITLE) out.push(`Shorten the title to ${MAX_TITLE} characters.`);
  if (w.description.trim().length > MAX_DESCRIPTION) out.push(`Shorten the description to ${n0(MAX_DESCRIPTION)} characters.`);
  if (w.sections.length > MAX_SECTIONS) out.push(`Use at most ${MAX_SECTIONS} sections (this has ${w.sections.length}).`);
  if (headed.some((sec) => sec.label.trim().length > MAX_LABEL)) out.push(`Keep section headings to ${MAX_LABEL} characters.`);
  if (items.length > MAX_ITEMS) out.push(`Use at most ${MAX_ITEMS} lines (this has ${items.length}).`);
  const longParas = items.filter((l) => l.format === "text" && l.text.trim().length > MAX_PARAGRAPH).length;
  if (longParas) out.push(`Shorten ${longParas === 1 ? "1 paragraph" : `${longParas} paragraphs`} to ${MAX_PARAGRAPH} characters.`);
  const longHeads = items.filter((l) => l.format !== "text" && l.text.trim().length > MAX_HEAD).length;
  if (longHeads) out.push(`Shorten ${longHeads === 1 ? "1 line" : `${longHeads} lines`} to ${MAX_HEAD} characters.`);
  if (items.some((l) => isListFormat(l.format) && l.note.trim().length > MAX_NOTE)) out.push(`Keep details to ${MAX_NOTE} characters.`);
  if (total > MAX_TOTAL) out.push(`Trim the text to ${n0(MAX_TOTAL)} characters in all (this has ${n0(total)}).`);
  return out;
}

/** The sections as save_stack and apply_stack_edit take them. Only numbered and bulleted lines keep a detail. */
const sectionsArg = (w: Work) =>
  w.sections.map((sec) => ({
    label: sec.headed ? sec.label : "",
    lines: sec.lines.map((l) => ({
      text: l.text,
      note: (isListFormat(l.format) && l.note.trim()) || null,
      link: l.link || null,
      format: l.format,
      ...(isListFormat(l.format) && !l.bold ? { bold: false } : {}),
    })),
  }));

const WEEK = 7 * 86_400_000;
const shortDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** What decides whether an edit changed the stack: the visible text and links, ignoring blank lines and spacing. */
const contentKey = (w: Work) =>
  JSON.stringify([
    w.title.trim(),
    w.description.trim(),
    w.sections
      .map(
        (sec) =>
          [
            sec.headed ? sec.label.trim() : "",
            sec.lines.filter((l) => l.text.trim()).map((l) => [l.text.trim(), isListFormat(l.format) ? l.note.trim() : "", l.link, l.format, isListFormat(l.format) && l.bold]),
          ] as const,
      )
      .filter(([, lines]) => lines.length),
  ]);

/** Whether an edited stack can share an update to the feed now: public only, once every 7 days, and only with a change. */
function shareInfo(t: EditTarget, now: number, changed: boolean) {
  if (t.visibility !== "public") return { can: false, hint: "Only public stacks can share updates to the feed.", blocked: "Only public stacks can share updates." };
  const last = t.sharedAt ? Date.parse(t.sharedAt) : 0;
  if (last && now - last < WEEK) {
    const days = Math.ceil((last + WEEK - now) / 86_400_000);
    const wait = `Share again in ${days} ${days === 1 ? "day" : "days"}.`;
    return { can: false, hint: `${wait} Updates can be shared once every 7 days.`, blocked: wait };
  }
  if (!changed) return { can: false, hint: "Change something to share it as an update. You can share an update once every 7 days.", blocked: "Change something first, then share it as an update." };
  return { can: true, hint: "Puts your stack back in the feed. You can share an update once every 7 days.", blocked: "" };
}

const hasContent = (w: Work) => !!(w.title.trim() || w.description.trim() || w.sections.some((sec) => sec.lines.some((l) => l.text.trim() || l.link)));

/** A pasted link: letter tile, site name and domain. */
function LinkCard({ link, onRemove, onEdit }: { link: string; onRemove?: () => void; onEdit?: () => void }) {
  const m = linkMeta(link);
  const text = (
    <>
      <span className={s.linkTitle}>{m.name}</span>
      <span className={s.linkDomain}>{m.domain}</span>
    </>
  );
  return (
    <div className={s.linkCard}>
      <span className={s.fav} style={{ background: m.bg }}>
        {m.letter}
      </span>
      {/* Tapping the link opens it for editing, so a typo can be fixed without starting over. */}
      {onEdit ? (
        <button className={`${s.linkText} ${s.linkEdit}`} onClick={onEdit} aria-label={`Edit link ${m.domain}`}>
          {text}
        </button>
      ) : (
        <span className={s.linkText}>{text}</span>
      )}
      {onEdit && (
        <button className={s.linkRemove} onClick={onEdit} aria-label="Edit link" tabIndex={-1}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-60)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 20h4L19 9l-4-4L4 16z" />
            <path d="M13.5 6.5l4 4" />
          </svg>
        </button>
      )}
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

/**
 * The four-step create flow: title, description, build (edit in place), finalize. Drafts save automatically.
 * With `edit`, it edits a published stack instead: only the build step, with Publish and Publish & Share Update.
 */
export default function CreateScreen({ initial, start, edit: target = null }: { initial: Draft; start: "title" | "build"; edit?: EditTarget | null }) {
  const router = useRouter();
  const back = useBack();
  const { viewer, requireAuth } = useAuth();
  const toast = useToast();
  const [work, setWork] = useState<Work>(() => fromDraft(initial));
  const [step, setStep] = useState<Step>(start);
  const [preview, setPreview] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  // The + menu of line formats, open under the selected line or heading (or at the end).
  const [menu, setMenu] = useState(false);
  // The description shows a light box while it's being edited on the Build step.
  const [descFocus, setDescFocus] = useState(false);
  const [linkOpen, setLinkOpen] = useState<string | null>(null);
  const [linkDraft, setLinkDraft] = useState("");
  const [sheet, setSheet] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [save, setSave] = useState<SaveState>(initial.id ? "saved" : "idle");
  const [published, setPublished] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Edit mode: whether anything differs from the published stack (reopened edits already do), and the share sheet.
  const [edited, setEdited] = useState(!!(target && initial.id));
  const [shareOpen, setShareOpen] = useState(false);
  const [updateNote, setUpdateNote] = useState("");
  // When the screen opened: enough precision for "share again in N days".
  const [now] = useState(() => Date.now());
  // The published stack's content, to tell whether anything changed.
  const [liveKey] = useState(() => (target ? contentKey(fromDraft({ ...initial, ...target.live })) : ""));
  const shareState = target ? shareInfo(target, now, contentKey(work) !== liveKey) : null;
  const selLine = sel?.kind === "line" ? (work.sections.flatMap((sec) => sec.lines).find((l) => l.id === sel.id) ?? null) : null;

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
          p_sections: sectionsArg(w),
          p_tags: w.tags,
          p_status: status,
          p_forked_from: initial.forkedFromId,
          p_style: initial.style,
          p_description: w.description.trim(),
          p_visibility: w.visibility,
        };
        const sb = createClient();
        if (target) {
          // Edits to a published stack are kept in a draft that points at it.
          const { data, error } = await sb.rpc("save_stack", { ...args, p_location: w.location.trim(), p_edit_of: target.stackId });
          if (error) return error.code === "PGRST202" ? "Editing published stacks isn't available yet." : error.message;
          idRef.current = data as string;
          return null;
        }
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
    [initial.forkedFromId, initial.style, target],
  );

  const edit = (fn: (w: Work) => Work) => {
    setWork(fn);
    dirty.current = true;
    if (target) setEdited(true);
    if (viewer) setSave("saving");
  };

  // Autosave a moment after the last change, once there's something to keep.
  useEffect(() => {
    if (!viewer || !dirty.current || published) return;
    const t = setTimeout(async () => {
      // Saving (or publishing) since cleared it; nothing left to autosave.
      if (!dirty.current) return;
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
  const focusId = useRef<string | null>(start === "title" ? "title" : null);
  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[data-fid="${id}"]`);
    if (!el) return;
    focusId.current = null;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });

  const mapLineIn = (w: Work, id: string, fn: (l: Line) => Line): Work => ({ ...w, sections: w.sections.map((sec) => ({ ...sec, lines: sec.lines.map((l) => (l.id === id ? fn(l) : l)) })) });
  const mapLine = (id: string, fn: (l: Line, w: Work) => Line) => edit((w) => mapLineIn(w, id, (l) => fn(l, w)));
  /** Drops empty lines (but not `keep`), as happens when you move off a line. */
  const prune = (w: Work, keep: string | null): Work => ({ ...w, sections: w.sections.map((sec) => ({ ...sec, lines: sec.lines.filter((l) => l.id === keep || !isEmpty(l)) })) });
  const lineCount = (w: Work) => w.sections.reduce((n, sec) => n + sec.lines.length, 0);

  /** Selects a line or section heading (or nothing), closing the menu and link field and dropping empty lines. */
  /** A link typed but not yet added is kept when you move on. Returns whether one was. */
  function commitLink(id: string | null) {
    if (!id || linkOpen !== id || !linkDraft.trim()) return false;
    submitLink(id, linkDraft);
    return true;
  }

  function select(next: Sel) {
    commitLink(linkOpen);
    setWork((w) => prune(w, next?.kind === "line" ? next.id : null));
    if (next) focusId.current = next.id;
    setSel(next);
    setLinkOpen(null);
    setMenu(false);
  }

  function addLine(secId: string, afterId: string | null, format: LineFormat, picked = true, atStart = false) {
    if (lineCount(work) >= MAX_ITEMS) return toast(`A stack can have at most ${MAX_ITEMS} lines.`);
    const l = newLine(format, picked);
    focusId.current = l.id;
    edit((w0) => {
      const w = prune(w0, null);
      return {
        ...w,
        sections: w.sections.map((sec) => {
          if (sec.id !== secId) return sec;
          const lines = [...sec.lines];
          const i = afterId ? lines.findIndex((x) => x.id === afterId) : -1;
          if (i >= 0) lines.splice(i + 1, 0, l);
          else if (atStart) lines.unshift(l);
          else lines.push(l);
          return { ...sec, lines };
        }),
      };
    });
    setSel({ kind: "line", id: l.id });
    setLinkOpen(null);
    setMenu(false);
  }

  /** Starts a new section at a line: after it, or in its place when `dropLine` (an empty line turned into a heading). */
  function splitSection(w: Work, lineId: string, label: string, dropLine: boolean): [Work, string] {
    const si = w.sections.findIndex((x) => x.lines.some((l) => l.id === lineId));
    const secs = w.sections.map((x) => ({ ...x, lines: [...x.lines] }));
    const i = secs[si].lines.findIndex((l) => l.id === lineId);
    const keep = secs[si].lines.slice(0, dropLine ? i : i + 1);
    const after = secs[si].lines.slice(i + 1);
    if (!keep.length && !secs[si].headed) {
      secs[si] = { ...secs[si], headed: true, label, lines: after };
      return [{ ...w, sections: secs }, secs[si].id];
    }
    const sid = uid();
    secs[si].lines = keep;
    secs.splice(si + 1, 0, { id: sid, headed: true, label, lines: after });
    return [{ ...w, sections: secs }, sid];
  }

  function goSection(next: Work, sid: string) {
    focusId.current = sid;
    edit(() => prune(next, null));
    setSel({ kind: "sec", id: sid });
    setLinkOpen(null);
    setMenu(false);
  }

  /**
   * A choice from the + menu. On a selected line it changes that line's format (Section on a fresh line turns it
   * into a heading, on a line with text starts a new section after it); otherwise it adds a line of that format,
   * or a new section, after what's selected.
   */
  function pick(type: Pick) {
    const w = work;
    setMenu(false);
    const newSection = type === "section";
    const fullSections = newSection && w.sections.length >= MAX_SECTIONS && !(w.sections.length === 1 && !w.sections[0].headed);
    if (fullSections) return toast(`A stack can have at most ${MAX_SECTIONS} sections.`);
    const line = selLine;
    if (line) {
      const empty = isEmpty(line);
      const si = w.sections.findIndex((x) => x.lines.some((l) => l.id === line.id));
      const li = w.sections[si].lines.findIndex((l) => l.id === line.id);
      if (empty || !line.picked) {
        if (newSection) return goSection(...splitSection(w, line.id, empty ? "" : line.text.trim().slice(0, MAX_LABEL), true));
        focusId.current = line.id;
        const mid = mapLineIn(w, line.id, (x) => ({ ...x, format: type, picked: true, text: (type === "text" ? x.text : x.text.replace(/\s*\n\s*/g, " ")).slice(0, maxText(type)) }));
        const [next, n] = isListFormat(type) ? reflow(mid, si, li, type) : [mid, 0];
        edit(() => next);
        if (isListFormat(type) && offerParas(next, si, li, type, line.id)) return;
        return reflowToast(mid, n, type, line.id);
      }
      if (newSection) return goSection(...splitSection(w, line.id, "", false));
      // A line with text changes format in place.
      focusId.current = line.id;
      if (line.format === type) return;
      const mid = mapLineIn(w, line.id, (x) => convertLine(x, type));
      if (!isListFormat(type)) return edit(() => mid);
      const [next, n] = reflow(mid, si, li, type);
      edit(() => next);
      if (!offerParas(next, si, li, type, line.id)) reflowToast(mid, n, type, line.id);
      return;
    }
    if (sel?.kind === "sec") {
      if (newSection) {
        const i = w.sections.findIndex((x) => x.id === sel.id);
        const sid = uid();
        const secs = [...w.sections];
        secs.splice(i + 1, 0, { id: sid, headed: true, label: "", lines: [] });
        return goSection({ ...w, sections: secs }, sid);
      }
      return addLine(sel.id, null, type, true, true);
    }
    const last = w.sections[w.sections.length - 1];
    if (newSection) {
      if (w.sections.length === 1 && !last.headed && !last.lines.length) return goSection({ ...w, sections: [{ ...last, headed: true, label: "" }] }, last.id);
      const sid = uid();
      return goSection({ ...w, sections: [...w.sections, { id: sid, headed: true, label: "", lines: [] }] }, sid);
    }
    addLine(last.id, null, type);
  }

  /**
   * Starting a numbered or bulleted line right after a list of the other kind switches that list over, so a list
   * doesn't mix numbers and bullets. Returns the stack and how many lines changed.
   */
  function reflow(w: Work, si: number, end: number, type: LineFormat): [Work, number] {
    const lines = [...w.sections[si].lines];
    let n = 0;
    for (let j = end - 1; j >= 0 && isListFormat(lines[j].format); j--) {
      if (lines[j].format !== type) {
        lines[j] = { ...lines[j], format: type };
        n++;
      }
    }
    return n ? [{ ...w, sections: w.sections.map((x, i) => (i === si ? { ...x, lines } : x)) }, n] : [w, 0];
  }

  /** Says the lines above were switched, with Undo to put them back. */
  function reflowToast(before: Work, n: number, type: LineFormat, focus: string | null) {
    if (!n) return;
    toast(`Switched ${n} ${n === 1 ? "line" : "lines"} above to ${type === "num" ? "numbered" : "bullets"}`, {
      label: "Undo",
      run: () => {
        if (focus) focusId.current = focus;
        edit(() => before);
      },
    });
  }

  /**
   * After a line becomes numbered or bulleted, offers to convert the paragraphs right below it in the same
   * section too (Convert, then Undo). Returns whether there were any to offer.
   */
  function offerParas(w: Work, si: number, li: number, type: LineFormat, focus: string) {
    const ids: string[] = [];
    for (const l of w.sections[si].lines.slice(li + 1)) {
      if (l.format !== "text") break;
      if (l.text.trim() || l.link) ids.push(l.id);
    }
    if (!ids.length) return false;
    const n = ids.length;
    const kind = type === "num" ? "numbered" : "bullets";
    const what = n === 1 ? "paragraph" : `${n} paragraphs`;
    toast(`Make the ${what} below ${kind} too?`, {
      label: "Convert",
      run: () => {
        const before = workRef.current;
        focusId.current = focus;
        edit((cur) => ({ ...cur, sections: cur.sections.map((sec) => ({ ...sec, lines: sec.lines.map((l) => (ids.includes(l.id) && l.format === "text" ? convertLine(l, type) : l)) })) }));
        toast(`Converted ${n === 1 ? "1 paragraph" : `${n} paragraphs`} to ${kind}`, {
          label: "Undo",
          run: () => {
            focusId.current = focus;
            edit(() => before);
          },
        });
      },
    });
    return true;
  }

  /** Closing the menu keeps a fresh line as a paragraph. */
  function closeMenu() {
    setMenu(false);
    if (selLine && !selLine.picked) {
      focusId.current = selLine.id;
      setWork((w) => mapLineIn(w, selLine.id, (x) => ({ ...x, picked: true })));
    }
  }

  /** Done on a line: an empty line goes away; otherwise the next line starts (numbered and bulleted lines continue the list). */
  function doneLine(secId: string, l: Line) {
    if (!commitLink(l.id) && isEmpty(l)) return select(null);
    addLine(secId, l.id, isListFormat(l.format) ? l.format : "text");
  }

  /** Done on a heading: a new section gets its first line; one that has lines is just left. */
  function doneSec(sec: Sec) {
    const first = sec.lines[0];
    if (first && isEmpty(first)) return select({ kind: "line", id: first.id });
    if (first) return select(null);
    addLine(sec.id, null, "text", true, true);
  }

  function moveLine(id: string, dir: -1 | 1) {
    focusId.current = id;
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
    setMenu(false);
  }

  /**
   * Moves a section heading one line up or down, so the line it passes changes section. Past an empty headed
   * section, the two headings swap places.
   */
  function moveHeading(id: string, dir: -1 | 1) {
    focusId.current = id;
    edit((w) => {
      const secs = w.sections.map((x) => ({ ...x, lines: [...x.lines] }));
      const i = secs.findIndex((x) => x.id === id);
      if (i < 0 || !secs[i].headed) return w;
      const swap = (a: number, b: number) => {
        const [A, B] = [secs[a], secs[b]];
        secs[a] = { ...B, lines: A.lines };
        secs[b] = { ...A, lines: B.lines };
      };
      if (dir < 0) {
        if (i === 0) return w;
        const prev = secs[i - 1];
        if (prev.lines.length) {
          secs[i].lines.unshift(prev.lines.pop()!);
          if (!prev.lines.length && !prev.headed) secs.splice(i - 1, 1);
        } else if (prev.headed) swap(i - 1, i);
        else secs.splice(i - 1, 1);
      } else {
        const cur = secs[i];
        if (cur.lines.length) {
          const ln = cur.lines.shift()!;
          if (i > 0) secs[i - 1].lines.push(ln);
          else secs.unshift({ id: uid(), headed: false, label: "", lines: [ln] });
        } else if (i < secs.length - 1 && secs[i + 1].headed) swap(i, i + 1);
        else return w;
      }
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
    setMenu(false);
  }

  function submitLink(id: string, raw: string) {
    const v = raw.trim();
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    // Something that isn't a link stays in the field, so it can be fixed.
    if (v && (!/^https?:\/\/[^\s.]+\.\S+$/i.test(url) || url.length > 2048)) {
      setLinkOpen(id);
      setLinkDraft(raw);
      return toast("That doesn't look like a link.");
    }
    setLinkOpen(null);
    setLinkDraft("");
    if (v) mapLine(id, (l) => ({ ...l, link: url }));
  }

  function toStep(next: Step) {
    focusId.current = next === "title" ? "title" : next === "description" ? "desc" : null;
    setStep(next);
  }

  function goBuild() {
    setStep("build");
    setSel(null);
    setMenu(false);
    // With nothing written yet, start a fresh line with the format menu under it.
    if (work.sections.some((sec) => sec.lines.some((l) => !isEmpty(l)))) return;
    const l = newLine("text", false);
    setWork((w) => ({ ...w, sections: w.sections.map((x, i) => (i === 0 ? { ...x, lines: [l] } : x)) }));
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
    // Leaving an edit goes back to the screen it came from (Manage stacks), so its Back still leads out of it.
    if (target) {
      if (!edited) return back("/settings/stacks");
      return requireAuth(async () => {
        const err = await flush();
        if (err) return toast(`Couldn't save: ${err}`);
        toast("Changes saved as a draft");
        // Manage stacks opens on Drafts with fresh data when it sees this.
        try {
          sessionStorage.setItem(SHOW_DRAFTS, "1");
        } catch {}
        back("/settings/stacks?filter=drafts");
      }, "Sign in to keep these changes.");
    }
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

  /** Edit mode: writes the edits to the published stack, and with `share` puts it back in the feed with the note. */
  async function applyEdit(share: boolean, note = "") {
    if (!target || busy) return;
    const w = workRef.current;
    if (!counts(w).n) return toast("Add a line with some text to publish.");
    if (!w.title.trim()) return toast("Add a title to publish.");
    const over = limitProblems(w)[0];
    if (over) return toast(over);
    setBusy(true);
    // Let any autosave finish first, so it can't recreate the edits draft after this removes it.
    dirty.current = false;
    await queue.current;
    const { error } = await createClient().rpc("apply_stack_edit", {
      p_id: target.stackId,
      p_title: w.title.trim(),
      p_description: w.description.trim(),
      p_sections: sectionsArg(w),
      p_share: share,
      p_note: note.trim(),
    });
    setBusy(false);
    if (error) return toast(error.code === "PGRST202" ? "Editing published stacks isn't available yet." : `Couldn't publish: ${error.message}`);
    setShareOpen(false);
    toast(share ? "Update shared to the feed" : "Changes published");
    router.replace(`/s/${target.stackId}`);
    router.refresh();
  }

  function openShare() {
    if (!target) return;
    if (shareState && !shareState.can) return toast(shareState.blocked);
    if (!counts(work).n) return toast("Add a line with some text to publish.");
    setUpdateNote("");
    focusId.current = "note";
    setShareOpen(true);
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
  const clearSel = () => select(null);

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
              {save === "error"
                ? "Couldn't save"
                : save === "over"
                  ? "Too long to save"
                  : target
                    ? save === "saving" && edited
                      ? "Saving draft…"
                      : edited
                        ? "Unsaved changes"
                        : "No changes yet"
                    : save === "saving"
                      ? "Saving…"
                      : save === "saved"
                        ? "Saved just now"
                        : "New draft"}
            </>
          )}
        </div>
        <div className={s.headerEnd}>
          <button className={s.saveDraft} onClick={saveDraft}>
            Save draft
          </button>
        </div>
      </div>
      {target ? (
        <div className={s.editingLabel}>Editing a published stack</div>
      ) : (
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
      )}
    </header>
  );

  let num = 0;
  let pn = 0;
  const lastSec = work.sections[work.sections.length - 1];
  // The menu shows on its own under a fresh line, until a format is picked or something is typed.
  const anchorMenu = menu || !!(selLine && isEmpty(selLine) && !selLine.picked);
  const left = MAX_TOTAL - textTotal(work);
  // The menu marks the format in use: the selected line's, a heading's, or else the last line's.
  const lastLine = work.sections.flatMap((sec) => sec.lines).at(-1);
  const curFormat: Pick = selLine ? selLine.format : sel?.kind === "sec" ? "section" : (lastLine?.format ?? "text");
  // Keeps focus in the field while tapping the menu and line tools.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  const formatMenu = (
    <div ref={reveal} className={s.menu} role="menu" aria-label="Add">
      {MENU.map(([type, label, icon]) => (
        <button key={type} className={s.menuItem} data-on={type === curFormat || undefined} role="menuitem" onMouseDown={keep} onClick={() => pick(type)}>
          {icon}
          <span className={s.menuLabel}>{label}</span>
        </button>
      ))}
      <button className={s.menuClose} onMouseDown={keep} onClick={closeMenu} aria-label="Close">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--muted-60)" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
          <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
        </svg>
      </button>
    </div>
  );
  const plusRow = (
    <div className={s.plusRow}>
      <button className={s.plus} onMouseDown={keep} onClick={() => setMenu(true)} aria-label="Add a line or section">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <button className={s.plusLabel} onMouseDown={keep} onClick={() => setMenu(true)} tabIndex={-1}>
        Options
      </button>
    </div>
  );
  const nextArrow = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
  const marker = (l: Line, n2: string) =>
    l.format === "num" ? (
      <span className={s.num}>{n2}</span>
    ) : l.format === "bullet" ? (
      <span className={s.bullet} aria-hidden>
        <span />
      </span>
    ) : null;

  return (
    <main className={`${shell.screen} ${step === "review" && preview ? s.previewMain : ""}`}>
      {header}

      {step !== "review" && (
        <>
          <div className={s.scroll}>
            <div className={s.composeSpacer} style={{ height: step === "title" ? 150 : step === "description" ? 72 : 6 }} />
            {step === "title" && <div className={s.ask}>What would you like to call this Stack?</div>}
            <textarea
              data-fid="title"
              className={s.titleInput}
              data-active={step === "title" || undefined}
              rows={1}
              value={work.title}
              onChange={(e) => {
                const v = e.target.value.replace(/\s*\n\s*/g, " ");
                edit((w) => ({ ...w, title: capText(w, v, w.title, MAX_TITLE) }));
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                if (step === "title") toStep("description");
                else e.currentTarget.blur();
              }}
              onFocus={() => {
                if (step === "description") setStep("title");
                else if (step === "build") clearSel();
              }}
              placeholder={step === "title" ? "Name your Stack" : "Untitled Stack"}
              aria-label="Title"
            />
            {step === "title" && (
              <div className={s.composeActions}>
                <span className={s.composeHint}>Press return to continue</span>
                <button className={s.nextBtn} data-on={!!work.title.trim() || undefined} onClick={() => toStep("description")}>
                  {work.title.trim() ? "Next" : "Skip"}
                  {nextArrow}
                </button>
              </div>
            )}
            {step !== "title" && (
              <>
                {step === "description" && (
                  <div className={s.askDesc}>
                    <span className={s.ask} style={{ padding: 0 }}>
                      What is this Stack about?
                    </span>
                    <span className={s.optional}>Optional</span>
                  </div>
                )}
                <textarea
                  data-fid="desc"
                  className={s.descInput}
                  data-active={step === "description" || undefined}
                  data-focus={(step === "build" && descFocus) || undefined}
                  rows={1}
                  value={work.description}
                  onChange={(e) => {
                    const v = e.target.value;
                    edit((w) => ({ ...w, description: capText(w, v, w.description, MAX_DESCRIPTION) }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" || e.shiftKey) return;
                    e.preventDefault();
                    if (step === "description") goBuild();
                    else e.currentTarget.blur();
                  }}
                  onFocus={() => {
                    setDescFocus(true);
                    if (step === "build") clearSel();
                  }}
                  onBlur={() => setDescFocus(false)}
                  placeholder={step === "description" ? "A sentence or two on what this is and who it\u2019s for" : "Add a description (optional)"}
                  aria-label="Description"
                />
                {step === "description" && (
                  <div className={s.composeActions}>
                    <span className={s.composeHint}>
                      {work.description.length}/{MAX_DESCRIPTION}
                    </span>
                    <button className={s.nextBtn} data-on={!!work.description.trim() || undefined} onClick={goBuild}>
                      {work.description.trim() ? "Next" : "Skip"}
                      {nextArrow}
                    </button>
                  </div>
                )}
              </>
            )}

            {step === "build" && (
              <div className={s.buildBody}>
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

                {work.sections.map((sec, si) => {
                  const secSel = sel?.kind === "sec" && sel.id === sec.id;
                  return (
                    <div key={sec.id} className={s.section}>
                      {sec.headed && (
                        <div className={s.sectionHead}>
                          <div className={s.sectionRule}>
                            <span className={s.sectionBar} />
                            <textarea
                              data-fid={sec.id}
                              className={s.sectionInput}
                              rows={1}
                              value={sec.label}
                              onChange={(e) => {
                                const v = e.target.value.replace(/\s*\n\s*/g, " ");
                                edit((w) => ({ ...w, sections: w.sections.map((x) => (x.id === sec.id ? { ...x, label: capText(w, v, x.label, MAX_LABEL) } : x)) }));
                              }}
                              onFocus={() => !secSel && select({ kind: "sec", id: sec.id })}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  doneSec(sec);
                                }
                              }}
                              placeholder="Section heading"
                              aria-label="Section heading"
                            />
                          </div>
                          {secSel && (
                            <div className={s.sectionTools}>
                              <button className={s.toolBtn} onMouseDown={keep} onClick={() => moveHeading(sec.id, -1)} disabled={si === 0} aria-label="Move heading up">
                                {arrow("up")}
                              </button>
                              <button
                                className={s.toolBtn}
                                onMouseDown={keep}
                                onClick={() => moveHeading(sec.id, 1)}
                                disabled={!sec.lines.length && si === work.sections.length - 1}
                                aria-label="Move heading down"
                              >
                                {arrow("down")}
                              </button>
                              <button className={s.textControl} onClick={() => removeSection(sec.id)}>
                                Remove heading
                              </button>
                              <span style={{ flex: 1 }} />
                              <button className={s.doneBtn} onClick={() => doneSec(sec)}>
                                Done
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                      {secSel && (anchorMenu ? formatMenu : plusRow)}

                      {sec.lines.map((l) => {
                        if (l.format === "num") num++;
                        const n2 = String(num).padStart(2, "0");
                        const list = isListFormat(l.format);
                        const isSel = sel?.kind === "line" && sel.id === l.id;
                        const lastInSec = l.id === sec.lines[sec.lines.length - 1].id;
                        if (!isSel) {
                          // Web addresses typed into the text show as link pills, like on the stack page.
                          const view = splitTextLinks(l.text, list ? l.note : "", l.link || null);
                          return (
                            <div
                              key={l.id}
                              className={`${s.line} ${lastInSec ? "" : s.lineDivided}`}
                              role="button"
                              tabIndex={0}
                              onClick={() => select({ kind: "line", id: l.id })}
                              onKeyDown={(e) => e.key === "Enter" && select({ kind: "line", id: l.id })}
                            >
                              {marker(l, n2)}
                              <div className={s.lineBody}>
                                {(view.head || !(l.link || view.links.length)) && (
                                  <div className={l.format === "text" ? s.para : l.format === "bold" ? s.boldLine : s.head} data-plain={(list && !l.bold) || undefined} data-empty={!view.head || undefined}>
                                    {view.head || (l.format === "text" ? "Empty paragraph \u2014 tap to write" : "Empty line \u2014 tap to write")}
                                  </div>
                                )}
                                {list && view.note && <div className={s.lineNote}>{view.note}</div>}
                                {(view.links.length > 0 || !!l.link) && (
                                  <div className={s.pills}>
                                {[...view.links, ...(l.link ? [l.link] : [])].map((u) => (
                                  <span key={u} className={s.visit}>
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
                                      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
                                    </svg>
                                    {linkMeta(u).domain}
                                  </span>
                                ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        }
                        const open = linkOpen === l.id;
                        const tm = maxText(l.format);
                        const full = l.text.length >= tm || (list && l.note.length >= MAX_NOTE) || left <= 0;
                        const count = [
                          l.text.length >= tm * 0.8 && `${l.text.length}/${tm}`,
                          list && l.note.length >= MAX_NOTE * 0.8 && `detail ${l.note.length}/${MAX_NOTE}`,
                          left <= 500 && `${n0(Math.max(left, 0))} left in stack`,
                        ]
                          .filter(Boolean)
                          .join(" \u00b7 ");
                        return (
                          <div key={l.id}>
                            <div className={s.lineEdit}>
                              <button className={s.lineDelete} onMouseDown={keep} onClick={() => deleteLine(l.id)} aria-label="Delete line">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted-66)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                  <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
                                </svg>
                              </button>
                              <div className={s.lineEditRow}>
                                {marker(l, n2)}
                                <div className={s.lineInputs}>
                                  <textarea
                                    data-fid={l.id}
                                    className={s.lineInput}
                                    data-format={l.format}
                                    data-plain={(list && !l.bold) || undefined}
                                    value={l.text}
                                    rows={1}
                                    // Paragraphs keep line breaks (Shift+Enter); other lines are one line.
                                    onChange={(e) => {
                                      const raw = l.format === "text" ? e.target.value : e.target.value.replace(/\s*\n\s*/g, " ");
                                      mapLine(l.id, (x, w) => ({ ...x, text: capText(w, raw, x.text, maxText(x.format)) }));
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key !== "Enter" || e.shiftKey) return;
                                      e.preventDefault();
                                      if (!list) return l.text.trim() ? addLine(sec.id, l.id, "text") : undefined;
                                      // Enter on an empty list line ends the list; otherwise it moves to the detail.
                                      if (!l.text.trim()) return mapLine(l.id, (x) => ({ ...x, format: "text", picked: false, note: "" }));
                                      document.querySelector<HTMLTextAreaElement>(`[data-fid="note-${l.id}"]`)?.focus();
                                    }}
                                    placeholder={l.format === "text" ? (l.picked ? "Write a paragraph" : "Start writing, or pick a format below") : l.format === "bold" ? "Bold line" : "Heading"}
                                    aria-label={l.format === "text" ? "Paragraph" : l.format === "bold" ? "Bold line" : "Heading"}
                                  />
                                  {list && (
                                    <textarea
                                      data-fid={`note-${l.id}`}
                                      className={s.noteInput}
                                      value={l.note}
                                      rows={1}
                                      onChange={(e) => {
                                        const raw = e.target.value.replace(/\s*\n\s*/g, " ");
                                        mapLine(l.id, (x, w) => ({ ...x, note: capText(w, raw, x.note, MAX_NOTE) }));
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" && !e.shiftKey) {
                                          e.preventDefault();
                                          doneLine(sec.id, l);
                                        }
                                      }}
                                      placeholder="Add a detail (optional)"
                                      aria-label="Detail"
                                    />
                                  )}
                                </div>
                              </div>
                              <div className={s.lineTools} data-list={list || undefined}>
                                {l.link && !open && (
                                  <LinkCard
                                    link={l.link}
                                    onRemove={() => mapLine(l.id, (x) => ({ ...x, link: "" }))}
                                    onEdit={() => {
                                      focusId.current = `link-${l.id}`;
                                      setLinkOpen(l.id);
                                      setLinkDraft(l.link);
                                    }}
                                  />
                                )}
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
                                          // Pasting into an empty field adds the link right away; into a link being edited, it just pastes.
                                          if (t.trim() && !linkDraft.trim()) {
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
                                        aria-label="Link"
                                      />
                                    </div>
                                    <div className={s.linkButtons}>
                                      <button className={s.pillPrimary} onClick={() => submitLink(l.id, linkDraft)}>
                                        {l.link ? "Save" : "Add"}
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
                                <div className={s.toolRow}>
                                  {list && (
                                    <button
                                      className={`${s.toolBtn} ${s.boldToggle}`}
                                      aria-pressed={l.bold}
                                      aria-label="Bold heading"
                                      onMouseDown={keep}
                                      onClick={() => {
                                        focusId.current = l.id;
                                        mapLine(l.id, (x) => ({ ...x, bold: !x.bold }));
                                      }}
                                    >
                                      B
                                    </button>
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
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                                        <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
                                        <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
                                      </svg>
                                      Add link
                                    </button>
                                  )}
                                  <button className={s.toolBtn} onMouseDown={keep} onClick={() => moveLine(l.id, -1)} disabled={l.id === allIds[0]} aria-label="Move line up">
                                    {arrow("up")}
                                  </button>
                                  <button className={s.toolBtn} onMouseDown={keep} onClick={() => moveLine(l.id, 1)} disabled={l.id === allIds[allIds.length - 1]} aria-label="Move line down">
                                    {arrow("down")}
                                  </button>
                                  <span className={s.charCount} data-full={(count && full) || undefined}>
                                    {count}
                                  </span>
                                  <button className={s.lineDone} onClick={() => doneLine(sec.id, l)}>
                                    Done
                                  </button>
                                </div>
                              </div>
                            </div>
                            {anchorMenu ? formatMenu : plusRow}
                          </div>
                        );
                      })}
                      {!sel && sec.id === lastSec.id && (anchorMenu ? formatMenu : plusRow)}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {step === "build" &&
            (target ? (
              <footer className={`${s.footer} ${s.editFooter}`}>
                <button className={s.primary} disabled={busy} onClick={() => applyEdit(false)}>
                  {busy && !shareOpen ? "Publishing…" : "Publish"}
                </button>
                <button className={s.shareUpdate} aria-disabled={!shareState?.can} onClick={openShare}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5" />
                    <path d="M20 4v4.5h-4.5" />
                    <path d="M20 12a8 8 0 0 1-13.7 5.7L4 15.5" />
                    <path d="M4 20v-4.5h4.5" />
                  </svg>
                  Publish & Share Update
                </button>
                <div className={s.shareHint}>{shareState?.hint}</div>
              </footer>
            ) : (
              <footer className={s.footer}>
                <button
                  className={s.back}
                  onClick={() => {
                    clearSel();
                    toStep("description");
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
            ))}
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
                    num: l.format === "num" ? String(++pn).padStart(2, "0") : l.format === "bullet" ? "•" : "",
                    label: i === 0 && sec.headed && sec.label.trim() ? sec.label : null,
                    ...splitTextLinks(l.text, isListFormat(l.format) ? l.note.trim() : "", l.link || null),
                    link: l.link || null,
                    format: l.format,
                    bold: !isListFormat(l.format) || l.bold,
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

      {shareOpen && target && (
        <div className={s.scrim} onClick={() => setShareOpen(false)}>
          <div className={s.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="share-title">
            <div className={s.grabber} />
            <div id="share-title" className={s.sheetTitle}>
              Share an update
            </div>
            <div className={s.sheetText}>Your stack goes back into the feed with this note, which shows for 7 days. After this, you can share your next update on {shortDay(now + WEEK)}.</div>
            <div className={s.noteLabelRow}>
              <label htmlFor="update-note" className={s.noteLabel}>
                Update note
              </label>
              <span className={s.noteCount} data-near={updateNote.length >= 36 || undefined}>
                {updateNote.length}/40
              </span>
            </div>
            <input
              id="update-note"
              data-fid="note"
              className={`${s.sheetInput} ${s.noteInput}`}
              value={updateNote}
              maxLength={40}
              onChange={(e) => setUpdateNote(e.target.value.slice(0, 40))}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), applyEdit(true, updateNote))}
              placeholder="What changed? (optional)"
            />
            <button className={s.primary} style={{ marginTop: 14, width: "100%" }} disabled={busy} onClick={() => applyEdit(true, updateNote)}>
              {busy ? "Sharing…" : "Share update"}
            </button>
            <button className={s.quiet} style={{ width: "100%", marginTop: 4 }} onClick={() => setShareOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
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
