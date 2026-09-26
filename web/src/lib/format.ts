import type { Stack } from "./types";

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

export type FlatLine = { num: string; label: string | null; text: string; link: string | null };

/** Every line of a stack in order, numbered "01", "02"… or bulleted. */
export function flatten(stack: Pick<Stack, "sections" | "style">): FlatLine[] {
  const out: FlatLine[] = [];
  let n = 1;
  const bulleted = stack.style === "bulleted";
  for (const sec of stack.sections) {
    sec.lines.forEach((ln, i) => {
      out.push({
        num: bulleted ? "•" : String(n).padStart(2, "0"),
        label: i === 0 ? sec.label : null,
        text: ln.text,
        link: ln.link,
      });
      n++;
    });
  }
  return out;
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** Browse topics and categories, in display order, with their colour dots. */
export const EXPLORE_CATS = ["Food & Drink", "Travel", "Books", "Home", "Art & Design", "Tech"];
export const TAG_SUGGESTIONS = ["Food & Drink", "Books", "Travel", "Home", "Shopping", "Tech"];
export const CATEGORY_DOTS: Record<string, string> = {
  "Food & Drink": "oklch(76% 0.08 45)",
  Travel: "oklch(76% 0.07 200)",
  Books: "oklch(76% 0.07 285)",
  Home: "oklch(78% 0.06 160)",
  "Art & Design": "oklch(76% 0.08 340)",
  Tech: "oklch(75% 0.07 240)",
  Shopping: "oklch(76% 0.07 100)",
};
export const DEFAULT_DOT = "oklch(78% 0.06 160)";

export const MAX_LINE = 500;
export const MAX_TITLE = 120;
export const MAX_DESCRIPTION = 500;
