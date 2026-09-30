"use client";

import { useEffect, useRef, useState } from "react";
import { useEngagement, useVisibility } from "@/lib/store";
import type { Stack } from "@/lib/types";
import { useToast } from "./AppProviders";
import { ShareIcon } from "./icons";
import { drawPage, layoutStory, PAGE_H, PAGE_W, pagePng, type Story } from "./StoryPages";
import { VisIcon } from "./Visibility";
import sh from "./Share.module.css";

const stackUrl = (id: string) => `${window.location.origin}/s/${id}`;

/**
 * The share arrow in an action row; opens the share sheet. For your own private
 * stack it calls `onPrivate` instead (to offer making it shareable).
 */
export function ShareButton({ stack, className, size = 16, onPrivate, label }: { stack: Stack; className: string; size?: number; onPrivate?: () => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const visibility = useVisibility(stack);
  return (
    <>
      <button className={className} onClick={() => (visibility === "private" && onPrivate ? onPrivate() : setOpen(true))} aria-label="Share">
        {label}
        <ShareIcon size={size} />
      </button>
      {open && <ShareSheet stack={stack} onClose={() => setOpen(false)} />}
    </>
  );
}

/** The stack's story pages in a swipeable row above a sheet with Copy, Save image(s) and Share…. */
function ShareSheet({ stack, onClose }: { stack: Stack; onClose: () => void }) {
  const toast = useToast();
  const unlisted = useVisibility(stack) === "unlisted";
  const e = useEngagement(stack);
  const [story, setStory] = useState<Story | null>(null);
  const url = stackUrl(stack.id);
  const shortUrl = url.replace(/^https?:\/\//, "");
  const { likes, saves, reposts } = e;

  // Pages are measured with the page fonts, so wait for them first.
  useEffect(() => {
    let live = true;
    document.fonts.ready.then(() => {
      if (live) setStory(layoutStory(stack, shortUrl, { likes, saves, reposts }));
    });
    return () => {
      live = false;
    };
  }, [stack, shortUrl, likes, saves, reposts]);

  const done = (message: string) => {
    onClose();
    toast(message);
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      done("Link copied to clipboard");
    } catch {
      toast("Couldn't copy the link");
    }
  }

  async function share() {
    const r = await systemShare({ title: stack.title, text: `${stack.title} · curated by @${stack.author.handle} on Stack`, url });
    if (r === "unsupported") copy();
    else if (r === "failed") toast("Couldn't open sharing");
    else if (r === "shared") onClose();
  }

  async function saveImages() {
    if (!story) return;
    const n = story.pages.length;
    const base = slug(stack.title) || "stack";
    try {
      const blobs = await Promise.all(story.pages.map((_, i) => pagePng(story, i)));
      const r = await saveImageFiles(blobs, blobs.map((_, i) => (n > 1 ? `${base}-${i + 1}.png` : `${base}.png`)));
      if (r === "downloaded") done(n > 1 ? `${n} images saved` : "Image saved");
      else if (r === "shared") onClose();
      else if (r === "failed") toast(n > 1 ? "Couldn't save the images" : "Couldn't save the image");
    } catch {
      toast(n > 1 ? "Couldn't save the images" : "Couldn't save the image");
    }
  }

  const n = story?.pages.length ?? 1;
  return (
    <div className={sh.scrim} onClick={onClose}>
      <div className={sh.stage}>
        <div className={sh.pages} onClick={(ev) => ev.stopPropagation()}>
          {story ? story.pages.map((_, i) => <StoryCanvas key={i} story={story} index={i} />) : <div className={sh.page} />}
        </div>
        {n > 1 && <div className={sh.pageCount}>{n} pages · swipe to preview</div>}
      </div>
      <div className={sh.sheet} onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-label="Share stack">
        <div className={sh.grabber} />
        {unlisted && (
          <div className={sh.unlisted}>
            <VisIcon value="unlisted" size={14} color="oklch(54% 0.16 45)" />
            Invite only · only people with this link can view
          </div>
        )}
        <button className={sh.copyRow} onClick={copy}>
          <span className={sh.copyUrl}>{shortUrl}</span>
          <span className={sh.copyLabel}>Copy</span>
        </button>
        <div className={sh.buttons}>
          <button className={sh.secondary} onClick={saveImages} disabled={!story}>
            {n > 1 ? `Save ${n} images` : "Save image"}
          </button>
          <button className={sh.primary} onClick={share}>
            Share…
          </button>
        </div>
      </div>
    </div>
  );
}

/** One story page, drawn at the screen's pixel density. */
function StoryCanvas({ story, index }: { story: Story; index: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const w = Math.round(canvas.clientWidth * (window.devicePixelRatio || 1));
    canvas.width = w;
    canvas.height = Math.round((w * PAGE_H) / PAGE_W);
    drawPage(canvas, story, index);
  }, [story, index]);
  const p = story.pages[index];
  return <canvas ref={ref} className={sh.page} role="img" aria-label={p.counter ? `Page ${p.counter}` : "Story image"} />;
}

type ShareResult = "shared" | "cancelled" | "failed" | "unsupported";

/** Opens the system share sheet. Closing it isn't an error. */
export async function systemShare(data: ShareData): Promise<ShareResult> {
  if (!navigator.share) return "unsupported";
  try {
    await navigator.share(data);
    return "shared";
  } catch (e) {
    return (e as Error).name === "AbortError" ? "cancelled" : "failed";
  }
}

/** Phones: hand the image to the share sheet so it can go to Photos. Desktop: download it. */
export async function saveImageFile(blob: Blob, name: string): Promise<ShareResult | "downloaded"> {
  const file = new File([blob], name, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) return systemShare({ files: [file] });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return "downloaded";
}

/** Several images: one share sheet with all of them on phones, otherwise a download each. */
async function saveImageFiles(blobs: Blob[], names: string[]): Promise<ShareResult | "downloaded"> {
  if (blobs.length === 1) return saveImageFile(blobs[0], names[0]);
  const files = blobs.map((b, i) => new File([b], names[i], { type: "image/png" }));
  if (navigator.canShare?.({ files })) return systemShare({ files });
  blobs.forEach((b, i) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = names[i];
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  return "downloaded";
}

const slug = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

export function ellipsize(c: CanvasRenderingContext2D, text: string, max: number) {
  if (c.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && c.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t.trimEnd() + "…";
}

export function wrap(c: CanvasRenderingContext2D, text: string, max: number) {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (c.measureText(next).width <= max || !line) line = next;
    else {
      out.push(line);
      line = word;
    }
  }
  if (line) out.push(line);
  return out.map((l) => ellipsize(c, l, max));
}
