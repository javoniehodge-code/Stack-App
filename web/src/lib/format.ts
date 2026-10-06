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
  text: string;
  link: string | null;
  /** The line split for display: bold head, gray note (the saved note, or "Name — details"). */
  head: string;
  note: string;
  format: LineFormat;
  /** Whether a numbered or bulleted line's heading is bold (the default). */
  bold: boolean;
};

/** A line's format; older lines without one follow the stack's style. */
export const lineFormat = (ln: Pick<Line, "format">, style: Stack["style"]): LineFormat =>
  ln.format ?? (style === "bulleted" ? "bullet" : "num");

/** Numbered and bulleted lines have a heading and an optional note; paragraphs and bold lines are one block. */
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
        text: ln.text,
        link: ln.link,
        // Older lines without a format may be written as "Name — details"; newer ones keep the detail as the note.
        ...(!list ? { head: ln.text, note: "" } : ln.format ? { head: ln.text, note: ln.note?.trim() ?? "" } : splitLine(ln.text, ln.note)),
        format,
        bold: !list || ln.bold !== false,
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
export const MAX_HEAD = 60; // a numbered, bulleted or bold line's heading
export const MAX_NOTE = 300; // a numbered or bulleted line's optional detail
export const MAX_PARAGRAPH = 360; // a paragraph line
export const MAX_TOTAL = 6000; // title, description, section headings, lines and details together
export const MAX_REPOST_NOTE = 500;
