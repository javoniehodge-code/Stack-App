"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { initials, plural } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import { useToast } from "./AppProviders";
import { ShareIcon } from "./icons";
import { ellipsize, roundRect, saveImageFile, systemShare, wrap } from "./Share";
import ps from "./ProfileShare.module.css";
import sh from "./Share.module.css";

/** The share arrow in a profile's top bar. Opens the profile share sheet. */
export function ProfileShareButton(props: { profile: Profile; stackCount: number; own: boolean; onBlock?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={ps.barButton} onClick={() => setOpen(true)} aria-label="Share profile" title="Share profile">
        <ShareIcon size={20} color="var(--text)" />
      </button>
      {open && <ProfileShareSheet {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function ProfileShareSheet({
  profile,
  stackCount,
  own,
  onBlock,
  onClose,
}: {
  profile: Profile;
  stackCount: number;
  own: boolean;
  onBlock?: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const url = `${window.location.origin}/u/${profile.handle}`;
  const shortUrl = url.replace(/^https?:\/\//, "");
  const stacksLabel = plural(stackCount, "stack");

  const done = (message: string) => {
    onClose();
    toast(message);
  };

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      done("Profile link copied");
    } catch {
      toast("Couldn't copy the link");
    }
  }

  async function share() {
    const r = await systemShare({ title: `${profile.name} (@${profile.handle}) on Stack`, url });
    if (r === "unsupported") copy();
    else if (r === "failed") toast("Couldn't open sharing");
    else if (r === "shared") onClose();
  }

  async function saveImage() {
    try {
      const r = await saveImageFile(await renderProfileCard(profile, stacksLabel, shortUrl), `${profile.handle}-on-stack.png`);
      if (r === "downloaded") done("Image saved");
      else if (r === "shared") onClose();
      else if (r === "failed") toast("Couldn't save the image");
    } catch {
      toast("Couldn't save the image");
    }
  }

  async function logOut() {
    await createClient().auth.signOut();
    onClose();
    router.push("/");
    router.refresh();
  }

  return (
    <div className={sh.scrim} onClick={onClose}>
      <div className={ps.preview} onClick={(e) => e.stopPropagation()}>
        <div className={sh.card}>
          <div className={ps.cardBody}>
            <span className={ps.avatar}>{initials(profile.name)}</span>
            <div className={ps.name}>{profile.name}</div>
            <div className={ps.handle}>
              @{profile.handle} · {stacksLabel}
            </div>
            {profile.bio && <div className={ps.bio}>{profile.bio}</div>}
          </div>
          <div className={sh.footer}>
            <span className={sh.credit}>
              <span className={sh.curated}>
                Find <strong>@{profile.handle}</strong> on Stack
              </span>
              <span className={sh.url}>{shortUrl}</span>
            </span>
            <span className={sh.brand}>Stack</span>
          </div>
        </div>
      </div>
      <div className={`${sh.sheet} ${ps.sheet}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="ps-title">
        <div className={sh.grabber} />
        <div id="ps-title" className={ps.title}>
          Share profile
        </div>
        <div className={ps.actions}>
          <Action label="Copy link" onClick={copy}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="oklch(17.5% 0.006 80)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
              <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
            </svg>
          </Action>
          <Action label="Share" onClick={share}>
            <ShareIcon size={21} color="oklch(17.5% 0.006 80)" />
          </Action>
          <Action label="Save image" onClick={saveImage}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="oklch(17.5% 0.006 80)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 4v11" />
              <path d="M7.5 10.5L12 15l4.5-4.5" />
              <path d="M5 19.5h14" />
            </svg>
          </Action>
          <Action label="More" onClick={share}>
            <svg width="21" height="21" viewBox="0 0 24 24" fill="oklch(17.5% 0.006 80)" aria-hidden>
              <circle cx="5.5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="18.5" cy="12" r="1.8" />
            </svg>
          </Action>
        </div>
        {own && (
          <>
            <div className={ps.rule} />
            <button
              className={ps.row}
              onClick={() => {
                onClose();
                router.push("/settings");
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="oklch(19.4% 0.006 80)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3.5l7 3v5c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9v-5z" />
              </svg>
              <span className={ps.rowLabel}>Settings and privacy</span>
              <Chevron />
            </button>
            <button className={`${ps.row} ${ps.rowDivided}`} onClick={logOut}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M14 4.5H6.5v15H14" />
                <path d="M10.5 12H20" />
                <path d="M16.5 8.5L20 12l-3.5 3.5" />
              </svg>
              <span className={`${ps.rowLabel} ${ps.danger}`}>Log out</span>
            </button>
          </>
        )}
        {!own && onBlock && (
          <>
            <div className={ps.rule} style={{ margin: "18px 4px 16px" }} />
            <div className={ps.blockRow}>
              <Action
                label="Block"
                danger
                onClick={() => {
                  onClose();
                  onBlock();
                }}
              >
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2" strokeLinecap="round" aria-hidden>
                  <circle cx="12" cy="12" r="8" />
                  <path d="M6.5 6.5l11 11" />
                </svg>
              </Action>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Action({ label, onClick, danger, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button className={ps.action} onClick={onClick}>
      <span className={`${ps.actionIcon} ${danger ? ps.actionIconDanger : ""}`}>{children}</span>
      <span className={`${ps.actionLabel} ${danger ? ps.danger : ""}`}>{label}</span>
    </button>
  );
}

export function Chevron() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--muted-56)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9.5 5.5L16 12l-6.5 6.5" />
    </svg>
  );
}

/** Draws the profile card to a PNG, matching the sheet's card. */
async function renderProfileCard(profile: Profile, stacksLabel: string, shortUrl: string): Promise<Blob> {
  const W = 320;
  const scale = 3;
  const font = getComputedStyle(document.body).fontFamily;
  const mono = getComputedStyle(document.body).getPropertyValue("--mono") || "monospace";

  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `400 13px ${font}`;
  const bio = profile.bio ? wrap(measure, profile.bio.replace(/\s+/g, " "), 250).slice(0, 2) : [];
  const bodyH = 22 + 56 + 10 + 22 + 18 + (bio.length ? 10 + bio.length * 19.5 : 0) + 18;
  const footH = 52;
  const H = bodyH + footH;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const c = canvas.getContext("2d")!;
  c.scale(scale, scale);

  roundRect(c, 0, 0, W, H, 18);
  c.fillStyle = "oklch(98.4% 0.006 80)";
  c.fill();
  c.save();
  roundRect(c, 0, 0, W, H, 18);
  c.clip();
  c.textAlign = "center";

  let y = 22;
  c.beginPath();
  c.arc(W / 2, y + 28, 28, 0, Math.PI * 2);
  c.fillStyle = "oklch(64% 0.16 50)";
  c.fill();
  c.fillStyle = "oklch(99.6% 0.002 80)";
  c.font = `700 19px ${font}`;
  c.fillText(initials(profile.name), W / 2, y + 35);
  y += 56 + 10 + 17;

  c.fillStyle = "oklch(17.5% 0.006 80)";
  c.font = `800 18px ${font}`;
  c.fillText(ellipsize(c, profile.name, W - 40), W / 2, y);
  y += 20;
  c.fillStyle = "oklch(41.5% 0.006 80)";
  c.font = `400 12.5px ${font}`;
  c.fillText(ellipsize(c, `@${profile.handle} · ${stacksLabel}`, W - 40), W / 2, y);
  y += 10;
  c.fillStyle = "oklch(24.9% 0.006 80)";
  c.font = `400 13px ${font}`;
  for (const line of bio) {
    y += 19.5;
    c.fillText(line, W / 2, y);
  }

  c.textAlign = "left";
  c.fillStyle = "oklch(99% 0.006 80)";
  c.fillRect(0, bodyH, W, footH);
  c.strokeStyle = "oklch(90.7% 0.006 80)";
  c.setLineDash([4, 3]);
  c.beginPath();
  c.moveTo(0, bodyH + 0.5);
  c.lineTo(W, bodyH + 0.5);
  c.stroke();
  c.setLineDash([]);

  const cy = bodyH + footH / 2;
  c.font = `800 13px ${font}`;
  const brandW = c.measureText("Stack").width;
  c.fillStyle = "oklch(64% 0.16 50)";
  c.fillText("Stack", W - 20 - brandW, cy + 4);
  const maxW = W - 40 - brandW - 10;
  c.font = `400 12px ${font}`;
  c.fillStyle = "oklch(30.5% 0.006 80)";
  c.fillText(ellipsize(c, `Find @${profile.handle} on Stack`, maxW), 20, cy - 3);
  c.font = `400 10.5px ${mono}`;
  c.fillStyle = "oklch(64% 0.16 50)";
  c.fillText(ellipsize(c, shortUrl, maxW), 20, cy + 12);
  c.restore();

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png"));
}
