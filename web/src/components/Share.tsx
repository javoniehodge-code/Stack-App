"use client";

import { useState } from "react";
import { flatten, initials } from "@/lib/format";
import type { Stack } from "@/lib/types";
import { useToast } from "./AppProviders";
import { ShareIcon } from "./icons";
import sh from "./Share.module.css";

const stackUrl = (id: string) => `${window.location.origin}/s/${id}`;

/** The share arrow in an action row; opens the share sheet. */
export function ShareButton({ stack, className, size = 16 }: { stack: Stack; className: string; size?: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)} aria-label="Share">
        <ShareIcon size={size} />
      </button>
      {open && <ShareSheet stack={stack} onClose={() => setOpen(false)} />}
    </>
  );
}

/** A preview card of the stack above a sheet with Copy, Save image and Share…. */
function ShareSheet({ stack, onClose }: { stack: Stack; onClose: () => void }) {
  const toast = useToast();
  const lines = flatten(stack);
  const shown = lines.slice(0, 4);
  const more = lines.length - shown.length;
  const url = stackUrl(stack.id);
  const shortUrl = url.replace(/^https?:\/\//, "");

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

  async function saveImage() {
    try {
      const r = await saveImageFile(await renderCard(stack, shortUrl), `${slug(stack.title) || "stack"}.png`);
      if (r === "downloaded") done("Image saved");
      else if (r === "shared") onClose();
      else if (r === "failed") toast("Couldn't save the image");
    } catch {
      toast("Couldn't save the image");
    }
  }

  return (
    <div className={sh.scrim} onClick={onClose}>
      <div className={sh.preview} onClick={(e) => e.stopPropagation()}>
        <div className={sh.card}>
          <div className={sh.cardBody}>
            <div className={sh.title}>{stack.title}</div>
            <div className={sh.lines}>
              {shown.map((l, i) => (
                <div key={i} className={sh.line}>
                  <span className={sh.num}>{l.num}</span>
                  <span className={sh.text}>{l.text}</span>
                </div>
              ))}
              {more > 0 && <div className={sh.more}>+ {more} more</div>}
            </div>
          </div>
          <div className={sh.footer}>
            <span className={sh.avatar}>{initials(stack.author.name)}</span>
            <span className={sh.credit}>
              <span className={sh.curated}>
                Curated by <strong>@{stack.author.handle}</strong> on Stack
              </span>
              <span className={sh.url}>{shortUrl}</span>
            </span>
            <span className={sh.brand}>Stack</span>
          </div>
        </div>
      </div>
      <div className={sh.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Share stack">
        <div className={sh.grabber} />
        <button className={sh.copyRow} onClick={copy}>
          <span className={sh.copyUrl}>{shortUrl}</span>
          <span className={sh.copyLabel}>Copy</span>
        </button>
        <div className={sh.buttons}>
          <button className={sh.secondary} onClick={saveImage}>
            Save image
          </button>
          <button className={sh.primary} onClick={share}>
            Share…
          </button>
        </div>
      </div>
    </div>
  );
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

const slug = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Draws the preview card to a PNG, matching the sheet's card. */
async function renderCard(stack: Stack, shortUrl: string): Promise<Blob> {
  const W = 360;
  const PAD = 20;
  const scale = 3;
  const font = getComputedStyle(document.body).fontFamily;
  const lines = flatten(stack);
  const shown = lines.slice(0, 4);
  const more = lines.length - shown.length;

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `800 19px ${font}`;
  const titleLines = wrap(measure, stack.title, W - PAD * 2).slice(0, 4);
  const bodyH = PAD + titleLines.length * 24 + 12 + shown.length * 20 + (more > 0 ? 22 : 0) + 16;
  const footH = 52;
  const H = bodyH + footH;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const c = canvas.getContext("2d")!;
  c.scale(scale, scale);
  c.textBaseline = "alphabetic";

  roundRect(c, 0, 0, W, H, 18);
  c.fillStyle = "oklch(20% 0.012 165)";
  c.fill();
  c.save();
  roundRect(c, 0, 0, W, H, 18);
  c.clip();

  let y = PAD + 18;
  c.fillStyle = "oklch(92% 0.008 160)";
  c.font = `800 19px ${font}`;
  for (const t of titleLines) {
    c.fillText(t, PAD, y);
    y += 24;
  }
  y += 10;
  for (const l of shown) {
    c.font = `700 13px ${font}`;
    c.fillStyle = "oklch(78% 0.06 160)";
    c.fillText(l.num, PAD, y);
    const numW = Math.max(c.measureText(l.num).width, 16) + 9;
    c.font = `400 13px ${font}`;
    c.fillStyle = "oklch(86% 0.008 160)";
    c.fillText(ellipsize(c, l.text, W - PAD * 2 - numW), PAD + numW, y);
    y += 20;
  }
  if (more > 0) {
    c.font = `400 12px ${font}`;
    c.fillStyle = "oklch(62% 0.012 165)";
    c.fillText(`+ ${more} more`, PAD, y + 2);
  }

  // Footer: dashed rule, darker band, avatar, credit, url, wordmark.
  c.fillStyle = "oklch(17% 0.012 165)";
  c.fillRect(0, bodyH, W, footH);
  c.strokeStyle = "oklch(34% 0.012 165)";
  c.setLineDash([4, 3]);
  c.beginPath();
  c.moveTo(0, bodyH + 0.5);
  c.lineTo(W, bodyH + 0.5);
  c.stroke();
  c.setLineDash([]);

  const cy = bodyH + footH / 2;
  c.beginPath();
  c.arc(PAD + 13, cy, 13, 0, Math.PI * 2);
  c.fillStyle = "oklch(78% 0.06 160)";
  c.fill();
  c.fillStyle = "oklch(23% 0.012 165)";
  c.font = `700 10px ${font}`;
  c.textAlign = "center";
  c.fillText(initials(stack.author.name), PAD + 13, cy + 3.5);
  c.textAlign = "left";

  c.font = `800 13px ${font}`;
  const brandW = c.measureText("Stack").width;
  c.fillStyle = "oklch(78% 0.06 160)";
  c.fillText("Stack", W - PAD - brandW, cy + 4);

  const tx = PAD + 36;
  const maxW = W - tx - PAD - brandW - 10;
  c.font = `400 12px ${font}`;
  c.fillStyle = "oklch(78% 0.008 160)";
  c.fillText(ellipsize(c, `Curated by @${stack.author.handle} on Stack`, maxW), tx, cy - 3);
  c.font = `400 10.5px ${getComputedStyle(document.body).getPropertyValue("--mono") || "monospace"}`;
  c.fillStyle = "oklch(78% 0.06 160)";
  c.fillText(ellipsize(c, shortUrl, maxW), tx, cy + 12);
  c.restore();

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}

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
