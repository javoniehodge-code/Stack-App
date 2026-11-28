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
  /** The pick's tags. */
  tags: string[];
  /** A pick's heading is plain text, shown as typed (older lines can have ** bold marks). */
  plain?: boolean;
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

/**
 * The first web address typed into some text, and the text without just that one (any others stay in place).
 * Null when there's none.
 */
export function firstTextLink(text: string): { href: string; rest: string } | null {
  for (const m of text.matchAll(URL_RE)) {
    const trail = m[0].match(/[.,;:!?)\]]+$/)?.[0] ?? "";
    const u = m[0].slice(0, m[0].length - trail.length);
    if (!u) continue;
    const rest = (text.slice(0, m.index) + text.slice(m.index + u.length))
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,;.!?])/g, "$1")
      .trim();
    return { href: /^https?:/i.test(u) ? u : `https://${u}`, rest };
  }
  return null;
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
      // A pick (it has an id) shows as saved: its heading as typed, its subheading, and its links in order.
      if (typeof ln.id === "string") {
        const links = (Array.isArray(ln.links) ? ln.links : ln.link ? [{ url: ln.link, name: ln.linkName ?? "" }] : []).filter((x) => typeof x?.url === "string" && x.url);
        out.push({
          num: format === "num" ? String(n++).padStart(2, "0") : "•",
          label: i === 0 ? sec.label : null,
          section: sec.label,
          text: ln.text,
          link: links[0]?.url ?? null,
          linkLabel: links[0] ? links[0].name?.trim() || linkDomain(links[0].url) : "",
          head: ln.text,
          note: ln.note?.trim() ?? "",
          links: links.slice(1).map((x) => ({ href: x.url, label: x.name?.trim() || linkDomain(x.url) })),
          plain: true,
          format,
          tags: Array.isArray(ln.tags) ? ln.tags.filter((t): t is string => typeof t === "string" && !!t.trim()) : [],
        });
        return;
      }
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
        tags: Array.isArray(ln.tags) ? ln.tags.filter((t): t is string => typeof t === "string" && !!t.trim()) : [],
      });
    });
  }
  return out;
}

export const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export const TAG_SUGGESTIONS = ["Food & Drink", "Books", "Travel", "Home", "Shopping", "Tech"];

// Content limits (spec, Content rules). The database checks the same numbers when a stack is published
// (migration 20261129000000_pick_model). Drafts can go over them; the editor shows what to fix.
export const MAX_TITLE = 60;
export const MAX_DESCRIPTION = 160;
export const MAX_LABEL = 40; // a section's title
export const MAX_SECTIONS = 5;
export const MAX_ITEMS = 15;
export const MAX_HEADING = 80; // a pick's heading
export const MAX_SUBHEADING = 100; // a pick's subheading
export const MAX_TAGS = 3; // tags per pick
export const MAX_TAG = 20; // a tag's text
export const MAX_LINK_NAME = 40; // a link's name, shown on its pill
export const MAX_LINKS = 2; // links per pick

/** The suggested pick tags, in their 5 groups. A pick can have one price. Typed tags have no group. */
export const TAG_GROUPS: { key: string; name: string; hint: string; tags: [string, string][] }[] = [
  { key: "highlight", name: "Highlight", hint: "what stands out", tags: [["Must-do", "⭐"], ["Hidden gem", "💎"], ["New", "🆕"]] },
  { key: "price", name: "Price", hint: "pick one", tags: [["Free", ""], ["$", ""], ["$$", ""], ["$$$", ""]] },
  { key: "good", name: "Good for", hint: "who it suits", tags: [["Kid-friendly", "👶"], ["Date night", "💑"], ["Solo-friendly", "🧍"], ["Groups", "👯"], ["Veg options", "🥗"]] },
  {
    key: "know",
    name: "Know before",
    hint: "save them a surprise",
    tags: [["Cash only", "💵"], ["Book ahead", "📅"], ["Go early", "⏰"], ["Walk-in", "🚶"], ["Expect a line", "⏳"], ["Quick read", "📗"], ["Dense", "🧠"], ["Great on audio", "🎧"]],
  },
  { key: "when", name: "When", hint: "best time", tags: [["Brunch", "☀️"], ["Late night", "🌙"], ["Sunset", "🌅"]] },
];
export const PRICE_TAGS = ["Free", "$", "$$", "$$$"];

// The Finalize step (spec, Flow 1 step 4). The database checks the same lists (migration 20261130000000_finalize).
/** The 12 theme emoji. */
export const THEME_EMOJIS = ["🍸", "🍜", "☕", "📖", "✈️", "🛍️", "🖥️", "🎧", "🌮", "🌴", "🎨", "✨"];
/** The 6 theme colours. */
export const THEME_COLORS = ["oklch(86% 0.13 85)", "oklch(84% 0.12 40)", "oklch(84% 0.09 260)", "oklch(85% 0.1 160)", "oklch(85% 0.1 340)", "oklch(88% 0.12 110)"];
/** Theme emoji that suggest a place: "Is this about a place?" starts at Yes with one of these. */
export const PLACE_EMOJIS = ["🍸", "🍜", "☕", "✈️", "🌮", "🌴"];
/** The 12 platform categories, with their colours. A Stack has up to 2. */
export const CATEGORIES: { name: string; color: string }[] = [
  { name: "Art & Design", color: "oklch(85% 0.1 340)" },
  { name: "Technology", color: "oklch(88% 0.12 110)" },
  { name: "Business & Money", color: "oklch(87% 0.06 230)" },
  { name: "Learning", color: "oklch(84% 0.09 260)" },
  { name: "Health & Wellness", color: "oklch(88% 0.09 150)" },
  { name: "Food & Drink", color: "oklch(84% 0.12 40)" },
  { name: "Travel & Places", color: "oklch(85% 0.1 160)" },
  { name: "Style & Shopping", color: "oklch(87% 0.08 20)" },
  { name: "Home & Living", color: "oklch(86% 0.13 85)" },
  { name: "Entertainment & Culture", color: "oklch(85% 0.1 300)" },
  { name: "Sports & Outdoors", color: "oklch(86% 0.1 130)" },
  { name: "Games & Hobbies", color: "oklch(88% 0.1 60)" },
];
export const MAX_CATEGORIES = 2;
/** Explore's order for the 12 categories (design): the first 6 show as chips and boxes, then "More categories". */
export const EXPLORE_CATS = [
  "Food & Drink",
  "Travel & Places",
  "Art & Design",
  "Technology",
  "Learning",
  "Home & Living",
  "Style & Shopping",
  "Entertainment & Culture",
  "Health & Wellness",
  "Business & Money",
  "Sports & Outdoors",
  "Games & Hobbies",
];
export const EXPLORE_CATS_SHOWN = 6;
const CATEGORY_EMOJI: Record<string, string> = {
  "Food & Drink": "🍜",
  "Travel & Places": "✈️",
  "Art & Design": "🎨",
  Technology: "🖥️",
  Learning: "📖",
  "Home & Living": "🏺",
  "Style & Shopping": "🛍️",
  "Entertainment & Culture": "🎤",
  "Health & Wellness": "🧘",
  "Business & Money": "💼",
  "Sports & Outdoors": "⛰️",
  "Games & Hobbies": "🎲",
};
/** A category's emoji and colour, as in the design. */
export const categoryStyle = (name: string) => ({
  emoji: CATEGORY_EMOJI[name] ?? "✨",
  color: CATEGORIES.find((c) => c.name === name)?.color ?? "oklch(99.5% 0.01 95)",
});
/** A category's name for a narrow box: "Entertainment" may break as "Entertain-ment" (a soft hyphen), never mid-word. */
export const categoryLabel = (name: string) => name.replace("Entertainment", "Entertain\u00ADment");
/** One of the 12 categories, matched in any letter case (for addresses like /explore?cat=food%20%26%20drink). */
export const findCategory = (name: string) => CATEGORIES.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())?.name ?? null;
export const MAX_CITY = 80;

/** The theme emoji a title suggests (✨ when nothing matches). */
export function suggestEmoji(title: string) {
  const t = title.toLowerCase();
  const rules: [RegExp, string][] = [
    [/bar|drink|cocktail|wine|mezcal/, "🍸"],
    [/ramen|noodle|food|eat|restaurant|brunch/, "🍜"],
    [/taco/, "🌮"],
    [/coffee|caf[eé]/, "☕"],
    [/book|read/, "📖"],
    [/beach|island|tropical/, "🌴"],
    [/travel|trip|city|spots|guide/, "✈️"],
    [/etsy|shop|gift|finds/, "🛍️"],
    [/desk|tech|setup/, "🖥️"],
    [/podcast|music|playlist/, "🎧"],
    [/art|design|gallery/, "🎨"],
  ];
  return rules.find(([re]) => re.test(t))?.[1] ?? "✨";
}

/** The theme colour a title suggests: always the same one for the same title. */
export function suggestColor(title: string) {
  let h = 0;
  for (const c of title.trim()) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return THEME_COLORS[h % THEME_COLORS.length];
}
/** A Stack's theme as shown everywhere: its Finalize choice, or for one published before themes, the one its title suggests. */
export const stackTheme = (st: { title: string; theme_emoji?: string | null; theme_color?: string | null }) => ({
  emoji: st.theme_emoji ?? suggestEmoji(st.title),
  color: st.theme_color ?? suggestColor(st.title),
});

const TAG_INFO = new Map(TAG_GROUPS.flatMap((g) => g.tags.map(([t, e]) => [t.toLowerCase(), { group: g.key, emoji: e, name: t }] as const)));
/** A tag's group ("" for a typed one), emoji and name as shown (a suggested tag keeps its own spelling). */
export const tagInfo = (t: string) => TAG_INFO.get(t.trim().toLowerCase()) ?? { group: "", emoji: "", name: t.trim() };
/** Text with typed or pasted line breaks turned into spaces, as every field keeps it. */
export const oneLine = (t: string) => t.replace(/\s*[\r\n]+\s*/g, " ");
export const MAX_REPOST_NOTE = 500;
