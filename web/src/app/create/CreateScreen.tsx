"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useBack, useToast } from "@/components/AppProviders";
import shell from "@/components/AppShell.module.css";
import { ShareSheet, systemShare } from "@/components/Share";
import { StackPaper, TagChips } from "@/components/StackView";
import {
  firstTextLink,
  initials,
  linkDomain,
  oneLine,
  plainText,
  tagInfo,
  textLinks,
  suggestColor,
  suggestEmoji,
  CATEGORIES,
  MAX_CATEGORIES,
  MAX_CITY,
  PLACE_EMOJIS,
  THEME_COLORS,
  THEME_EMOJIS,
  MAX_DESCRIPTION,
  MAX_HEADING,
  MAX_ITEMS,
  MAX_LABEL,
  MAX_LINK_NAME,
  MAX_LINKS,
  MAX_SECTIONS,
  MAX_SUBHEADING,
  MAX_TAG,
  MAX_TAGS,
  MAX_TITLE,
  PRICE_TAGS,
  TAG_GROUPS,
} from "@/lib/format";
import { SHOW_DRAFTS } from "@/lib/navFlags";
import { createClient } from "@/lib/supabase/client";
import { fetchStack } from "@/lib/queries";
import { useVisibility } from "@/lib/store";
import { useVisibilityEditor } from "@/components/Visibility";
import type { Draft, DraftLine, EditTarget, PickLink, Stack, Visibility } from "@/lib/types";
import p from "../profile/Profile.module.css";
import s from "./Create.module.css";

type Step = "title" | "description" | "build" | "review";
/** A pick is numbered or bulleted; there are no paragraphs or bold lines (spec, Content rules). */
type ListFormat = "num" | "bullet";
/**
 * A pick being edited: its stable id, heading (`text`), optional subheading (`sub`), up to 2 links (each with an
 * optional name for its button) and up to 3 tags.
 */
type EditLink = { url: string; name: string };
type Line = { id: string; text: string; sub: string; links: EditLink[]; format: ListFormat; tags: string[]; legacyUrls?: string[] };
type Sec = { id: string; headed: boolean; label: string; lines: Line[] };
// `tags` here are the stack's own (older) tags, which aren't edited here; a pick's tags are on the pick.
type Work = {
  title: string;
  description: string;
  tags: string[];
  visibility: Visibility;
  location: string;
  sections: Sec[];
  /** Finalize: the theme the author picked (null: suggested from the title). */
  theme: { emoji: string; color: string } | null;
  /** Finalize: whether it's about a place (null: not answered yet, guessed from the theme and city). */
  isPlace: boolean | null;
  /** Finalize: up to 2 of the 12 categories. */
  categories: string[];
};
type Sel = { kind: "line" | "sec"; id: string } | null;
type Pick = ListFormat | "section";
type SaveState = "idle" | "saving" | "saved" | "error" | "over";
/** The Add link / Edit link sheet for a pick: `index` is the link being edited, or null to add one. */
type LinkSheet = { lineId: string; index: number | null; url: string; name: string; reselect: boolean };

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
const FULL_ITEMS = `${MAX_ITEMS} of ${MAX_ITEMS} items · remove one to add another`;
const FULL_SECTIONS = `A Stack can have up to ${MAX_SECTIONS} sections.`;
const FULL_LINKS = `A pick can have up to ${MAX_LINKS} links. Remove one to add another.`;

let nextId = 1;
const uid = () => `k${nextId++}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const newLine = (format: ListFormat = "num"): Line => ({ id: crypto.randomUUID(), text: "", sub: "", links: [], format, tags: [] });
const isEmpty = (l: Line) => !l.text.trim() && !l.sub.trim() && !l.links.length && !l.tags.length;
const linkLabel = (k: EditLink) => k.name.trim() || linkDomain(k.url);
/** A saved line's links: its `links`, or an older line's single `link`. */
const savedLinks = (l: DraftLine): EditLink[] =>
  (Array.isArray(l.links) ? l.links : l.link ? [{ url: l.link, name: l.linkName ?? "" }] : [])
    .filter((k: PickLink) => typeof k?.url === "string" && k.url)
    .map((k: PickLink) => ({ url: k.url, name: k.name ?? "" }));
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

/**
 * A saved line → a pick. A pick saved by this editor (it has an id and is numbered or bulleted) comes back exactly
 * as it was: a heading that names a website ("Ramen at fuunji.jp") stays as typed.
 *
 * Only lines from before picks (spec, Existing content) are converted: paragraphs and bold lines become bulleted
 * picks, ** marks and line breaks go, and an older line's separate detail becomes its subheading. Web addresses
 * typed into its text become its links, up to 2 with the line's own link (and keep their names). Any more stay in
 * the heading, and are listed for the owner to resolve (`legacyUrls`). Nothing is cut: anything over a limit is
 * listed too.
 */
function toPick(l: DraftLine): Line {
  const tags = (l.tags ?? []).filter((t) => t.trim());
  if (l.id && UUID.test(l.id) && (l.format === "num" || l.format === "bullet")) {
    return {
      id: l.id,
      text: l.text ?? "",
      sub: l.note ?? "",
      links: savedLinks(l),
      format: l.format,
      tags,
      ...(l.legacyUrls?.length ? { legacyUrls: l.legacyUrls } : {}),
    };
  }
  let text = oneLine(plainText(l.text ?? "")).trim();
  const links = savedLinks(l);
  while (links.length < MAX_LINKS) {
    const next = firstTextLink(text);
    if (!next) break;
    text = next.rest;
    if (!links.some((k) => k.url === next.href)) links.push({ url: next.href, name: l.linkNames?.[next.href] ?? "" });
  }
  const legacyUrls = textLinks(text).links;
  return {
    id: crypto.randomUUID(),
    text,
    sub: oneLine(l.note ?? "").trim(),
    links,
    format: l.format === "num" ? "num" : "bullet",
    tags,
    ...(legacyUrls.length ? { legacyUrls } : {}),
  };
}

// A full web address written into a pick's text: one starting with https://, http:// or www. A plain name like
// "fuunji.jp" isn't one, so a heading such as "Ramen at fuunji.jp" stays as typed.
const FULL_URL = /(?:https?:\/\/|www\.)[^\s]+/gi;

/**
 * Where a written web address ends: sentence punctuation after it (".", ",", "!"…) isn't part of it, and neither is
 * a closing bracket that closes one opened before the address ("(see https://x.com/a)"). A closing bracket that
 * matches one inside the address stays ("https://example.com/wiki/It_(novel)").
 */
function urlEnd(m: string) {
  let end = m.length;
  for (;;) {
    const c = m[end - 1];
    if (".,;:!?'\"".includes(c)) end--;
    else if (c === ")" || c === "]") {
      const open = c === ")" ? "(" : "[";
      const part = m.slice(0, end);
      if (part.split(open).length - 1 < part.split(c).length - 1) end--;
      else break;
    } else break;
    if (end === 0) break;
  }
  return m.slice(0, end);
}

/**
 * Turns full web addresses written into a pick's heading or subheading into its links (up to 2). An address is
 * taken once it's finished: something follows it (a space), or `done` (pasted, Enter, Done, or leaving the field).
 * One the pick already has just leaves the text; one past 2 links stays in the text (`refused`). Spacing is tidied.
 */
function takeLinks(text: string, links: EditLink[], done: boolean): { text: string; links: EditLink[]; refused: string[] } {
  const out = [...links];
  const refused: string[] = [];
  let changed = false;
  const next = text.replace(FULL_URL, (m, offset: number) => {
    const raw = urlEnd(m);
    const trail = m.slice(raw.length);
    if (!done && offset + m.length >= text.length) return m;
    const url = /^https?:/i.test(raw) ? raw : `https://${raw}`;
    if (!/^https?:\/\/[^\s.]+\.\S+$/i.test(url) || url.length > 2048) return m;
    if (out.some((k) => k.url === url)) {
      changed = true;
      return trail;
    }
    if (out.length >= MAX_LINKS) {
      refused.push(url);
      return m;
    }
    out.push({ url, name: "" });
    changed = true;
    return trail;
  });
  if (!changed) return { text, links, refused };
  const tidy = next.replace(/ {2,}/g, " ").replace(/ +([,;.!?)\]])/g, "$1").replace(/([([]) +/g, "$1");
  return { text: done ? tidy.trim() : tidy.replace(/^ +/, ""), links: out, refused };
}

/** Web addresses from an older line that are still in a pick's heading. */
const leftoverUrls = (l: Line) => (l.legacyUrls?.length ? textLinks(l.text).links.filter((u) => l.legacyUrls!.includes(u)) : []);

/**
 * Undo for a deleted pick: puts back just that pick, after the pick that was above it (or before the one that was
 * below it, or in its section), into the stack as it is now, so edits made since are kept.
 */
function restoreLine(w: Work, line: Line, at: { secId: string; si: number; prevId: string | null; nextId: string | null }): Work {
  if (w.sections.some((sec) => sec.lines.some((l) => l.id === line.id))) return w;
  const secs = w.sections.map((x) => ({ ...x, lines: [...x.lines] }));
  const find = (id: string | null) => {
    if (!id) return null;
    for (const sec of secs) {
      const k = sec.lines.findIndex((l) => l.id === id);
      if (k >= 0) return { sec, k };
    }
    return null;
  };
  const prev = find(at.prevId);
  const next = prev ? null : find(at.nextId);
  if (prev) prev.sec.lines.splice(prev.k + 1, 0, line);
  else if (next) next.sec.lines.splice(next.k, 0, line);
  else {
    const sec = secs.find((x) => x.id === at.secId) ?? secs[Math.min(at.si, secs.length - 1)];
    if (at.prevId) sec.lines.push(line);
    else sec.lines.unshift(line);
  }
  return { ...w, sections: secs };
}

/**
 * Undo for a removed section title: puts back just the title. The picks that joined the section above get it
 * back, from the first of them still there to the end of that section (picks added among them since go with them);
 * other edits are kept.
 */
function restoreHeading(w: Work, head: { id: string; label: string }, lineIds: string[], si: number): Work {
  const own = w.sections.findIndex((x) => x.id === head.id);
  if (own >= 0) return w.sections[own].headed ? w : { ...w, sections: w.sections.map((x, k) => (k === own ? { ...x, headed: true, label: head.label } : x)) };
  const secs = w.sections.map((x) => ({ ...x, lines: [...x.lines] }));
  for (let k = 0; k < secs.length; k++) {
    const at = secs[k].lines.findIndex((l) => lineIds.includes(l.id));
    if (at >= 0) {
      secs.splice(k + 1, 0, { id: head.id, headed: true, label: head.label, lines: secs[k].lines.splice(at) });
      return { ...w, sections: secs };
    }
  }
  secs.splice(Math.min(si, secs.length), 0, { id: head.id, headed: true, label: head.label, lines: [] });
  return { ...w, sections: secs };
}

function fromDraft(d: Draft): Work {
  const sections: Sec[] = d.sections.map((sec, i) => ({ id: uid(), headed: i > 0 || !!sec.label.trim(), label: oneLine(sec.label), lines: sec.lines.map(toPick) }));
  if (!sections.length) sections.push({ id: uid(), headed: false, label: "", lines: [] });
  return {
    title: d.title === UNTITLED ? "" : oneLine(d.title),
    description: oneLine(d.description),
    tags: d.tags,
    visibility: d.visibility,
    location: d.location,
    sections,
    theme: d.theme && THEME_EMOJIS.includes(d.theme.emoji) && THEME_COLORS.includes(d.theme.color) ? d.theme : null,
    isPlace: typeof d.isPlace === "boolean" ? d.isPlace : null,
    categories: (d.categories ?? []).filter((c) => CATEGORIES.some((x) => x.name === c)).slice(0, MAX_CATEGORIES),
  };
}

/**
 * The Finalize choices as they'll be published: the picked theme or the one the title suggests, whether it's about
 * a place (unanswered: yes when there's a city or the theme's emoji suggests a place), and the city if it is.
 */
function finalChoices(w: Work) {
  const emoji = w.theme?.emoji ?? suggestEmoji(w.title);
  const color = w.theme?.color ?? suggestColor(w.title);
  const isPlace = w.isPlace ?? (!!w.location.trim() || PLACE_EMOJIS.includes(emoji));
  return { emoji, color, isPlace, city: isPlace ? oneLine(w.location).trim() : "" };
}

const counts = (w: Work) => {
  let n = 0;
  let k = 0;
  w.sections.forEach((sec) => sec.lines.forEach((l) => (!isEmpty(l) && n++, (k += l.links.length))));
  return { n, k };
};
const headedCount = (w: Work) => w.sections.filter((sec) => sec.headed).length;
const over = (len: number, max: number) => len - max;

/**
 * A field's counter: nothing until 80% of its limit, then "name 70/80", and past it "name 84/80 · 4 over".
 * `full` is whether it's over.
 */
function counter(name: string, len: number, max: number) {
  if (len < max * 0.8) return { text: "", full: false };
  const o = over(len, max);
  return { text: `${name ? `${name} ` : ""}${len}/${max}${o > 0 ? ` · ${o} over` : ""}`, full: o > 0 };
}

/**
 * Everything to fix before this stack can be published, in words (empty when it fits). Mirrors the database's
 * checks (migration 20261129000000_pick_model); a draft saves either way.
 */
function limitProblems(w: Work): string[] {
  const out: string[] = [];
  const t = w.title.trim().length;
  const d = w.description.trim().length;
  if (t > MAX_TITLE) out.push(`Title is ${over(t, MAX_TITLE)} over ${MAX_TITLE} characters.`);
  if (d > MAX_DESCRIPTION) out.push(`Description is ${over(d, MAX_DESCRIPTION)} over ${MAX_DESCRIPTION} characters.`);
  const headed = headedCount(w);
  if (headed > MAX_SECTIONS) out.push(`A Stack can have up to ${MAX_SECTIONS} sections (this has ${headed}).`);
  let si = 0;
  for (const sec of w.sections) {
    if (!sec.headed) continue;
    si++;
    const len = sec.label.trim().length;
    if (!len && sec.lines.some((l) => !isEmpty(l))) out.push(`Section ${si} needs a title.`);
    if (len > MAX_LABEL) out.push(`“${sec.label.trim().slice(0, 24)}${len > 24 ? "…" : ""}” title is ${over(len, MAX_LABEL)} over ${MAX_LABEL} characters.`);
  }
  const items = w.sections.flatMap((sec) => sec.lines.filter((l) => !isEmpty(l)));
  if (items.length > MAX_ITEMS) out.push(`A Stack can have up to ${MAX_ITEMS} items (this has ${items.length}).`);
  items.forEach((l, i) => {
    const n = i + 1;
    const h = l.text.trim().length;
    const sb = l.sub.trim().length;
    if (!h) out.push(`Item ${n} needs a heading.`);
    if (h > MAX_HEADING) out.push(`Item ${n} heading is ${over(h, MAX_HEADING)} over ${MAX_HEADING} characters.`);
    if (sb > MAX_SUBHEADING) out.push(`Item ${n} subheading is ${over(sb, MAX_SUBHEADING)} over ${MAX_SUBHEADING} characters.`);
    if (l.tags.length > MAX_TAGS) out.push(`Item ${n} has ${l.tags.length} tags. Remove ${l.tags.length - MAX_TAGS} to keep ${MAX_TAGS}.`);
    l.tags.filter((x) => x.trim().length > MAX_TAG).forEach((x) => out.push(`Item ${n} tag “${x.trim().slice(0, 12)}…” is ${over(x.trim().length, MAX_TAG)} over ${MAX_TAG} characters.`));
    if (l.tags.filter((x) => PRICE_TAGS.includes(x)).length > 1) out.push(`Item ${n} has more than one price. Keep one.`);
    const left = leftoverUrls(l);
    if (left.length)
      out.push(
        `Item ${n} heading still has ${left.length === 1 ? "a web address" : `${left.length} web addresses`} from an older version (${left.map(linkDomain).join(", ")}). Make ${left.length === 1 ? "it a link or remove it" : "them links or remove them"} (up to ${MAX_LINKS} links per item).`,
      );
  });
  return out;
}

/** The sections as publish_draft and apply_stack_edit take them (and as drafts keep them). */
const sectionsArg = (w: Work) =>
  w.sections.map((sec) => ({
    label: sec.headed ? sec.label : "",
    lines: sec.lines.map((l) => ({
      id: l.id,
      text: l.text,
      ...(l.sub.trim() ? { note: l.sub } : {}),
      // The first link is also kept as `link` and `linkName`, where older readers look for it.
      link: l.links[0]?.url ?? null,
      format: l.format,
      ...(l.links[0]?.name.trim() ? { linkName: l.links[0].name.trim() } : {}),
      ...(l.links.length ? { links: l.links.map((k) => ({ url: k.url, ...(k.name.trim() ? { name: k.name.trim() } : {}) })) } : {}),
      ...(l.tags.length ? { tags: l.tags } : {}),
      // Kept on the draft until resolved; publishing drops it.
      ...(leftoverUrls(l).length ? { legacyUrls: leftoverUrls(l) } : {}),
    })),
  }));

const WEEK = 7 * 86_400_000;
const shortDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** What decides whether an edit changed the stack: the visible text, formats, links and tags, ignoring empty picks and spacing. */
const contentKey = (w: Work) =>
  JSON.stringify([
    w.title.trim(),
    w.description.trim(),
    w.sections
      .map(
        (sec) =>
          [
            sec.headed ? sec.label.trim() : "",
            sec.lines.filter((l) => !isEmpty(l)).map((l) => [l.text.trim(), l.sub.trim(), l.links.map((k) => [k.url, k.name.trim()]), l.format, l.tags]),
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

const hasContent = (w: Work) => !!(w.title.trim() || w.description.trim() || w.sections.some((sec) => sec.lines.some((l) => !isEmpty(l))));

function caretEnd(el: HTMLElement) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(r);
}

/**
 * The four-step create flow: title, description, build (edit in place), finalize. Drafts save automatically.
 * With `edit`, it edits a published stack instead: only the build step, with Publish and Publish & Share Update.
 */
export default function CreateScreen({ initial, start, edit: target = null }: { initial: Draft; start: Step; edit?: EditTarget | null }) {
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
  // Edit opens a menu: Reorder (move buttons) or Delete (a delete button on each line and heading).
  const [editMode, setEditMode] = useState<"reorder" | "delete">("reorder");
  const [editMenu, setEditMenu] = useState(false);
  // The formatting toolbar under the selected line or heading can be tucked away (and brought back).
  const [toolsHidden, setToolsHidden] = useState(false);
  // The tags tray, for the pick with this id; and the "Your own" tag being typed in it.
  const [tagFor, setTagFor] = useState<string | null>(null);
  const [ownTag, setOwnTag] = useState("");
  // The description shows a light box while it's being edited on the Build step.
  const [descFocus, setDescFocus] = useState(false);
  const [linkSheet, setLinkSheet] = useState<LinkSheet | null>(null);
  const [sheet, setSheet] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [save, setSave] = useState<SaveState>(initial.id ? "saved" : "idle");
  const [published, setPublished] = useState<string | null>(null);
  // The just-published stack, loaded for the share sheet's story images; and whether that sheet is open.
  const [publishedStack, setPublishedStack] = useState<Stack | null>(null);
  const [shareSheet, setShareSheet] = useState(false);
  const publishedVis = useVisibility({ id: published ?? "", visibility: work.visibility });
  // A private stack can't be shared: Share offers the visibility sheet instead, as on the stack page.
  const vis = useVisibilityEditor(() => router.replace("/profile"));
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

  // The draft's id. The app makes it before the first save, and every save is an upsert on it, so a save that's
  // retried (say its reply was lost) updates the same draft instead of making a second one. Publishing gives the
  // stack the same id, so a retried publish can't make a second stack either. `saved` is whether the draft row
  // exists yet; a queue keeps saves from overlapping.
  const [newId] = useState(() => crypto.randomUUID());
  const idRef = useRef<string>(initial.id ?? newId);
  const saved = useRef(!!initial.id);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const dirty = useRef(false);
  const workRef = useRef(work);
  const stepRef = useRef(step);
  useEffect(() => {
    workRef.current = work;
    stepRef.current = step;
  }, [work, step]);
  // Every change (to the content or the step) bumps `version`; a save that lands records, in `confirmed`, the
  // version it carried. Until `confirmed` catches up, the latest work isn't safely saved: leaving the page asks
  // first, and the status doesn't say Saved.
  const version = useRef(0);
  const confirmed = useRef(0);
  const unsaved = () => confirmed.current < version.current && (saved.current || hasContent(workRef.current));
  const persist = useCallback(
    (status: "draft" | "published", title?: string) => {
      // Drafts keep everything as typed, even over a limit; limits are checked when it's published.
      const row = (w: Work) => ({
        id: idRef.current,
        content: {
          v: 1,
          title: w.title,
          description: w.description,
          sections: sectionsArg(w),
          tags: w.tags,
          style: initial.style,
          visibility: w.visibility,
          location: w.location,
          theme: w.theme,
          isPlace: w.isPlace,
          categories: w.categories,
        },
        step: stepRef.current,
        edit_of: target?.stackId ?? null,
        base_version: target?.baseVersion ?? null,
        remixed_from: initial.forkedFromId,
      });
      const run = async (): Promise<string | null> => {
        const w = workRef.current;
        const v = version.current;
        const sb = createClient();
        let { error } = await sb.from("drafts").upsert(row(w), { onConflict: "id" });
        // Edits to a published stack: another tab may have started its edits draft first. Carry on in that one.
        if (error?.code === "23505" && target) {
          const { data } = await sb.from("drafts").select("id").eq("edit_of", target.stackId).maybeSingle();
          if (data) {
            idRef.current = data.id;
            ({ error } = await sb.from("drafts").upsert(row(w), { onConflict: "id" }));
          }
        }
        // Any error counts, even one without a message.
        if (error) return error.message || "Couldn't save";
        confirmed.current = Math.max(confirmed.current, v);
        if (!saved.current) {
          saved.current = true;
          // A new stack's address becomes its draft's, so a refresh reopens it where it was.
          if (!target) window.history.replaceState(window.history.state, "", `/drafts/${idRef.current}`);
        }
        if (status === "draft") return null;
        const { error: pub } = await sb.rpc("publish_draft", {
          p_id: idRef.current,
          p_title: (title ?? w.title).trim(),
          p_sections: sectionsArg(w),
          p_tags: w.tags,
          p_style: initial.style,
          p_description: w.description.trim(),
          p_visibility: w.visibility,
          p_location: finalChoices(w).city,
          p_theme_emoji: finalChoices(w).emoji,
          p_theme_color: finalChoices(w).color,
          p_is_place: finalChoices(w).isPlace,
          p_categories: w.categories,
        });
        return pub ? pub.message || "Couldn't publish" : null;
      };
      const next = queue.current.then(run, run);
      queue.current = next;
      return next;
    },
    [initial.forkedFromId, initial.style, target],
  );

  // After a save: if a newer change came in while it was on its way (say the step changed before the first save
  // landed) and no autosave is waiting to pick it up, save again so the latest content and step get saved too.
  const settle = useCallback(
    function settle(err: string | null) {
      if (!err && confirmed.current < version.current && !dirty.current && (saved.current || hasContent(workRef.current))) {
        setSave("saving");
        persist("draft").then(settle);
        return;
      }
      setSave(err ? "error" : confirmed.current >= version.current ? "saved" : "saving");
    },
    [persist],
  );

  // Moving to another step is saved too (once the draft exists), so it reopens at that step. Opening a draft
  // isn't a change: nothing is written until something actually changes.
  const lastStep = useRef(step);
  useEffect(() => {
    if (step === lastStep.current) return;
    lastStep.current = step;
    version.current++;
    if (saved.current && viewer && !published) persist("draft").then(settle);
  }, [step, viewer, published, persist, settle]);

  // Until the latest change is confirmed saved, leaving the page asks first (a refresh would lose it).
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (unsaved()) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const edit = (fn: (w: Work) => Work) => {
    setWork(fn);
    version.current++;
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
      // Nothing typed yet: no draft. (A draft that exists keeps saving, even emptied, so it matches the screen.)
      if (!hasContent(workRef.current) && !saved.current) {
        dirty.current = false;
        return setSave("idle");
      }
      dirty.current = false;
      settle(await persist("draft"));
    }, 1200);
    return () => clearTimeout(t);
  }, [work, viewer, persist, published, settle]);

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

  function addLine(secId: string, afterId: string | null, format: ListFormat, atStart = false) {
    if (lineCount(prune(work, null)) >= MAX_ITEMS) return toast(FULL_ITEMS);
    const l = newLine(format);
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
   * A choice from the toolbar. On a selected pick, Numbered or Bulleted changes its format, and Section turns an
   * empty pick into a section title or starts a new section after it; on a selected section title it adds a pick
   * of that format under it, or a new section after it.
   */
  function pick(type: Pick) {
    const w = work;
    const newSection = type === "section";
    if (newSection && headedCount(w) >= MAX_SECTIONS) return toast(FULL_SECTIONS);
    const line = selLine;
    if (line) {
      if (newSection) return goSection(...splitSection(w, line.id, "", isEmpty(line)));
      focusId.current = line.id;
      if (line.format === type) return;
      const si = w.sections.findIndex((x) => x.lines.some((l) => l.id === line.id));
      const li = w.sections[si].lines.findIndex((l) => l.id === line.id);
      const mid = mapLineIn(w, line.id, (x) => ({ ...x, format: type }));
      const [next, n] = reflow(mid, si, li, type);
      edit(() => next);
      return reflowToast(mid, n, type, line.id);
    }
    if (sel?.kind === "sec") {
      if (newSection) {
        const i = w.sections.findIndex((x) => x.id === sel.id);
        const sid = uid();
        const secs = [...w.sections];
        secs.splice(i + 1, 0, { id: sid, headed: true, label: "", lines: [] });
        return goSection({ ...w, sections: secs }, sid);
      }
      return addLine(sel.id, null, type, true);
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
   * Starting a numbered or bulleted pick right after a list of the other kind switches that list over, so a list
   * doesn't mix numbers and bullets. Returns the stack and how many picks changed.
   */
  function reflow(w: Work, si: number, end: number, type: ListFormat): [Work, number] {
    const lines = [...w.sections[si].lines];
    let n = 0;
    for (let j = end - 1; j >= 0; j--) {
      if (lines[j].format !== type) {
        lines[j] = { ...lines[j], format: type };
        n++;
      }
    }
    return n ? [{ ...w, sections: w.sections.map((x, i) => (i === si ? { ...x, lines } : x)) }, n] : [w, 0];
  }

  /** Says the picks above were switched, with Undo to put them back. */
  function reflowToast(before: Work, n: number, type: ListFormat, focus: string | null) {
    if (!n) return;
    toast(`Switched ${n} ${n === 1 ? "item" : "items"} above to ${type === "num" ? "numbered" : "bullets"}`, {
      label: "Undo",
      run: () => {
        if (focus) focusId.current = focus;
        edit(() => before);
      },
    });
  }

  /** Done on a pick: leaves it (an empty pick goes away). */
  function doneLine(l: Line) {
    finishLinks(l.id);
    select(null);
    if (isEmpty(l)) setWork((w) => prune(w, null));
  }

  /** Return on a pick: the next pick starts, in the same format. On an empty pick it leaves it instead. */
  function enterLine(secId: string, l: Line) {
    finishLinks(l.id);
    if (isEmpty(l)) {
      (document.activeElement as HTMLElement | null)?.blur?.();
      return select(null);
    }
    addLine(secId, l.id, l.format);
  }

  /**
   * A pick's heading or subheading changed (`field`): full web addresses written into it become its links. `done`
   * takes one at the very end too (pasted, or the field is being left). Past 2 links, it says why.
   */
  function writeText(id: string, field: "text" | "sub", value: string, done: boolean) {
    const v = oneLine(value);
    const l = work.sections.flatMap((sec) => sec.lines).find((x) => x.id === id);
    if (!l) return;
    const r = takeLinks(v, l.links, done);
    // Say so once per address: when it's first refused, not on every keystroke after it.
    const before = takeLinks(l[field], l.links, false).refused;
    if (r.refused.some((u) => !before.includes(u))) toast(FULL_LINKS);
    mapLine(id, (x) => ({ ...x, [field]: r.text, links: r.links }));
  }

  /** Leaving a pick's text: any full web address still at the end of it becomes a link. */
  function finishLinks(id: string) {
    const l = work.sections.flatMap((sec) => sec.lines).find((x) => x.id === id);
    if (!l) return;
    const a = takeLinks(l.text, l.links, true);
    const b = takeLinks(l.sub, a.links, true);
    if (a.text === l.text && b.text === l.sub) return;
    mapLine(id, (x) => ({ ...x, text: a.text, sub: b.text, links: b.links }));
  }

  /** Add item: a new pick at the end, in the format of the one above it. */
  function addItem() {
    const last = work.sections[work.sections.length - 1];
    const prev = work.sections.flatMap((sec) => sec.lines).at(-1);
    addLine(last.id, null, prev?.format ?? "num");
  }

  /** Edit opens the Reorder / Delete menu (it needs something to edit); Done leaves edit mode. */
  function toggleArrange() {
    if (arranging) return setArranging(false);
    if (!work.sections.some((sec) => sec.headed || sec.lines.some((l) => !isEmpty(l)))) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    setWork((w) => prune(w, null));
    setSel(null);
    setEditMenu((m) => !m);
  }

  /** Enters edit mode for moving or for deleting; it leaves the line being written. */
  function pickEditMode(mode: "reorder" | "delete") {
    (document.activeElement as HTMLElement | null)?.blur?.();
    setWork((w) => prune(w, null));
    setSel(null);
    setEditMenu(false);
    setEditMode(mode);
    setArranging(true);
  }

  /** The format of the last pick before this section, for its first pick (numbered if there's none). */
  const prevFormat = (sec: Sec): ListFormat => {
    const i = work.sections.findIndex((x) => x.id === sec.id);
    return work.sections.slice(0, i).flatMap((x) => x.lines).at(-1)?.format ?? "num";
  };

  /** Done on a heading: a new section gets its first line; one that has lines is just left. */
  function doneSec(sec: Sec) {
    const first = sec.lines[0];
    if (first && isEmpty(first)) return select({ kind: "line", id: first.id });
    if (first) return select(null);
    addLine(sec.id, null, prevFormat(sec), true);
  }

  /** Return on a heading: a new line right under it (continuing the list below, if there is one). */
  function enterSec(sec: Sec) {
    const first = sec.lines[0];
    if (first && isEmpty(first)) return select({ kind: "line", id: first.id });
    addLine(sec.id, null, first?.format ?? prevFormat(sec), true);
  }

  /**
   * Moves a line one place up or down. At the edge of a section it crosses the heading into the next section;
   * the stack's first line can also move up above the first heading.
   */
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
      else if (dir < 0 && secs[0].headed) secs.unshift({ id: uid(), headed: false, label: "", lines: cur.splice(i, 1) });
      else if (dir > 0 && si < secs.length - 1) secs[si + 1].lines.unshift(...cur.splice(i, 1));
      return { ...w, sections: secs };
    });
  }

  /** Deletes a line, with Undo. */
  function deleteLine(id: string) {
    const si = work.sections.findIndex((sec) => sec.lines.some((l) => l.id === id));
    if (si < 0) return;
    const sec = work.sections[si];
    const i = sec.lines.findIndex((l) => l.id === id);
    const line = sec.lines[i];
    const at = { secId: sec.id, si, prevId: sec.lines[i - 1]?.id ?? null, nextId: sec.lines[i + 1]?.id ?? null };
    edit((w) => ({ ...w, sections: w.sections.map((x) => ({ ...x, lines: x.lines.filter((l) => l.id !== id) })) }));
    setSel(null);
    toast("Item deleted", { label: "Undo", run: () => edit((w) => restoreLine(w, line, at)) });
    if (tagFor === id) setTagFor(null);
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
    const si = work.sections.findIndex((x) => x.id === id);
    if (si < 0) return;
    const head = { id, label: work.sections[si].label };
    const lineIds = work.sections[si].lines.map((l) => l.id);
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
    toast("Section header removed", { label: "Undo", run: () => edit((w) => restoreHeading(w, head, lineIds, si)) });
  }

  /** Opens the link sheet to edit one of a pick's links (`index`), or to add one (up to 2). */
  function openLinkSheet(lineId: string, index: number | null = null) {
    const l = work.sections.flatMap((sec) => sec.lines).find((x) => x.id === lineId);
    if (!l) return;
    if (index === null && l.links.length >= MAX_LINKS) return toast(FULL_LINKS);
    const reselect = sel?.kind === "line" && sel.id === lineId;
    const k = index === null ? null : l.links[index];
    focusId.current = k ? "ls-name" : "ls-url";
    setLinkSheet({ lineId, index: k ? index : null, url: k?.url ?? "", name: k?.name ?? "", reselect });
  }

  function closeLinkSheet() {
    if (linkSheet?.reselect) focusId.current = linkSheet.lineId;
    setLinkSheet(null);
  }

  function submitLinkSheet() {
    const ls = linkSheet;
    if (!ls) return;
    const name = oneLine(ls.name).trim().slice(0, MAX_LINK_NAME);
    const v = ls.url.trim();
    if (!v) return ls.index !== null ? removeLink() : closeLinkSheet();
    const url = /^https?:\/\//i.test(v) ? v : `https://${v}`;
    // Something that isn't a link stays in the field, so it can be fixed.
    if (!/^https?:\/\/[^\s.]+\.\S+$/i.test(url) || url.length > 2048) return toast("That doesn't look like a link.");
    const l = work.sections.flatMap((sec) => sec.lines).find((x) => x.id === ls.lineId);
    if (l?.links.some((k, i) => k.url === url && i !== ls.index)) return toast("This item already has that link.");
    mapLine(ls.lineId, (x) => ({
      ...x,
      links: ls.index === null ? [...x.links, { url, name }].slice(0, MAX_LINKS) : x.links.map((k, i) => (i === ls.index ? { url, name } : k)),
    }));
    closeLinkSheet();
  }

  function removeLink() {
    if (!linkSheet) return;
    const i = linkSheet.index;
    mapLine(linkSheet.lineId, (l) => ({ ...l, links: l.links.filter((_, k) => k !== i) }));
    closeLinkSheet();
  }

  /** Opens the tags tray for a pick. */
  function openTags(lineId: string) {
    setOwnTag("");
    setTagFor(lineId);
  }

  /**
   * Adds a tag to the tray's pick, or removes it when it's already there. A pick has up to 3 tags and one price:
   * choosing another price swaps it in.
   */
  function toggleTag(tag: string) {
    const id = tagFor;
    const l = id && work.sections.flatMap((sec) => sec.lines).find((x) => x.id === id);
    if (!l) return;
    const t = tag.trim();
    const has = l.tags.find((x) => x.toLowerCase() === t.toLowerCase());
    if (has) return mapLine(l.id, (x) => ({ ...x, tags: x.tags.filter((y) => y !== has) }));
    const price = PRICE_TAGS.includes(t) ? l.tags.find((x) => PRICE_TAGS.includes(x)) : undefined;
    if (!price && l.tags.length >= MAX_TAGS) return;
    mapLine(l.id, (x) => ({ ...x, tags: price ? x.tags.map((y) => (y === price ? t : y)) : [...x.tags, t] }));
  }

  /** Adds the typed tag (up to 20 characters); a suggested one typed by hand takes its usual spelling. */
  function addOwnTag() {
    const t = oneLine(ownTag).trim();
    if (!t || t.length > MAX_TAG) return;
    toggleTag(tagInfo(t).name);
    setOwnTag("");
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
    dirty.current = false;
    setSave("saving");
    const err = await persist("draft");
    settle(err);
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
    // Nothing in it: leave without a draft (removing the one saved earlier, if any).
    if (!hasContent(work)) {
      dirty.current = false;
      if (saved.current) queue.current.then(() => createClient().from("drafts").delete().eq("id", idRef.current));
      return router.push("/");
    }
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
    if (!counts(w).n) return toast("Add an item to publish.");
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
    if (!counts(work).n) return toast("Add an item to publish.");
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
    const id = idRef.current;
    // Published: nothing is left unsaved.
    confirmed.current = version.current;
    setPublished(id);
    // The draft is gone now; the address becomes the stack's, so a refresh opens it. (No router.refresh() here:
    // it would reset the address to the editor's old one, /new or the deleted draft's, and a reload of that, say
    // when coming back to the app, would show "Nothing here".)
    window.history.replaceState(window.history.state, "", `/s/${id}`);
    if (id) setPublishedStack(await fetchStack(createClient(), viewer?.id ?? null, id));
  }

  function publish() {
    if (!counts(work).n) return toast("Add an item to publish.");
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
  const countLabel = n === 0 ? "No items yet" : `${n} ${n === 1 ? "item" : "items"}${k ? ` · ${k} ${k === 1 ? "link" : "links"}` : ""}`;
  const shownTitle = work.title.trim() || "Untitled Stack";

  if (published) {
    return (
      <main className={`${shell.screen} ${s.done}`}>
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
          <button
            className={s.primary}
            onClick={() => {
              if (publishedVis === "private") vis.open({ id: published, title: shownTitle, visibility: publishedVis }, "This stack is private. Make it public or invite only to share it.");
              else if (publishedStack) setShareSheet(true);
              else share(published);
            }}
          >
            Share your Stack
          </button>
          {/* Replace, so leaving the stack page doesn't land back in the finished create flow. */}
          <Link href={`/s/${published}?from=create`} replace className={s.secondary}>
            View your Stack
          </Link>
          <button className={s.quiet} onClick={() => router.replace("/profile")}>
            Exit
          </button>
        </div>
        {shareSheet && publishedStack && <ShareSheet stack={publishedStack} onClose={() => setShareSheet(false)} />}
        {vis.sheet}
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

  const header = (
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
          {(
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
  // The toolbar marks the format in use: the selected pick's, or Section for a section title.
  const curFormat: Pick | null = selLine ? selLine.format : sel?.kind === "sec" ? "section" : null;
  // Keeps focus in the text while tapping the toolbar and line tools.
  const keep = (e: React.MouseEvent) => e.preventDefault();
  // While writing, the footer steps aside and the page gets room to scroll the line up above the keyboard.
  const writing = step === "build" && !!sel && !arranging;
  const canArrange = arranging || work.sections.some((sec) => sec.headed || sec.lines.some((l) => !isEmpty(l)));
  const fullSections = headedCount(work) >= MAX_SECTIONS;
  const fullItems = lineCount(prune(work, null)) >= MAX_ITEMS;
  const titleCount = counter("", work.title.trim().length, MAX_TITLE);
  const descCount = counter("", work.description.trim().length, MAX_DESCRIPTION);
  const tagLine = tagFor ? (work.sections.flatMap((sec) => sec.lines).find((l) => l.id === tagFor) ?? null) : null;
  const fin = finalChoices(work);
  const cityCount = counter("", work.location.trim().length, MAX_CITY);
  const pickTheme = (emoji: string, color: string) => edit((w) => ({ ...w, theme: { emoji, color } }));
  function toggleCategory(name: string) {
    edit((w) =>
      w.categories.includes(name)
        ? { ...w, categories: w.categories.filter((c) => c !== name) }
        : w.categories.length >= MAX_CATEGORIES
          ? w
          : { ...w, categories: [...w.categories, name] },
    );
  }

  const toolbar = toolsHidden ? null : (
    <div className={s.toolbar} data-list={!!selLine || undefined} onMouseDown={keep}>
      <div className={s.toolbarRow} role="toolbar" aria-label="Format">
        {FORMATS.map(([type, label, icon]) => (
          <button
            key={type}
            className={s.tool}
            data-on={type === curFormat || undefined}
            aria-disabled={(type === "section" && fullSections) || undefined}
            title={type === "section" && fullSections ? FULL_SECTIONS : undefined}
            onMouseDown={keep}
            onClick={() => pick(type)}
          >
            {icon}
            <span className={s.toolLabel}>{label}</span>
          </button>
        ))}
        <span className={s.toolDivider} />
        <button className={s.tool} disabled={!selLine} onMouseDown={keep} onClick={() => selLine && openLinkSheet(selLine.id)}>
          {linkIcon(16)}
          <span className={s.toolLabel}>Link</span>
        </button>
        <button className={s.tool} data-on={(!!selLine && tagFor === selLine.id) || undefined} disabled={!selLine} onMouseDown={keep} onClick={() => selLine && openTags(selLine.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9z" />
            <circle cx="8.5" cy="8.5" r="1.6" />
          </svg>
          <span className={s.toolLabel}>{selLine?.tags.length ? `Tags · ${selLine.tags.length}` : "Tags"}</span>
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
    ) : (
      <span className={s.bullet} aria-hidden>
        <span />
      </span>
    );

  return (
    <main className={shell.screen}>
      {header}

      {step !== "review" && (
        <>
          <div className={s.scroll} data-writing={writing || undefined}>
            <div className={s.composeSpacer} style={{ height: step === "title" ? 150 : step === "description" ? 72 : 6 }} />
            {step === "title" && <div className={s.ask}>What would you like to call this Stack?</div>}
            <textarea
              data-fid="title"
              className={s.titleInput}
              data-active={step === "title" || undefined}
              rows={1}
              value={work.title}
              onChange={(e) => {
                const v = oneLine(e.target.value);
                edit((w) => ({ ...w, title: v }));
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
            {titleCount.text && step !== "title" && (
              <div className={s.fieldCount} data-full={titleCount.full || undefined}>
                {titleCount.text}
              </div>
            )}
            {step === "title" && (
              <div className={s.composeActions}>
                <span className={s.composeHint} data-full={titleCount.full || undefined}>
                  {titleCount.text || "Press return to continue"}
                </span>
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
                    const v = oneLine(e.target.value);
                    edit((w) => ({ ...w, description: v }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
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
                {step === "build" && descCount.text && (
                  <div className={s.fieldCount} data-full={descCount.full || undefined}>
                    {descCount.text}
                  </div>
                )}
                {step === "description" && (
                  <div className={s.composeActions}>
                    <span className={s.composeHint} data-full={descCount.full || undefined}>
                      {work.description.trim().length}/{MAX_DESCRIPTION}
                      {descCount.full ? ` · ${work.description.trim().length - MAX_DESCRIPTION} over` : ""}
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
                    <strong>
                      {save === "error"
                        ? "Fix these before publishing. Your latest changes aren’t saved: check your connection."
                        : save === "saving"
                          ? "Fix these before publishing. Saving your draft…"
                          : save === "saved"
                            ? "Fix these before publishing. Your draft is saved."
                            : "Fix these before publishing."}
                    </strong>
                    <ul>
                      {problems.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {canArrange ? (
                  <div className={s.arrangeRow}>
                    {editMenu && !arranging && (
                      <>
                        <div className={s.editMenuScrim} onClick={() => setEditMenu(false)} aria-hidden />
                        <div className={s.editMenu} role="menu" aria-label="Edit">
                          <button role="menuitem" className={s.editMenuItem} onMouseDown={keep} onClick={() => pickEditMode("reorder")}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="oklch(30% 0.006 80)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M8 9.5l4-4 4 4" />
                              <path d="M8 14.5l4 4 4-4" />
                            </svg>
                            Reorder
                          </button>
                          <button role="menuitem" className={`${s.editMenuItem} ${s.editMenuDanger}`} onMouseDown={keep} onClick={() => pickEditMode("delete")}>
                            {trashIcon("oklch(48% 0.16 30)")}
                            Delete
                          </button>
                        </div>
                      </>
                    )}
                    <button className={s.arrangeBtn} data-on={arranging || undefined} onMouseDown={keep} onClick={toggleArrange} aria-haspopup={arranging ? undefined : "menu"} aria-expanded={arranging ? undefined : editMenu}>
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
                                  const v = oneLine(e.target.value);
                                  edit((w) => ({ ...w, sections: w.sections.map((x) => (x.id === sec.id ? { ...x, label: v } : x)) }));
                                }}
                                onFocus={() => !arranging && !secSel && select({ kind: "sec", id: sec.id })}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    enterSec(sec);
                                  }
                                }}
                                placeholder="Section title"
                                aria-label="Section title"
                              />
                              {secSel && (
                                <button className={s.headDelete} onMouseDown={keep} onClick={() => removeSection(sec.id)} aria-label="Remove heading">
                                  {trashIcon("oklch(48% 0.16 30)")}
                                </button>
                              )}
                              {arranging && editMode === "delete" && (
                                <span className={s.moveBtns}>
                                  <button className={s.moveBtn} onMouseDown={keep} onClick={() => removeSection(sec.id)} aria-label="Remove heading">
                                    {trashIcon("oklch(48% 0.16 30)")}
                                  </button>
                                </span>
                              )}
                              {arranging && editMode === "reorder" && (
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
                            {(() => {
                              const c = counter("title", sec.label.trim().length, MAX_LABEL);
                              return c.text ? (
                                <div className={s.fieldCount} data-full={c.full || undefined}>
                                  {c.text}
                                </div>
                              ) : null;
                            })()}
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
                        const isSel = !arranging && sel?.kind === "line" && sel.id === l.id;
                        const lastInSec = l.id === sec.lines[sec.lines.length - 1].id;
                        if (!isSel) {
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
                                <div className={s.head} data-empty={!l.text.trim() || undefined}>
                                  {l.text.trim() || (isEmpty(l) ? "Empty item \u2014 tap to write" : "Add a heading")}
                                </div>
                                {l.sub.trim() && <div className={s.subView}>{l.sub}</div>}
                                <TagChips tags={l.tags} className={s.tagRow} chipClass={s.tagChip} />
                                {l.links.length > 0 && (
                                  <div className={s.pills}>
                                    {l.links.map((k, i) => (
                                      <span
                                        key={k.url}
                                        className={s.visit}
                                        role={arranging ? undefined : "button"}
                                        onClick={(e) => {
                                          if (arranging) return;
                                          e.stopPropagation();
                                          openLinkSheet(l.id, i);
                                        }}
                                      >
                                        {linkIcon(11)}
                                        {linkLabel(k)}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>
                              {arranging && editMode === "delete" && (
                                <span className={s.moveBtns}>
                                  <button className={s.moveBtn} onClick={() => deleteLine(l.id)} aria-label="Delete item">
                                    {trashIcon("oklch(48% 0.16 30)")}
                                  </button>
                                </span>
                              )}
                              {arranging && editMode === "reorder" && (
                                <span className={s.moveBtns}>
                                  <button className={s.moveBtn} onClick={() => moveLine(l.id, -1)} disabled={l.id === allIds[0] && !sec.headed} aria-label="Move item up">
                                    {arrow("up")}
                                  </button>
                                  <button className={s.moveBtn} onClick={() => moveLine(l.id, 1)} disabled={l.id === allIds[allIds.length - 1]} aria-label="Move item down">
                                    {arrow("down")}
                                  </button>
                                </span>
                              )}
                            </div>
                          );
                        }
                        const hc = counter("heading", l.text.trim().length, MAX_HEADING);
                        const sc = counter("subheading", l.sub.trim().length, MAX_SUBHEADING);
                        const enter = (e: React.KeyboardEvent) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          enterLine(sec.id, l);
                        };
                        return (
                          <div key={l.id} className={s.lineEdit} data-line-box>
                            <button className={s.lineDelete} onMouseDown={keep} onClick={() => deleteLine(l.id)} aria-label="Delete item">
                              {trashIcon("var(--muted-66)")}
                            </button>
                            <div className={s.lineEditRow}>
                              {marker(l, n2)}
                              <div className={s.lineInputs}>
                                <textarea
                                  data-fid={l.id}
                                  className={s.lineInput}
                                  rows={1}
                                  value={l.text}
                                  onChange={(e) => writeText(l.id, "text", e.target.value, (e.nativeEvent as InputEvent).inputType === "insertFromPaste")}
                                  onBlur={() => finishLinks(l.id)}
                                  onKeyDown={enter}
                                  placeholder="Item heading"
                                  aria-label="Item heading"
                                />
                                <textarea
                                  data-fid={`${l.id}-sub`}
                                  className={s.subInput}
                                  rows={1}
                                  value={l.sub}
                                  onChange={(e) => writeText(l.id, "sub", e.target.value, (e.nativeEvent as InputEvent).inputType === "insertFromPaste")}
                                  onBlur={() => finishLinks(l.id)}
                                  onKeyDown={enter}
                                  placeholder="Subheading (optional): a short reason or detail"
                                  aria-label="Item subheading"
                                />
                                <TagChips tags={l.tags} className={s.tagRow} chipClass={s.tagChip} />
                              </div>
                            </div>
                            <div className={s.lineTools} data-list>
                              {l.links.length > 0 && (
                                <div className={s.pills}>
                                  {l.links.map((k, i) => (
                                    <button key={k.url} className={s.visit} onMouseDown={keep} onClick={() => openLinkSheet(l.id, i)} aria-label={`Edit link ${linkLabel(k)}`}>
                                      {linkIcon(11)}
                                      {linkLabel(k)}
                                    </button>
                                  ))}
                                </div>
                              )}
                              <div className={s.toolRow}>
                                {toolsHidden && (
                                  <button className={s.showTools} onMouseDown={keep} onClick={() => setToolsHidden(false)}>
                                    {arrow("up")}
                                    Formatting
                                  </button>
                                )}
                                <span className={s.charCount} data-full={hc.full || sc.full || undefined}>
                                  {[hc.text, sc.text].filter(Boolean).join(" \u00b7 ")}
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
                  <button className={s.addItem} aria-disabled={fullItems || undefined} onClick={() => (fullItems ? toast(FULL_ITEMS) : addItem())}>
                    <span className={s.addItemIcon}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                        <path d="M12 5v14M5 12h14" />
                      </svg>
                    </span>
                    {fullItems ? FULL_ITEMS : "Add item"}
                  </button>
                )}
              </div>
            )}
          </div>
          {step === "build" &&
            !writing &&
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
                  aria-disabled={!n}
                  onClick={() => {
                    if (!n) return toast("Add an item first.");
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

      {step === "review" && (
        <>
          <div className={s.scroll} style={{ paddingTop: 10 }}>
            <h1 className={s.finalHeading}>Finalize</h1>
            <div className={s.modeSwitch} role="tablist" aria-label="Finalize">
              <button role="tab" aria-selected={!preview} className={s.modeTab} data-on={!preview || undefined} onClick={() => setPreview(false)}>
                Arrange
              </button>
              <button role="tab" aria-selected={preview} className={s.modeTab} data-on={preview || undefined} onClick={() => setPreview(true)}>
                Preview
              </button>
            </div>

            {preview ? (
              <div className={s.pvWrap}>
                <div className={s.pvBand} style={{ background: fin.color }}>
                  <div className={s.pvWall} aria-hidden>
                    {Array(60).fill(fin.emoji).join(" ")}
                  </div>
                  <span className={s.pvEmoji} aria-hidden>
                    {fin.emoji}
                  </span>
                  <span className={s.pvBadge}>
                    {n} {n === 1 ? "pick" : "picks"}
                  </span>
                </div>
                <StackPaper
                  updated={`Updated ${new Date().toLocaleString("en-US", { month: "short", year: "numeric" })}`}
                  author={
                    <div className={s.pvAuthor}>
                      <span className={s.pvAvatar}>{initials(viewer.name)}</span>
                      <span className={s.pvName}>{viewer.name}</span>
                      <span className={s.pvHandle}>@{viewer.handle}</span>
                    </div>
                  }
                  banner={
                    fin.isPlace && fin.city ? (
                      <div className={s.pvCity}>📍 {fin.city}</div>
                    ) : undefined
                  }
                  title={shownTitle}
                  description={work.description.trim()}
                  lines={work.sections.flatMap((sec) =>
                    sec.lines
                      .filter((l) => !isEmpty(l))
                      .map((l, i) => ({
                        num: l.format === "num" ? String(++pn).padStart(2, "0") : "•",
                        label: i === 0 && sec.headed && sec.label.trim() ? sec.label : null,
                        head: l.text.trim(),
                        note: l.sub.trim(),
                        link: l.links[0]?.url ?? null,
                        linkLabel: l.links[0] ? linkLabel(l.links[0]) : "",
                        links: l.links.slice(1).map((k) => ({ href: k.url, label: linkLabel(k) })),
                        plain: true,
                        format: l.format,
                        tags: l.tags,
                      })),
                  )}
                />
                {work.categories.length > 0 && (
                  <div className={s.pvCats}>
                    {work.categories.map((c) => (
                      <span key={c} className={s.catChip} data-on style={{ background: CATEGORIES.find((x) => x.name === c)?.color }}>
                        {c}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                <section className={s.card} aria-labelledby="theme-title">
                  <div className={s.themeRow}>
                    <span className={s.themeSwatch} style={{ background: fin.color }} aria-hidden>
                      {fin.emoji}
                    </span>
                    <span>
                      <span id="theme-title" className={s.cardLabel}>
                        Theme
                      </span>
                      <span className={s.themeHint}>{work.theme ? "You picked this theme." : "Suggested from your title. Tap to change."}</span>
                    </span>
                  </div>
                  <div className={s.emojiGrid}>
                    {THEME_EMOJIS.map((e) => (
                      <button key={e} className={s.emojiBtn} aria-pressed={e === fin.emoji} aria-label={`Theme emoji ${e}`} onClick={() => pickTheme(e, fin.color)}>
                        {e}
                      </button>
                    ))}
                  </div>
                  <div className={s.colorRow}>
                    {THEME_COLORS.map((c, i) => (
                      <button key={c} className={s.colorBtn} style={{ background: c }} aria-pressed={c === fin.color} aria-label={`Theme colour ${i + 1}`} onClick={() => pickTheme(fin.emoji, c)} />
                    ))}
                  </div>
                </section>

                <section className={s.card} style={{ marginTop: 14 }} aria-labelledby="place-title">
                  <div id="place-title" className={s.placeTitle}>
                    Is this about a place?
                  </div>
                  <div className={s.yesNo} role="radiogroup" aria-labelledby="place-title">
                    {([true, false] as const).map((v) => (
                      <button key={String(v)} role="radio" aria-checked={fin.isPlace === v} className={s.yesNoBtn} data-on={fin.isPlace === v || undefined} onClick={() => edit((w) => ({ ...w, isPlace: v }))}>
                        {v ? "Yes" : "No"}
                      </button>
                    ))}
                  </div>
                  {fin.isPlace ? (
                    <>
                      <label className={s.placeField}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
                          <circle cx="12" cy="10" r="2.4" />
                        </svg>
                        <input
                          className={s.placeInput}
                          value={work.location}
                          onChange={(e) => {
                            const v = oneLine(e.target.value);
                            edit((w) => ({ ...w, location: v }));
                          }}
                          placeholder="e.g. Mexico City, or Brooklyn, NY"
                          aria-label="City"
                        />
                      </label>
                      <div className={s.placeHelp}>
                        A city is required for place stacks.
                        {cityCount.text && (
                          <span className={s.fieldCount} data-full={cityCount.full || undefined} style={{ marginLeft: 8 }}>
                            {cityCount.text}
                          </span>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className={s.placeHelp}>Not about a place. No city needed.</div>
                  )}
                </section>

                <section className={s.card} style={{ marginTop: 14, paddingBottom: 8 }} aria-labelledby="privacy-title">
                  <div id="privacy-title" className={s.cardLabel}>
                    Who can see this stack
                  </div>
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
                </section>

                <section className={s.card} style={{ marginTop: 14 }} aria-labelledby="cats-title">
                  <div id="cats-title" className={s.cardLabel}>
                    Categories
                  </div>
                  <div className={s.placeHelp}>
                    {work.categories.length >= MAX_CATEGORIES ? "You picked 2. Tap one to remove it, then pick another." : "Pick 1 or 2. They help people find your Stack in Explore and search."}
                  </div>
                  <div className={s.catGrid}>
                    {CATEGORIES.map((c) => {
                      const on = work.categories.includes(c.name);
                      const off = !on && work.categories.length >= MAX_CATEGORIES;
                      return (
                        <button
                          key={c.name}
                          className={s.catChip}
                          data-on={on || undefined}
                          style={on ? { background: c.color } : undefined}
                          aria-pressed={on}
                          aria-disabled={off || undefined}
                          onClick={() => !off && toggleCategory(c.name)}
                        >
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </section>

                <section className={s.card} style={{ marginTop: 14 }} aria-labelledby="order-title">
                  <div id="order-title" className={s.cardLabel}>
                    Order
                  </div>
                  <div className={s.placeHelp}>Move sections and picks up or down.</div>
                  {(() => {
                    let k = 0;
                    const ids = work.sections.flatMap((sec) => sec.lines.filter((l) => !isEmpty(l)).map((l) => l.id));
                    return work.sections.map((sec, si) => (
                      <div key={sec.id}>
                        {sec.headed && (
                          <div className={s.orderRow} data-section>
                            <span className={s.orderText}>{sec.label.trim() || "Untitled section"}</span>
                            <span className={s.moveBtns}>
                              <button className={s.moveBtn} onClick={() => moveHeading(sec.id, -1)} disabled={si === 0} aria-label={`Move section ${sec.label.trim() || si + 1} up`}>
                                {arrow("up")}
                              </button>
                              <button
                                className={s.moveBtn}
                                onClick={() => moveHeading(sec.id, 1)}
                                disabled={!sec.lines.length && si === work.sections.length - 1}
                                aria-label={`Move section ${sec.label.trim() || si + 1} down`}
                              >
                                {arrow("down")}
                              </button>
                            </span>
                          </div>
                        )}
                        {sec.lines
                          .filter((l) => !isEmpty(l))
                          .map((l) => {
                            const label = l.format === "num" ? String(++k).padStart(2, "0") : "•";
                            return (
                              <div key={l.id} className={s.orderRow}>
                                <span className={s.orderNum}>{label}</span>
                                <span className={s.orderText}>{l.text.trim() || "Untitled item"}</span>
                                <span className={s.moveBtns}>
                                  <button className={s.moveBtn} onClick={() => moveLine(l.id, -1)} disabled={l.id === ids[0] && !sec.headed} aria-label={`Move ${l.text.trim() || "item"} up`}>
                                    {arrow("up")}
                                  </button>
                                  <button className={s.moveBtn} onClick={() => moveLine(l.id, 1)} disabled={l.id === ids[ids.length - 1]} aria-label={`Move ${l.text.trim() || "item"} down`}>
                                    {arrow("down")}
                                  </button>
                                </span>
                              </div>
                            );
                          })}
                      </div>
                    ));
                  })()}
                </section>
                {!n && <div className={s.cantPublish}>Add an item to publish.</div>}
              </>
            )}
          </div>
          <footer className={s.footer}>
            <button
              className={s.back}
              onClick={() => {
                setPreview(false);
                setStep("build");
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14.5 5.5L8 12l6.5 6.5" />
              </svg>
              Back to Build
            </button>
            <button className={s.primary} style={{ flex: 1 }} aria-disabled={!n} disabled={busy} onClick={publish}>
              {busy ? "Publishing…" : "Publish"}
            </button>
          </footer>
        </>
      )}

      {linkSheet && (
        <div className={s.scrim} data-light onMouseDown={closeLinkSheet}>
          <div className={s.sheet} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="link-title">
            <div className={s.grabber} />
            <div className={s.lsHead}>
              <span id="link-title" className={s.sheetTitle}>
                {linkSheet.index === null ? "Add link" : "Edit link"}
              </span>
              {linkSheet.index !== null && (
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
              type="url"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              value={linkSheet.url}
              onChange={(e) => {
                const v = oneLine(e.target.value).slice(0, 2048);
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
              <button className={s.lsSubmit} aria-disabled={!(linkSheet.url.trim() || linkSheet.index !== null) || undefined} onClick={submitLinkSheet}>
                {linkSheet.index === null ? "Add" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {tagLine && (
        <div className={s.scrim} data-light onMouseDown={() => setTagFor(null)}>
          <div className={s.sheet} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="tags-title">
            <div className={s.grabber} />
            <div className={s.lsHead}>
              <span id="tags-title" className={s.sheetTitle}>
                Tags
              </span>
              <span className={s.tagsFor}>{tagLine.text.trim() || "This item"}</span>
            </div>
            {(() => {
              const full = tagLine.tags.length >= MAX_TAGS;
              const has = (t: string) => tagLine.tags.some((x) => x.toLowerCase() === t.toLowerCase());
              const price = tagLine.tags.find((x) => PRICE_TAGS.includes(x));
              const own = oneLine(ownTag).trim();
              const ownOver = own.length - MAX_TAG;
              return (
                <>
                  <div className={s.tagsChosen}>
                    {tagLine.tags.length ? (
                      <>
                        {tagLine.tags.map((t) => (
                          <button key={t} className={s.tagChip} data-group={tagInfo(t).group || "own"} data-on onClick={() => toggleTag(t)} aria-label={`Remove tag ${t}`}>
                            {tagInfo(t).emoji && <span aria-hidden>{tagInfo(t).emoji} </span>}
                            {tagInfo(t).name} ✕
                          </button>
                        ))}
                        <span className={s.tagsHint}>{full ? `This item has ${MAX_TAGS} tags. Remove one to add another.` : "Tap a tag to remove it."}</span>
                      </>
                    ) : (
                      <span className={s.tagsHint}>Up to {MAX_TAGS} tags: quick details like price or when to go.</span>
                    )}
                  </div>
                  {TAG_GROUPS.map((g) => (
                    <div key={g.key} className={s.tagGroup}>
                      <div className={s.tagGroupName}>{g.name}</div>
                      <div className={s.tagRow}>
                        {g.tags.map(([t, emoji]) => {
                          const on = has(t);
                          // A price can swap for another price even at 3 tags.
                          const off = !on && full && !(g.key === "price" && price);
                          return (
                            <button key={t} className={s.tagChip} data-group={g.key} data-on={on || undefined} aria-pressed={on} aria-disabled={off || undefined} onClick={() => !off && toggleTag(t)}>
                              {emoji && <span aria-hidden>{emoji} </span>}
                              {t}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  <label className={s.lsLabel} htmlFor="own-tag">
                    Your own
                  </label>
                  <div className={s.ownTagRow}>
                    <input
                      id="own-tag"
                      className={s.lsInput}
                      value={ownTag}
                      disabled={full}
                      onChange={(e) => setOwnTag(oneLine(e.target.value))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addOwnTag();
                        }
                        if (e.key === "Escape") setTagFor(null);
                      }}
                      placeholder={full ? `This item has ${MAX_TAGS} tags.` : "e.g. Outdoor seating"}
                    />
                    <button className={s.lsSubmit} aria-disabled={!own || ownOver > 0 || full || undefined} onClick={addOwnTag}>
                      Add
                    </button>
                  </div>
                  {own && (
                    <div className={s.fieldCount} data-full={ownOver > 0 || undefined}>
                      {own.length}/{MAX_TAG}
                      {ownOver > 0 ? ` · ${ownOver} over. Shorten it to add.` : ""}
                    </div>
                  )}
                  <div className={s.lsButtons}>
                    <button className={s.lsSubmit} onClick={() => setTagFor(null)}>
                      Done
                    </button>
                  </div>
                </>
              );
            })()}
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
