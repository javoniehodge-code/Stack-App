import { flatten, initials } from "@/lib/format";
import type { Stack } from "@/lib/types";

/*
 * Story images for a stack: 9:16 pages (1080×1920) that show the stack card at real phone size.
 * A long stack continues across pages instead of shrinking:
 * - page 1 has the full card top (author, title, description); later pages a slim header with the title and "2 / 4"
 * - pages fill by the measured height of each line, and a line is never split
 * - a subsection title never ends a page; a page that starts mid-subsection repeats it with "cont."
 * - a single leftover line on the last page pulls one more line over with it
 * - at most 5 pages; past that the last page fades into "See all N lines →"
 * - the last page ends with the stack's likes, saves and reposts and "Make your own stack →"
 * - the top ~12% and bottom ~14% stay clear for the platform's own UI
 * Layout happens in points on a 393×699 page (a phone screen), then scales up to 1080×1920 for export.
 */

export const PAGE_W = 393;
export const PAGE_H = (PAGE_W * 16) / 9;
const MAX_PAGES = 5;

// Page and card geometry
const PAD_TOP = 92;
const PAD_X = 16;
const PAD_BOTTOM = 110;
const CARD_W = PAGE_W - PAD_X * 2;
const CARD_MAX = 433; // content height available inside the card
const BODY_X = 18;
const TEXT_W = CARD_W - 2 - BODY_X * 2;
const HEAD = 49; // top bar and its rule
const FOOT = 49; // counts bar on the last page
const MORE = 46; // "See all N lines" button
const LABEL_FIRST = 23;
const LABEL = 37;
const NUM_GAP = 12;

// Colors (the app's tokens)
const C = {
  page: "oklch(96.5% 0.004 80)",
  card: "oklch(99.6% 0.002 80)",
  border: "oklch(90.7% 0.006 80)",
  rule: "oklch(91.2% 0.006 80)",
  ink: "oklch(14.8% 0.006 80)",
  text: "oklch(19.4% 0.006 80)",
  text2: "oklch(24.9% 0.006 80)",
  muted: "oklch(41.5% 0.006 80)",
  muted60: "oklch(47.1% 0.006 80)",
  accent: "oklch(64% 0.16 50)",
  onAccent: "oklch(99.6% 0.002 80)",
};

type Fonts = { sans: string; mono: string };
type Item =
  | { kind: "label"; label: string; cont: boolean; padTop: number; h: number }
  | { kind: "line"; num: string; head: string[]; note: string[]; h: number; weight: number };
export type StoryPage = {
  cover: boolean;
  last: boolean;
  counter: string;
  items: Item[];
  /** Lines of the whole stack not shown on any page (only on a capped last page). */
  more: number;
};
export type Story = {
  pages: StoryPage[];
  stack: Stack;
  title: string[];
  titleOne: string;
  desc: string[];
  total: number;
  url: string;
  counts: { likes: number; saves: number; reposts: number };
  fonts: Fonts;
};

/** The page fonts: the app's sans and mono, resolved to real family names so canvas can use them. */
function resolveFonts(): Fonts {
  const probe = document.createElement("span");
  probe.style.fontFamily = "var(--mono)";
  document.body.appendChild(probe);
  const mono = getComputedStyle(probe).fontFamily || "monospace";
  probe.remove();
  return { sans: getComputedStyle(document.body).fontFamily, mono };
}

function setFont(c: CanvasRenderingContext2D, weight: number, size: number, family: string, spacing = 0) {
  c.font = `${weight} ${size}px ${family}`;
  // letterSpacing is newer; browsers without it draw with normal spacing.
  (c as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${spacing}px`;
}

function wrapText(c: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width <= max) {
      line = next;
      continue;
    }
    if (line) out.push(line);
    // A single word wider than the line breaks by characters.
    let w = word;
    while (c.measureText(w).width > max && w.length > 1) {
      let i = w.length - 1;
      while (i > 1 && c.measureText(w.slice(0, i)).width > max) i--;
      out.push(w.slice(0, i));
      w = w.slice(i);
    }
    line = w;
  }
  if (line) out.push(line);
  return out.length ? out : [""];
}

function ellipsize(c: CanvasRenderingContext2D, text: string, max: number) {
  if (c.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && c.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

/** Splits a stack into story pages. Needs the page fonts loaded (await document.fonts.ready first). */
export function layoutStory(stack: Stack, shortUrl: string, counts: Story["counts"]): Story {
  const fonts = resolveFonts();
  const c = document.createElement("canvas").getContext("2d")!;
  const lines = flatten(stack);

  setFont(c, 600, 19, fonts.sans, -0.4);
  const title = wrapText(c, stack.title, TEXT_W);
  setFont(c, 600, 13.5, fonts.sans);
  const titleOne = stack.title;
  setFont(c, 400, 13.5, fonts.sans);
  const desc = stack.description ? wrapText(c, stack.description, TEXT_W) : [];
  const coverH = HEAD + 16 + title.length * 23.75 + 6 + desc.length * 19.575 + 16 + 14;
  const contH = HEAD + 4 + 14;

  // Each line's wrapped heading and note, and its height.
  setFont(c, 400, 12, fonts.mono);
  const numW = Math.max(...lines.map((l) => c.measureText(l.num).width), 0);
  const colW = TEXT_W - numW - NUM_GAP;
  const measured = lines.map((l) => {
    // Paragraphs are regular weight and keep their line breaks; bold lines are heavier.
    const weight = l.format === "text" ? 400 : l.format === "bold" ? 700 : l.bold ? 600 : 400;
    setFont(c, weight, 14, fonts.sans, -0.2);
    const head = l.head.split("\n").flatMap((p) => wrapText(c, p, colW));
    setFont(c, 400, 12.5, fonts.sans);
    const note = l.note ? wrapText(c, l.note, colW) : [];
    const h = 11 + head.length * 18.2 + (note.length ? 2 + note.length * 18.125 : 0) + 12 + 1;
    return { ...l, head, note, h, weight };
  });

  const run = (breaks: Set<number>, cap: boolean) => {
    const pages: { cover: boolean; items: Item[]; used: number; lines: number }[] = [];
    let cur = { cover: true, items: [] as Item[], used: coverH, lines: 0 };
    pages.push(cur);
    const open = () => {
      cur = { cover: false, items: [], used: contH, lines: 0 };
      pages.push(cur);
    };
    const pushLabel = (label: string, cont: boolean) => {
      const first = cur.items.length === 0;
      const padTop = first ? (cur.cover ? 0 : 6) : 14;
      const h = first ? (cur.cover ? LABEL_FIRST : LABEL_FIRST + 6) : LABEL;
      cur.items.push({ kind: "label", label, cont, padTop, h });
      cur.used += h;
    };
    let shown = 0;
    for (let i = 0; i < measured.length; i++) {
      const l = measured[i];
      const startsSection = !!l.label;
      const capped = cap && pages.length === MAX_PAGES;
      const labelNeed = startsSection ? (cur.items.length ? LABEL : LABEL_FIRST) : 0;
      const tail = i === measured.length - 1 ? FOOT : capped ? MORE + FOOT : 0;
      const need = labelNeed + l.h + tail;
      if ((cur.used + need > CARD_MAX && cur.lines > 0) || (breaks.has(i) && cur.lines > 0)) {
        if (capped) break;
        open();
        // A page that starts mid-subsection repeats its title.
        if (!startsSection && l.section) pushLabel(l.section, true);
      }
      if (startsSection) pushLabel(l.label!, false);
      cur.items.push({ kind: "line", num: l.num, head: l.head, note: l.note, h: l.h, weight: l.weight });
      cur.used += l.h;
      cur.lines++;
      shown++;
    }
    return { pages, shown };
  };

  const breaks = new Set<number>();
  let r = run(breaks, false);
  if (r.pages.length > MAX_PAGES) r = run(breaks, true);
  else
    for (let k = 0; k < 3; k++) {
      // No single leftover line: move the previous page's last line over too.
      const last = r.pages[r.pages.length - 1];
      const prev = r.pages[r.pages.length - 2];
      if (!prev || last.lines >= 2 || prev.lines < 3) break;
      let seen = 0;
      r.pages.slice(0, -2).forEach((p) => (seen += p.lines));
      breaks.add(seen + prev.lines - 1);
      r = run(breaks, false);
    }

  const P = r.pages.length;
  const more = lines.length - r.shown;
  return {
    stack,
    title,
    titleOne,
    desc,
    total: lines.length,
    url: shortUrl,
    counts,
    fonts,
    pages: r.pages.map((p, i) => ({ cover: p.cover, last: i === P - 1, counter: P > 1 ? `${i + 1} / ${P}` : "", items: p.items, more: i === P - 1 ? more : 0 })),
  };
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Made on first use: the server, which also loads this file, has no Path2D.
let paths: { bookmark: Path2D[]; repost: Path2D[] } | null = null;
const iconPaths = () =>
  (paths ??= {
    bookmark: [new Path2D("M6.5 3.5h11v17l-5.5-4-5.5 4z")],
    repost: ["M17 2l4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "M7 22l-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3"].map((d) => new Path2D(d)),
  });

function icon(c: CanvasRenderingContext2D, paths: Path2D[], x: number, y: number, size: number, color: string) {
  c.save();
  c.translate(x, y);
  c.scale(size / 24, size / 24);
  c.strokeStyle = color;
  c.lineWidth = 2;
  c.lineCap = "round";
  c.lineJoin = "round";
  paths.forEach((p) => c.stroke(p));
  c.restore();
}

/** Draws one page into a canvas of any pixel size with the page's 9:16 shape. */
export function drawPage(canvas: HTMLCanvasElement, story: Story, index: number) {
  const page = story.pages[index];
  const { sans, mono } = story.fonts;
  const c = canvas.getContext("2d")!;
  const k = canvas.width / PAGE_W;
  c.setTransform(k, 0, 0, k, 0, 0);
  c.textBaseline = "alphabetic";

  c.fillStyle = C.page;
  c.fillRect(0, 0, PAGE_W, PAGE_H + 1);

  // Card height: the top, its content and (on the last page) the counts bar.
  let content = HEAD;
  content += page.cover ? 16 + story.title.length * 23.75 + 6 + story.desc.length * 19.575 + 16 : 4;
  page.items.forEach((it) => (content += it.h));
  if (page.more) content += MORE;
  content += 14;
  const cardH = content + (page.last ? FOOT : 0) + 2;
  const x0 = PAD_X;
  const y0 = PAD_TOP;

  c.save();
  c.shadowColor = "rgba(0,0,0,0.05)";
  c.shadowBlur = 24;
  c.shadowOffsetY = 8;
  roundRect(c, x0, y0, CARD_W, cardH, 24);
  c.fillStyle = C.card;
  c.fill();
  c.restore();
  roundRect(c, x0 + 0.5, y0 + 0.5, CARD_W - 1, cardH - 1, 24);
  c.strokeStyle = C.border;
  c.lineWidth = 1;
  c.stroke();

  c.save();
  roundRect(c, x0, y0, CARD_W, cardH, 24);
  c.clip();

  // Top bar: avatar, then author (page 1) or the title (later pages), then "2 / 4".
  const bx = x0 + 1 + BODY_X;
  const barMid = y0 + 1 + 24;
  c.beginPath();
  c.arc(bx + 14, barMid, 14, 0, Math.PI * 2);
  c.fillStyle = C.accent;
  c.fill();
  setFont(c, 700, 10, sans);
  c.fillStyle = C.onAccent;
  c.textAlign = "center";
  c.fillText(initials(story.stack.author.name), bx + 14, barMid + 3.5);
  c.textAlign = "left";

  setFont(c, 400, 12, mono);
  const counterW = page.counter ? c.measureText(page.counter).width : 0;
  const right = x0 + CARD_W - 1 - BODY_X;
  if (page.counter) {
    c.fillStyle = C.muted60;
    c.fillText(page.counter, right - counterW, barMid + 4);
  }
  const tx = bx + 28 + 10;
  const room = right - tx - (counterW ? counterW + 10 : 0);
  if (page.cover) {
    setFont(c, 400, 12.5, sans);
    const handle = `@${story.stack.author.handle}`;
    const hw = Math.min(c.measureText(handle).width, room * 0.45);
    setFont(c, 600, 13.5, sans);
    const name = ellipsize(c, story.stack.author.name, room - hw - 10);
    c.fillStyle = C.text;
    c.fillText(name, tx, barMid + 4.5);
    const nw = c.measureText(name).width;
    setFont(c, 400, 12.5, sans);
    c.fillStyle = C.muted60;
    c.fillText(ellipsize(c, handle, room - nw - 10), tx + nw + 10, barMid + 4.5);
  } else {
    setFont(c, 600, 13.5, sans);
    c.fillStyle = C.text;
    c.fillText(ellipsize(c, story.titleOne, room), tx, barMid + 4.5);
  }
  c.fillStyle = C.rule;
  c.fillRect(x0, y0 + 1 + 48, CARD_W, 1);

  // Body
  let y = y0 + 1 + HEAD + (page.cover ? 16 : 4);
  if (page.cover) {
    setFont(c, 600, 19, sans, -0.4);
    c.fillStyle = C.ink;
    story.title.forEach((t) => {
      c.fillText(t, bx, y + 18);
      y += 23.75;
    });
    y += 6;
    setFont(c, 400, 13.5, sans);
    c.fillStyle = C.muted;
    story.desc.forEach((t) => {
      c.fillText(t, bx, y + 14.5);
      y += 19.575;
    });
    y += 16;
  }
  setFont(c, 400, 12, mono);
  const numW = Math.max(0, ...page.items.map((it) => (it.kind === "line" ? c.measureText(it.num).width : 0)));
  page.items.forEach((it, j) => {
    const lastItem = j === page.items.length - 1;
    if (it.kind === "label") {
      y += it.padTop;
      setFont(c, 800, 11, sans, 0.88);
      c.fillStyle = C.accent;
      const text = it.label.toUpperCase();
      c.fillText(ellipsize(c, text, TEXT_W - (it.cont ? 44 : 0)), bx, y + 11);
      if (it.cont) {
        const w = Math.min(c.measureText(text).width, TEXT_W - 44);
        setFont(c, 500, 11, sans, 0.22);
        c.fillStyle = C.muted60;
        c.fillText("cont.", bx + w + 6, y + 11);
      }
      y += it.h - it.padTop;
      c.fillStyle = C.rule;
      c.fillRect(bx, y - 1, TEXT_W, 1);
      return;
    }
    const top = y;
    setFont(c, 400, 12, mono);
    c.fillStyle = C.accent;
    c.fillText(it.num, bx, top + 11 + 13);
    const cx = bx + numW + NUM_GAP;
    let ty = top + 11;
    setFont(c, it.weight, 14, sans, -0.2);
    c.fillStyle = C.text2;
    it.head.forEach((t) => {
      c.fillText(t, cx, ty + 14);
      ty += 18.2;
    });
    if (it.note.length) {
      ty += 2;
      setFont(c, 400, 12.5, sans);
      c.fillStyle = C.muted;
      it.note.forEach((t) => {
        c.fillText(t, cx, ty + 13);
        ty += 18.125;
      });
    }
    y = top + it.h;
    if (!lastItem) {
      c.fillStyle = C.rule;
      c.fillRect(bx, y - 1, TEXT_W, 1);
    }
  });

  if (page.more) {
    // Fade the last lines out, then "See all N lines →".
    const g = c.createLinearGradient(0, y - 64, 0, y);
    g.addColorStop(0, "oklch(99.6% 0.002 80 / 0)");
    g.addColorStop(0.9, C.card);
    c.fillStyle = g;
    c.fillRect(x0, y - 64, CARD_W, 64);
    y += 6;
    roundRect(c, bx + 0.5, y + 0.5, TEXT_W - 1, 39, 12);
    c.fillStyle = C.page;
    c.fill();
    c.strokeStyle = C.rule;
    c.stroke();
    setFont(c, 600, 13, sans);
    const label = `See all ${story.total} lines`;
    const lw = c.measureText(label).width;
    const aw = c.measureText("→").width;
    const lx = bx + (TEXT_W - lw - 6 - aw) / 2;
    c.fillStyle = C.text2;
    c.fillText(label, lx, y + 24.5);
    c.fillStyle = C.accent;
    c.fillText("→", lx + lw + 6, y + 24.5);
    y += 40;
  }

  if (page.last) {
    // Counts bar: likes, saves, reposts.
    const fy = y0 + cardH - 1 - 48;
    c.fillStyle = C.rule;
    c.fillRect(x0, fy, CARD_W, 1);
    const mid = fy + 24.5;
    let fx = x0 + 1 + 16;
    const fmt = (n: number) => n.toLocaleString("en-US");
    setFont(c, 400, 17, sans);
    c.fillStyle = C.muted;
    c.fillText("♡", fx, mid + 6);
    fx += c.measureText("♡").width + 5;
    setFont(c, 400, 12.5, sans);
    c.fillText(fmt(story.counts.likes), fx, mid + 4.5);
    fx += c.measureText(fmt(story.counts.likes)).width + 16;
    icon(c, iconPaths().bookmark, fx, mid - 8, 16, C.muted);
    fx += 21;
    c.fillText(fmt(story.counts.saves), fx, mid + 4.5);
    fx += c.measureText(fmt(story.counts.saves)).width + 16;
    icon(c, iconPaths().repost, fx, mid - 8, 16, C.muted);
    fx += 21;
    c.fillText(fmt(story.counts.reposts), fx, mid + 4.5);
  }
  c.restore();

  // Under the card: the wordmark, and the stack link or "Make your own stack →".
  const rowMid = PAGE_H - PAD_BOTTOM - 22;
  setFont(c, 800, 19, sans, -0.6);
  c.fillStyle = C.ink;
  const wx = PAD_X + 4;
  c.fillText("stack", wx, rowMid + 7);
  c.fillStyle = C.accent;
  c.fillText(".", wx + c.measureText("stack").width, rowMid + 7);
  const wordW = c.measureText("stack.").width;
  const rx = PAGE_W - PAD_X - 4;
  if (page.last) {
    setFont(c, 700, 14, sans);
    const t = "Make your own stack →";
    const w = c.measureText(t).width + 32;
    roundRect(c, rx - w, rowMid - 20, w, 40, 20);
    c.fillStyle = C.accent;
    c.fill();
    c.fillStyle = C.onAccent;
    c.fillText(t, rx - w + 16, rowMid + 5);
  } else {
    setFont(c, 400, 11, mono);
    c.fillStyle = C.muted;
    const t = ellipsize(c, story.url, rx - (wx + wordW + 12));
    c.fillText(t, rx - c.measureText(t).width, rowMid + 4);
  }
}

/** A page as a 1080×1920 PNG. */
export function pagePng(story: Story, index: number): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1920;
  drawPage(canvas, story, index);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}
