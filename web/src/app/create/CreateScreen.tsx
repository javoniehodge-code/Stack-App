"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth, useBack, useToast } from "@/components/AppProviders";
import shell from "@/components/AppShell.module.css";
import { systemShare } from "@/components/Share";
import { RichText, StackPaper } from "@/components/StackView";
import {
  initials,
  isListFormat,
  linkDomain,
  plainText,
  richParts,
  splitTextLinks,
  textLinks,
  MAX_BOLD_LINE,
  MAX_DESCRIPTION,
  MAX_ITEMS,
  MAX_LABEL,
  MAX_LINE,
  MAX_LINK_NAME,
  MAX_SECTIONS,
  MAX_TITLE,
  MAX_TOTAL,
} from "@/lib/format";
import { SHOW_DRAFTS } from "@/lib/navFlags";
import { createClient } from "@/lib/supabase/client";
import type { Draft, EditTarget, LineFormat, Visibility } from "@/lib/types";
import p from "../profile/Profile.module.css";
import s from "./Create.module.css";

type Step = "title" | "description" | "build" | "review";
/**
 * A line being edited. `text` has bold words between ** marks. `picked` is false for a fresh line whose format
 * hasn't been chosen yet; it starts as a paragraph. `linkName` names the link's pill; `linkNames` names web
 * addresses typed into the text.
 */
type Line = { id: string; text: string; link: string; format: LineFormat; picked: boolean; linkName: string; linkNames: Record<string, string> };
type Sec = { id: string; headed: boolean; label: string; lines: Line[] };
// Tags are no longer edited here; a draft keeps the ones it already had.
type Work = { title: string; description: string; tags: string[]; visibility: Visibility; location: string; sections: Sec[] };
type Sel = { kind: "line" | "sec"; id: string } | null;
type Pick = LineFormat | "section";
type SaveState = "idle" | "saving" | "saved" | "error" | "over";
/** The Add link / Edit link sheet: a line's own link (`attached`), or a web address typed into its text (`text`, name only). */
type LinkSheet = { lineId: string; mode: "add" | "edit" | "text"; url: string; name: string; reselect: boolean };

const STEPS: Record<Step, [number, string]> = { title: [1, "Title"], description: [2, "Description"], build: [3, "Build"], review: [4, "Finalize"] };
const PRIVACY: [Visibility, string, string][] = [
  ["public", "Public", "Anyone can find it on your profile and in search"],
  ["unlisted", "Invite Only", "Only people with the link"],
  ["private", "Private", "Only you"],
];
/** The formats in the toolbar, then Section. */
const FORMATS: [Pick, string, React.ReactNode][] = [
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
];
const UNTITLED = "Untitled draft";

let nextId = 1;
const uid = () => `k${nextId++}`;
const newLine = (format: LineFormat = "text", picked = true): Line => ({ id: uid(), text: "", link: "", format, picked, linkName: "", linkNames: {} });
const isEmpty = (l: Line) => !plainText(l.text).trim() && !l.link;
/** Most characters a line can have (** bold marks don't count). */
const maxText = (f: LineFormat) => (f === "bold" ? MAX_BOLD_LINE : MAX_LINE);
const linkIcon = (size: number) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
    <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
  </svg>
);
const trashIcon = (stroke: string) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" />
  </svg>
);

/** An older line's separate detail joined onto its text ("Heading. Detail"), since lines are one text now. */
function joinNote(text: string, note: string | undefined) {
  const n = (note ?? "").trim();
  if (!n) return text;
  const t = text.trim();
  return t + (t ? (/[.!?]$/.test(plainText(t)) ? " " : ". ") : "") + n;
}

function fromDraft(d: Draft): Work {
  const sections: Sec[] = d.sections.map((sec, i) => ({
    id: uid(),
    headed: i > 0 || !!sec.label.trim(),
    label: sec.label,
    lines: sec.lines.map((l) => ({
      id: uid(),
      text: isListFormat(l.format) ? joinNote(l.text, l.note) : l.text,
      link: l.link,
      format: l.format,
      picked: true,
      linkName: l.linkName ?? "",
      linkNames: l.linkNames ?? {},
    })),
  }));
  if (!sections.length) sections.push({ id: uid(), headed: false, label: "", lines: [] });
  return { title: d.title === UNTITLED ? "" : d.title, description: d.description, tags: d.tags, visibility: d.visibility, location: d.location, sections };
}

const counts = (w: Work) => {
  let n = 0;
  let k = 0;
  // A line counts when it has text or a link (a line can be just a link, shown as its pill).
  w.sections.forEach((sec) => sec.lines.forEach((l) => (!isEmpty(l) && n++, l.link && k++)));
  return { n, k };
};
const n0 = (x: number) => x.toLocaleString("en-US");

/** Characters of text in the stack, counted like the database: title, description, headings and lines (no ** marks). */
function textTotal(w: Work) {
  let t = w.title.length + w.description.length;
  w.sections.forEach((sec) => {
    if (sec.headed) t += sec.label.length;
    sec.lines.forEach((l) => (t += plainText(l.text).length));
  });
  return t;
}

/**
 * A line switched to another format. Text carries over as it is; a bold line has no bold words or line breaks, so
 * those go when a line becomes one. Nothing is cut: anything over a limit shows in the counter until it's shortened.
 */
function convertLine(x: Line, type: LineFormat): Line {
  if (type === "bold") return { ...x, format: type, text: plainText(x.text).replace(/\s*\n+\s*/g, " ").trim(), picked: true };
  return { ...x, format: type, picked: true };
}

/**
 * Cuts a field's new value to its own limit and to what's left of the stack's total. Text that was already
 * there is never cut, so an older, longer value can still be trimmed by hand.
 */
function capText(w: Work, next: string, prev: string, max: number) {
  const room = MAX_TOTAL - textTotal(w) + prev.length;
  const cap = Math.max(0, Math.min(max, room));
  return next.length > cap ? next.slice(0, Math.max(cap, Math.min(next.length, prev.length))) : next;
}

/**
 * What in this stack is over a size limit, in words (empty when it fits). Mirrors the database's checks, which
 * count only lines with text or a link.
 */
function limitProblems(w: Work): string[] {
  const out: string[] = [];
  const items = w.sections.flatMap((sec) => sec.lines.filter((l) => !isEmpty(l)));
  const headed = w.sections.filter((sec) => sec.headed);
  let total = w.title.trim().length + w.description.trim().length;
  headed.forEach((sec) => (total += sec.label.trim().length));
  items.forEach((l) => (total += plainText(l.text).trim().length));
  if (w.title.trim().length > MAX_TITLE) out.push(`Shorten the title to ${MAX_TITLE} characters.`);
  if (w.description.trim().length > MAX_DESCRIPTION) out.push(`Shorten the description to ${n0(MAX_DESCRIPTION)} characters.`);
  if (w.sections.length > MAX_SECTIONS) out.push(`Use at most ${MAX_SECTIONS} sections (this has ${w.sections.length}).`);
  if (headed.some((sec) => sec.label.trim().length > MAX_LABEL)) out.push(`Keep section headings to ${MAX_LABEL} characters.`);
  if (items.length > MAX_ITEMS) out.push(`Use at most ${MAX_ITEMS} lines (this has ${items.length}).`);
  const long = items.filter((l) => l.format !== "bold" && plainText(l.text).trim().length > MAX_LINE).length;
  if (long) out.push(`Shorten ${long === 1 ? "1 line" : `${long} lines`} to ${MAX_LINE} characters.`);
  const longBold = items.filter((l) => l.format === "bold" && l.text.trim().length > MAX_BOLD_LINE).length;
  if (longBold) out.push(`Shorten ${longBold === 1 ? "1 bold line" : `${longBold} bold lines`} to ${MAX_BOLD_LINE} characters.`);
  if (total > MAX_TOTAL) out.push(`Trim the text to ${n0(MAX_TOTAL)} characters in all (this has ${n0(total)}).`);
  return out;
}

/** Names for the web addresses still in a line's text (a name goes when its address is deleted). */
function textLinkNames(l: Line) {
  const out: Record<string, string> = {};
  for (const href of textLinks(l.text).links) if (l.linkNames[href]?.trim()) out[href] = l.linkNames[href].trim();
  return out;
}

/** The sections as save_stack and apply_stack_edit take them. */
const sectionsArg = (w: Work) =>
  w.sections.map((sec) => ({
    label: sec.headed ? sec.label : "",
    lines: sec.lines.map((l) => {
      const names = textLinkNames(l);
      return {
        text: l.text,
        link: l.link || null,
        format: l.format,
        ...(l.link && l.linkName.trim() ? { linkName: l.linkName.trim() } : {}),
        ...(Object.keys(names).length ? { linkNames: names } : {}),
      };
    }),
  }));

const WEEK = 7 * 86_400_000;
const shortDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** What decides whether an edit changed the stack: the visible text, formats and links, ignoring blank lines and spacing. */
const contentKey = (w: Work) =>
  JSON.stringify([
    w.title.trim(),
    w.description.trim(),
    w.sections
      .map(
        (sec) =>
          [
            sec.headed ? sec.label.trim() : "",
            sec.lines.filter((l) => !isEmpty(l)).map((l) => [l.text.trim(), l.link, l.format, l.link ? l.linkName.trim() : "", textLinkNames(l)]),
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

const hasContent = (w: Work) => !!(w.title.trim() || w.description.trim() || w.sections.some((sec) => sec.lines.some((l) => plainText(l.text).trim() || l.link)));

// ── Rich text: a line's text with ** marks shown as bold in an editable box ──

const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHtml = (t: string) =>
  richParts(t)
    .map((p) => (p.bold ? `<b>${esc(p.text).replace(/\n/g, "<br>")}</b>` : esc(p.text).replace(/\n/g, "<br>")))
    .join("");

/** The text of an editable box, with bold runs between ** marks. */
function fromHtml(el: HTMLElement) {
  let out = "";
  const walk = (n: Node, bold: boolean) =>
    n.childNodes.forEach((c) => {
      if (c.nodeType === Node.TEXT_NODE) {
        const t = (c.nodeValue ?? "").replace(/\u200b/g, "");
        if (t) out += bold ? `\u0001${t}\u0002` : t;
      } else if (c instanceof HTMLElement) {
        if (c.tagName === "BR") {
          out += "\n";
          return;
        }
        const fw = c.style.fontWeight;
        const b = bold || c.tagName === "B" || c.tagName === "STRONG" || fw === "bold" || parseInt(fw, 10) >= 600;
        if ((c.tagName === "DIV" || c.tagName === "P") && out && !out.endsWith("\n")) out += "\n";
        walk(c, b);
      }
    });
  walk(el, false);
  // Join neighbouring bold runs, and keep spaces outside the marks ("**word** next", not "**word **next").
  out = out.replace(/\u0002\u0001/g, "").replace(/\u0001([\s\S]*?)\u0002/g, (_, x: string) => {
    const core = x.trim();
    return core ? `${x.match(/^\s*/)![0]}**${core}**${x.match(/\s*$/)![0]}` : x;
  });
  return out.replace(/\n$/, "");
}

function caretEnd(el: HTMLElement) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/**
 * An editable line of text where selected words can be made bold (the toolbar's Bold button). `max` is the most
 * characters it can grow to; text over it already is never cut.
 */
function RichInput({
  fid,
  text,
  max,
  className,
  format,
  placeholder,
  label,
  onText,
  onKeyDown,
}: {
  fid: string;
  text: string;
  max: number;
  className: string;
  format: LineFormat;
  placeholder: string;
  label: string;
  onText: (t: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The text the box shows now; when the line changes from outside (a format switch, Undo), the box is redrawn.
  const shown = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || text === shown.current) return;
    el.innerHTML = toHtml(text);
    shown.current = text;
    if (document.activeElement === el) caretEnd(el);
  }, [text]);
  return (
    <div
      ref={ref}
      data-fid={fid}
      className={className}
      data-format={format}
      data-ph={placeholder}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline
      aria-label={label}
      onInput={(e) => {
        const el = e.currentTarget;
        let next = fromHtml(el);
        const before = shown.current ?? "";
        if (plainText(next).length > max && plainText(next).length > plainText(before).length) {
          el.innerHTML = toHtml(before);
          caretEnd(el);
          return;
        }
        if (!plainText(next).trim()) {
          next = "";
          if (el.innerHTML) el.innerHTML = "";
        }
        shown.current = next;
        onText(next);
      }}
      onPaste={(e) => {
        // Pasted text comes in plain, without the source's styles.
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
      onKeyDown={onKeyDown}
    />
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
  // Edit mode on the Build step: every line and heading in a box with move buttons, nothing editable.
  const [arranging, setArranging] = useState(false);
  // The formatting toolbar under the selected line or heading can be tucked away (and brought back).
  const [toolsHidden, setToolsHidden] = useState(false);
  // Whether the text at the cursor is bold, for the toolbar's Bold button.
  const [boldOn, setBoldOn] = useState(false);
  // The description shows a light box while it's being edited on the Build step.
  const [descFocus, setDescFocus] = useState(false);
  const [linkSheet, setLinkSheet] = useState<LinkSheet | null>(null);
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
            lines: sec.lines.map((l) => ({ text: plainText(l.text).slice(0, 500), link: l.link || null })),
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

  // Focus the field that was just added or selected, with the cursor at the end.
  const focusId = useRef<string | null>(start === "title" ? "title" : null);
  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    const el = document.querySelector<HTMLElement>(`[data-fid="${id}"]`);
    if (!el) return;
    focusId.current = null;
    el.focus();
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.setSelectionRange(el.value.length, el.value.length);
    else caretEnd(el);
  });

  // The Bold button lights up while the cursor is in bold text.
  useEffect(() => {
    const onSel = () => {
      const a = document.activeElement;
      let on = false;
      try {
        on = !!(a instanceof HTMLElement && a.isContentEditable && document.queryCommandState("bold"));
      } catch {}
      setBoldOn(on);
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, []);

  const mapLineIn = (w: Work, id: string, fn: (l: Line) => Line): Work => ({ ...w, sections: w.sections.map((sec) => ({ ...sec, lines: sec.lines.map((l) => (l.id === id ? fn(l) : l)) })) });
  const mapLine = (id: string, fn: (l: Line, w: Work) => Line) => edit((w) => mapLineIn(w, id, (l) => fn(l, w)));
  /** Drops empty lines (but not `keep`), as happens when you move off a line. */
  const prune = (w: Work, keep: string | null): Work => ({ ...w, sections: w.sections.map((sec) => ({ ...sec, lines: sec.lines.filter((l) => l.id === keep || !isEmpty(l)) })) });
  const lineCount = (w: Work) => w.sections.reduce((n, sec) => n + sec.lines.length, 0);

  /** Selects a line or section heading (or nothing), dropping empty lines. */
  function select(next: Sel) {
    setWork((w) => prune(w, next?.kind === "line" ? next.id : null));
    if (next) focusId.current = next.id;
    setSel(next);
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
  }

  /**
   * A format from the toolbar. On a selected line it changes that line's format (Section on a fresh line turns it
   * into a heading, on a line with text starts a new section after it); on a selected heading it adds a line of
   * that format under it, or a new section after it.
   */
  function pick(type: Pick) {
    const w = work;
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
        const mid = mapLineIn(w, line.id, (x) => convertLine(x, type));
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

  /** Done on a line: leaves it (an empty line goes away). */
  function doneLine(l: Line) {
    select(null);
    if (isEmpty(l)) setWork((w) => prune(w, null));
  }

  /**
   * Return on a line: the next line starts (numbered and bulleted lines continue the list). On an empty list line
   * it ends the list instead, turning the line back into a fresh paragraph.
   */
  function enterLine(secId: string, l: Line) {
    if (!isListFormat(l.format)) return !isEmpty(l) ? addLine(secId, l.id, "text") : undefined;
    if (isEmpty(l)) return mapLine(l.id, (x) => ({ ...x, format: "text", picked: false }));
    addLine(secId, l.id, l.format);
  }

  /** Add item: a new line at the end, continuing the list above it if there is one. */
  function addItem() {
    const last = work.sections[work.sections.length - 1];
    const prev = work.sections.flatMap((sec) => sec.lines).at(-1);
    addLine(last.id, null, prev && isListFormat(prev.format) ? prev.format : "text");
  }

  /** Edit mode on and off. It needs something to arrange; turning it on leaves the line being written. */
  function toggleArrange() {
    if (!arranging && !work.sections.some((sec) => sec.headed || sec.lines.some((l) => !isEmpty(l)))) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setWork((w) => prune(w, null));
    setSel(null);
    setArranging((a) => !a);
  }

  /** Bold for the selected words (or what's typed next), in the line being written. */
  function toolBold() {
    if (!selLine || selLine.format === "bold") return;
    let el = document.activeElement as HTMLElement | null;
    if (!el?.isContentEditable) {
      el = document.querySelector<HTMLElement>(`[data-fid="${selLine.id}"]`);
      if (!el?.isContentEditable) return;
      el.focus();
      caretEnd(el);
    }
    document.execCommand("bold");
    setBoldOn(document.queryCommandState("bold"));
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

  /** Deletes a line, with Undo. */
  function deleteLine(id: string) {
    const before = work;
    edit((w) => ({ ...w, sections: w.sections.map((sec) => ({ ...sec, lines: sec.lines.filter((l) => l.id !== id) })) }));
    setSel(null);
    toast("Item deleted", { label: "Undo", run: () => edit(() => before) });
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

  /** Removes a section's heading (its lines join the section above), with Undo. */
  function removeSection(id: string) {
    const before = work;
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
    toast("Section header removed", { label: "Undo", run: () => edit(() => before) });
  }

  /** Opens the link sheet for a line's own link, or (`href`) to name a web address typed into its text. */
  function openLinkSheet(lineId: string, href?: string) {
    const l = work.sections.flatMap((sec) => sec.lines).find((x) => x.id === lineId);
    if (!l) return;
    const reselect = sel?.kind === "line" && sel.id === lineId;
    if (href) {
      focusId.current = "ls-name";
      return setLinkSheet({ lineId, mode: "text", url: href, name: l.linkNames[href] ?? "", reselect });
    }
    focusId.current = l.link ? "ls-name" : "ls-url";
    setLinkSheet({ lineId, mode: l.link ? "edit" : "add", url: l.link, name: l.linkName, reselect });
  }

  function closeLinkSheet() {
    if (linkSheet?.reselect) focusId.current = linkSheet.lineId;
    setLinkSheet(null);
  }

  function submitLinkSheet() {
    const ls = linkSheet;
    if (!ls) return;
    const name = ls.name.trim().slice(0, MAX_LINK_NAME);
    if (ls.mode === "text") {
      mapLine(ls.lineId, (l) => ({ ...l, linkNames: { ...l.linkNames, [ls.url]: name } }));
      return closeLinkSheet();
    }
    const v = ls.url.trim();
    if (!v) return ls.mode === "edit" ? removeLink() : closeLinkSheet();
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    // Something that isn't a link stays in the field, so it can be fixed.
    if (!/^https?:\/\/[^\s.]+\.\S+$/i.test(url) || url.length > 2048) return toast("That doesn't look like a link.");
    mapLine(ls.lineId, (l) => ({ ...l, link: url, linkName: name }));
    closeLinkSheet();
  }

  function removeLink() {
    if (!linkSheet) return;
    mapLine(linkSheet.lineId, (l) => ({ ...l, link: "", linkName: "" }));
    closeLinkSheet();
  }

  function toStep(next: Step) {
    focusId.current = next === "title" ? "title" : next === "description" ? "desc" : null;
    setStep(next);
  }

  function goBuild() {
    setStep("build");
    setSel(null);
    // With nothing written yet, start with a numbered line, ready to type into.
    if (work.sections.some((sec) => sec.lines.some((l) => !isEmpty(l)))) return;
    const l = newLine("num");
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
    if (!counts(w).n) return toast("Add a line to publish.");
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
    if (!counts(work).n) return toast("Add a line to publish.");
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
    if (!counts(work).n) return toast("Add a line to publish.");
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
  const left = MAX_TOTAL - textTotal(work);
  // The toolbar marks the format in use: the selected line's, or Section for a heading.
  const curFormat: Pick | null = selLine ? selLine.format : sel?.kind === "sec" ? "section" : null;
  // Keeps focus in the text while tapping the toolbar and line tools.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  const canArrange = arranging || work.sections.some((sec) => sec.headed || sec.lines.some((l) => !isEmpty(l)));

  const toolbar = toolsHidden ? null : (
    <div className={s.toolbar} onMouseDown={keep}>
      <div className={s.toolbarRow} role="toolbar" aria-label="Format">
        {FORMATS.map(([type, label, icon]) => (
          <button key={type} className={s.tool} data-on={type === curFormat || undefined} onMouseDown={keep} onClick={() => pick(type)}>
            {icon}
            <span className={s.toolLabel}>{label}</span>
          </button>
        ))}
        <span className={s.toolDivider} />
        <button className={s.tool} disabled={!selLine} onMouseDown={keep} onClick={() => selLine && openLinkSheet(selLine.id)}>
          {linkIcon(16)}
          <span className={s.toolLabel}>Link</span>
        </button>
        <button
          className={s.tool}
          data-pressed={(boldOn && !!selLine && selLine.format !== "bold") || undefined}
          disabled={!selLine || selLine.format === "bold"}
          onMouseDown={keep}
          onClick={toolBold}
          aria-pressed={boldOn}
          aria-label="Bold"
        >
          <span className={s.toolB} aria-hidden>
            B
          </span>
          <span className={s.toolLabel}>Bold</span>
        </button>
        <button className={s.tool} data-on={curFormat === "bold" || undefined} onMouseDown={keep} onClick={() => pick("bold")} aria-label="Bold line">
          <span className={s.toolAa} aria-hidden>
            Aa
          </span>
          <span className={s.toolLabel}>Bold line</span>
        </button>
      </div>
      <button className={s.toolHide} onMouseDown={keep} onClick={() => setToolsHidden(true)} aria-label="Hide toolbar">
        {arrow("down")}
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
                {canArrange ? (
                  <div className={s.arrangeRow}>
                    <button className={s.arrangeBtn} data-on={arranging || undefined} onMouseDown={keep} onClick={toggleArrange}>
                      {!arranging && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M4.5 19.5h4l10-10-4-4-10 10v4z" />
                          <path d="M13 7l4 4" />
                        </svg>
                      )}
                      {arranging ? "Done" : "Edit"}
                    </button>
                  </div>
                ) : (
                  <div style={{ height: 4 }} />
                )}

                {work.sections.map((sec, si) => {
                  const secSel = sel?.kind === "sec" && sel.id === sec.id;
                  return (
                    <div key={sec.id} className={s.section}>
                      {sec.headed && (
                        <div className={s.sectionHead}>
                          <div className={s.sectionBox} data-arranging={arranging || undefined}>
                            <div className={s.sectionRule}>
                              <span className={s.sectionBar} />
                              <textarea
                                data-fid={sec.id}
                                className={s.sectionInput}
                                rows={1}
                                readOnly={arranging}
                                value={sec.label}
                                onChange={(e) => {
                                  const v = e.target.value.replace(/\s*\n\s*/g, " ");
                                  edit((w) => ({ ...w, sections: w.sections.map((x) => (x.id === sec.id ? { ...x, label: capText(w, v, x.label, MAX_LABEL) } : x)) }));
                                }}
                                onFocus={() => !arranging && !secSel && select({ kind: "sec", id: sec.id })}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    doneSec(sec);
                                  }
                                }}
                                placeholder="Section heading"
                                aria-label="Section heading"
                              />
                              {secSel && (
                                <button className={s.headDelete} onMouseDown={keep} onClick={() => removeSection(sec.id)} aria-label="Remove heading">
                                  {trashIcon("oklch(48% 0.16 30)")}
                                </button>
                              )}
                              {arranging && (
                                <span className={s.moveBtns}>
                                  <button className={s.moveBtn} onMouseDown={keep} onClick={() => moveHeading(sec.id, -1)} disabled={si === 0} aria-label="Move heading up">
                                    {arrow("up")}
                                  </button>
                                  <button
                                    className={s.moveBtn}
                                    onMouseDown={keep}
                                    onClick={() => moveHeading(sec.id, 1)}
                                    disabled={!sec.lines.length && si === work.sections.length - 1}
                                    aria-label="Move heading down"
                                  >
                                    {arrow("down")}
                                  </button>
                                </span>
                              )}
                            </div>
                            {secSel && (
                              <>
                                <div className={s.headDoneRow}>
                                  <button className={s.doneBtn} onMouseDown={keep} onClick={() => doneSec(sec)}>
                                    Done
                                  </button>
                                </div>
                                {toolbar}
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {sec.lines.map((l) => {
                        if (l.format === "num") num++;
                        const n2 = String(num).padStart(2, "0");
                        const list = isListFormat(l.format);
                        const isSel = !arranging && sel?.kind === "line" && sel.id === l.id;
                        const lastInSec = l.id === sec.lines[sec.lines.length - 1].id;
                        const linkLabel = l.link ? l.linkName.trim() || linkDomain(l.link) : "";
                        if (!isSel) {
                          // Web addresses typed into the text show as link pills, like on the stack page.
                          const view = splitTextLinks(l.text, "", l.link || null, l.linkNames);
                          // In edit mode pills are just labels; otherwise tapping one opens the link sheet.
                          const pills = [...view.links.map((u) => [u.href, u.label, u.href] as const), ...(l.link ? [[l.link, linkLabel, undefined] as const] : [])];
                          return (
                            <div
                              key={l.id}
                              className={`${s.line} ${lastInSec || arranging ? "" : s.lineDivided}`}
                              data-arranging={arranging || undefined}
                              role={arranging ? undefined : "button"}
                              tabIndex={arranging ? undefined : 0}
                              onClick={() => !arranging && select({ kind: "line", id: l.id })}
                              onKeyDown={(e) => !arranging && e.key === "Enter" && select({ kind: "line", id: l.id })}
                            >
                              {marker(l, n2)}
                              <div className={s.lineBody}>
                                {(view.head || !(l.link || view.links.length)) && (
                                  <div className={l.format === "text" ? s.para : l.format === "bold" ? s.boldLine : s.head} data-empty={!view.head || undefined}>
                                    {view.head ? <RichText text={view.head} /> : l.format === "text" ? "Empty paragraph \u2014 tap to write" : "Empty line \u2014 tap to write"}
                                  </div>
                                )}
                                {(view.links.length > 0 || !!l.link) && (
                                  <div className={s.pills}>
                                    {pills.map(([key, label, href]) => (
                                      <span
                                        key={key}
                                        className={s.visit}
                                        role={arranging ? undefined : "button"}
                                        onClick={(e) => {
                                          if (arranging) return;
                                          e.stopPropagation();
                                          openLinkSheet(l.id, href);
                                        }}
                                      >
                                        {linkIcon(11)}
                                        {label}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {arranging && (
                                <span className={s.moveBtns}>
                                  <button className={s.moveBtn} onClick={() => moveLine(l.id, -1)} disabled={l.id === allIds[0]} aria-label="Move line up">
                                    {arrow("up")}
                                  </button>
                                  <button className={s.moveBtn} onClick={() => moveLine(l.id, 1)} disabled={l.id === allIds[allIds.length - 1]} aria-label="Move line down">
                                    {arrow("down")}
                                  </button>
                                </span>
                              )}
                            </div>
                          );
                        }
                        const tm = maxText(l.format);
                        const len = plainText(l.text).length;
                        const full = len >= tm || left <= 0;
                        const count = [len >= tm * 0.8 && `${len}/${tm}`, left <= 500 && `${n0(Math.max(left, 0))} left in stack`].filter(Boolean).join(" \u00b7 ");
                        return (
                          <div key={l.id} className={s.lineEdit} data-line-box>
                            <button className={s.lineDelete} onMouseDown={keep} onClick={() => deleteLine(l.id)} aria-label="Delete line">
                              {trashIcon("var(--muted-66)")}
                            </button>
                            <div className={s.lineEditRow}>
                              {marker(l, n2)}
                              <div className={s.lineInputs}>
                                {l.format === "bold" ? (
                                  <textarea
                                    data-fid={l.id}
                                    className={s.lineInput}
                                    data-format="bold"
                                    value={l.text}
                                    rows={1}
                                    onChange={(e) => {
                                      const raw = e.target.value.replace(/\s*\n\s*/g, " ");
                                      mapLine(l.id, (x, w) => ({ ...x, text: capText(w, raw, x.text, MAX_BOLD_LINE) }));
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key !== "Enter" || e.shiftKey) return;
                                      e.preventDefault();
                                      enterLine(sec.id, l);
                                    }}
                                    placeholder="Bold line"
                                    aria-label="Bold line"
                                  />
                                ) : (
                                  <RichInput
                                    fid={l.id}
                                    className={s.lineInput}
                                    format={l.format}
                                    text={l.text}
                                    max={Math.max(0, Math.min(tm, left + len))}
                                    onText={(t) => mapLine(l.id, (x) => ({ ...x, text: t }))}
                                    onKeyDown={(e) => {
                                      if (e.key !== "Enter" || e.shiftKey) return;
                                      e.preventDefault();
                                      enterLine(sec.id, l);
                                    }}
                                    placeholder={l.format === "text" ? (l.picked ? "Write a paragraph" : "Start writing, or pick a format in the toolbar") : "Write an item"}
                                    label={l.format === "text" ? "Paragraph" : "Item"}
                                  />
                                )}
                              </div>
                            </div>
                            <div className={s.lineTools} data-list={list || undefined}>
                              {l.link && (
                                <button className={s.visit} onMouseDown={keep} onClick={() => openLinkSheet(l.id)} aria-label={`Edit link ${linkLabel}`}>
                                  {linkIcon(11)}
                                  {linkLabel}
                                </button>
                              )}
                              <div className={s.toolRow}>
                                {toolsHidden && (
                                  <button className={s.showTools} onMouseDown={keep} onClick={() => setToolsHidden(false)}>
                                    {arrow("up")}
                                    Formatting
                                  </button>
                                )}
                                <span className={s.charCount} data-full={(count && full) || undefined}>
                                  {count}
                                </span>
                                <button className={s.lineDone} onMouseDown={keep} onClick={() => doneLine(l)}>
                                  Done
                                </button>
                              </div>
                              {toolbar}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
                {!sel && !arranging && (
                  <button className={s.addItem} onClick={addItem}>
                    <span className={s.addItemIcon}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                    Add item
                  </button>
                )}
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
                    setArranging(false);
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
                    setArranging(false);
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
            {!n && <div className={s.cantPublish}>Add a line to publish.</div>}
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
                  .filter((l) => !isEmpty(l))
                  .map((l, i) => ({
                    num: l.format === "num" ? String(++pn).padStart(2, "0") : l.format === "bullet" ? "•" : "",
                    label: i === 0 && sec.headed && sec.label.trim() ? sec.label : null,
                    ...splitTextLinks(l.text, "", l.link || null, l.linkNames),
                    link: l.link || null,
                    linkLabel: l.link ? l.linkName.trim() || linkDomain(l.link) : "",
                    format: l.format,
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

      {linkSheet && (
        <div className={s.scrim} data-light onMouseDown={closeLinkSheet}>
          <div className={s.sheet} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="link-title">
            <div className={s.grabber} />
            <div className={s.lsHead}>
              <span id="link-title" className={s.sheetTitle}>
                {linkSheet.mode === "add" ? "Add link" : "Edit link"}
              </span>
              {linkSheet.mode === "edit" && (
                <button className={s.lsRemove} onClick={removeLink}>
                  Remove link
                </button>
              )}
            </div>
            <label className={s.lsLabel} htmlFor="ls-url">
              Link
            </label>
            <input
              id="ls-url"
              data-fid="ls-url"
              className={s.lsInput}
              data-locked={linkSheet.mode === "text" || undefined}
              readOnly={linkSheet.mode === "text"}
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              value={linkSheet.url}
              onChange={(e) => {
                const v = e.target.value.slice(0, 2048);
                setLinkSheet((ls) => ls && { ...ls, url: v });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitLinkSheet();
                }
                if (e.key === "Escape") closeLinkSheet();
              }}
              placeholder="Paste a link"
            />
            <label className={s.lsLabel} htmlFor="ls-name">
              Name <span className={s.lsOptional}>(optional)</span>
            </label>
            <input
              id="ls-name"
              data-fid="ls-name"
              className={s.lsInput}
              data-name
              value={linkSheet.name}
              maxLength={MAX_LINK_NAME}
              onChange={(e) => {
                const v = e.target.value.slice(0, MAX_LINK_NAME);
                setLinkSheet((ls) => ls && { ...ls, name: v });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitLinkSheet();
                }
                if (e.key === "Escape") closeLinkSheet();
              }}
              placeholder={(() => {
                const v = linkSheet.url.trim();
                if (!v) return "e.g. Reservation page";
                const base = linkDomain(/^https?:/i.test(v) ? v : `https://${v}`).split(".")[0];
                return `e.g. ${base.charAt(0).toUpperCase()}${base.slice(1)} menu`;
              })()}
            />
            <div className={s.lsPreview}>
              <span>Shows as</span>
              <span className={s.visit} style={{ marginTop: 0 }}>
                {linkIcon(11)}
                {linkSheet.name.trim() || (linkSheet.url.trim() ? linkDomain(/^https?:/i.test(linkSheet.url.trim()) ? linkSheet.url.trim() : `https://${linkSheet.url.trim()}`) : "example.com")}
              </span>
            </div>
            <div className={s.lsButtons}>
              <button className={s.lsCancel} onClick={closeLinkSheet}>
                Cancel
              </button>
              <button className={s.lsSubmit} aria-disabled={!(linkSheet.url.trim() || linkSheet.mode !== "add") || undefined} onClick={submitLinkSheet}>
                {linkSheet.mode === "add" ? "Add" : "Save"}
              </button>
            </div>
          </div>
        </div>
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
