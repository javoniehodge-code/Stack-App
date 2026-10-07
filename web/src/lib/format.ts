import type { Line, LineFormat, Stack } from "./types";

export function fmtCount(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".0", "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(".0", "") + "K";
  return String(n);
}

export function timeAgo(iso: string | null) {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m";
  if (s < 86400) return Math.floor(s / 3600) + "h";
  if (s < 604800) return Math.floor(s / 86400) + "d";
  if (s < 31536000) return Math.floor(s / 604800) + "w";
  return Math.floor(s / 31536000) + "y";
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

export type FlatLine = {
  num: string;
  label: string | null;
  /** The subsection this line is in (on every line, unlike `label`). */
  section: string | null;
  /** The line's text without ** bold marks. */
  text: string;
  link: string | null;
  /** What the link's pill says: its name, or the domain. */
  linkLabel: string;
  /** The text to show, with web addresses taken out and ** around bold words (see `richParts`). */
  head: string;
  /** An older line's separate detail, shown under the text. */
  note: string;
  /** Web addresses typed into the text, shown as pills (they're taken out of `head` and `note`). */
  links: { href: string; label: string }[];
  format: LineFormat;
};

/** Text without its ** bold marks. */
export const plainText = (t: string) => t.replace(/\*\*/g, "");

/** Text split into runs, bold where it's between ** marks. */
export function richParts(t: string): { text: string; bold: boolean }[] {
  const out: { text: string; bold: boolean }[] = [];
  let last = 0;
  for (const m of t.matchAll(/\*\*([\s\S]+?)\*\*/g)) {
    if (m.index > last) out.push({ text: t.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < t.length) out.push({ text: t.slice(last), bold: false });
  return out;
}

/** The domain of a web address, for its pill ("fuunji.jp"). */
export const linkDomain = (url: string) => url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split(/[/?#]/)[0];

// A web address typed into a line: "https://…", "www.…" or a bare domain like "fuunji.jp/menu".
const URL_RE = /((?:https?:\/\/|www\.)[^\s*]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|co|jp|world|app|dev|me|ly|tv|uk)\b(?:\/[^\s*]*)?)/gi;

/** The web addresses typed into some text, and the text without them (links show as pills instead). */
export function textLinks(text: string): { text: string; links: string[] } {
  const links: string[] = [];
  let rest = "";
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const trail = m[0].match(/[.,;:!?)\]]+$/)?.[0] ?? "";
    const u = m[0].slice(0, m[0].length - trail.length);
    if (!u) continue;
    rest += text.slice(last, m.index);
    links.push(/^https?:/i.test(u) ? u : `https://${u}`);
    last = m.index + u.length;
  }
  rest += text.slice(last);
  return {
    text: rest
      .replace(/\*\*\s*\*\*/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ +\n/g, "\n")
      .trim(),
    links,
  };
}

const linkKey = (url: string) => url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "").toLowerCase();

/**
 * How a line reads with typed web addresses taken out of its text: the text and note without them, and the
 * addresses (other than the line's own link) to show as pills, with their names. A line that was only an address
 * shows just the pill.
 */
export function splitTextLinks(head: string, note: string, link: string | null, names?: Record<string, string> | null) {
  const h = textLinks(head);
  const n = textLinks(note);
  const seen = new Set(link ? [linkKey(link)] : []);
  const links = [...h.links, ...n.links]
    .filter((u) => !seen.has(linkKey(u)) && !!seen.add(linkKey(u)))
    .map((href) => ({ href, label: names?.[href]?.trim() || linkDomain(href) }));
  return { head: plainText(h.text).trim() ? h.text : link || links.length ? "" : head, note: n.text, links };
}

/** A line's format; older lines without one follow the stack's style. */
export const lineFormat = (ln: Pick<Line, "format">, style: Stack["style"]): LineFormat =>
  ln.format ?? (style === "bulleted" ? "bullet" : "num");

/** Numbered and bulleted lines get a number or a bullet; paragraphs and bold lines have no marker. */
export const isListFormat = (f: LineFormat) => f === "num" || f === "bullet";

/** A line's saved note, or for older lines written as "Name — details", the part after the dash. */
function splitLine(text: string, note: string | null | undefined) {
  if (note?.trim()) return { head: text, note: note.trim() };
  const parts = text.split(/\s+[—–]\s+/);
  if (parts.length < 2) return { head: text, note: "" };
  const rest = parts.slice(1).join(" — ");
  return { head: parts[0], note: rest.charAt(0).toUpperCase() + rest.slice(1) };
}

/**
 * Every line of a stack in order. Numbered lines count "01", "02"… across the stack, bulleted lines get "•", and
 * paragraphs and bold lines have no marker.
 */
export function flatten(stack: Pick<Stack, "sections" | "style">): FlatLine[] {
  const out: FlatLine[] = [];
  let n = 1;
  for (const sec of stack.sections) {
    sec.lines.forEach((ln, i) => {
      const format = lineFormat(ln, stack.style);
      const list = isListFormat(format);
      out.push({
        num: format === "num" ? String(n++).padStart(2, "0") : format === "bullet" ? "•" : "",
        label: i === 0 ? sec.label : null,
        section: sec.label,
        text: plainText(ln.text),
        link: ln.link,
        linkLabel: ln.link ? ln.linkName?.trim() || linkDomain(ln.link) : "",
        // Older lines without a format may be written as "Name — details"; others keep any detail as the note.
        ...(() => {
          const parts = !list ? { head: ln.text, note: "" } : ln.format ? { head: ln.text, note: ln.note?.trim() ?? "" } : splitLine(ln.text, ln.note);
          return splitTextLinks(parts.head, parts.note, ln.link, ln.linkNames);
        })(),
        format,
      });
    });
  }
  return out;
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Browse topics and categories, in display order, with their colour dots. */
export const EXPLORE_CATS = ["Food & Drink", "Travel", "Books", "Home", "Art & Design", "Tech"];
export const TAG_SUGGESTIONS = ["Food & Drink", "Books", "Travel", "Home", "Shopping", "Tech"];
export const CATEGORY_DOTS: Record<string, string> = {
  "Food & Drink": "oklch(54% 0.16 45)",
  Travel: "oklch(64% 0.16 50)",
  Books: "oklch(64% 0.16 50)",
  Home: "oklch(64% 0.16 50)",
  "Art & Design": "oklch(64% 0.16 50)",
  Tech: "oklch(64% 0.16 50)",
  Shopping: "oklch(64% 0.16 50)",
};
export const DEFAULT_DOT = "oklch(64% 0.16 50)";

// Stack size limits. The database's save function enforces the same numbers.
export const MAX_TITLE = 60;
export const MAX_DESCRIPTION = 180;
export const MAX_LABEL = 60; // section heading
export const MAX_SECTIONS = 20;
export const MAX_ITEMS = 100;
export const MAX_LINE = 360; // a paragraph, numbered or bulleted line (** bold marks don't count)
export const MAX_BOLD_LINE = 60; // a bold line
export const MAX_NOTE = 300; // an older numbered or bulleted line's separate detail
export const MAX_LINK_NAME = 40; // a link's name, shown on its pill
export const MAX_TOTAL = 6000; // title, description, section headings, lines and details together
export const MAX_REPOST_NOTE = 500;
