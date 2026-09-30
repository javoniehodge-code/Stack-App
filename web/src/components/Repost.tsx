"use client";

import { useState } from "react";
import { MAX_REPOST_NOTE } from "@/lib/format";
import { useEngagement, type Engagement } from "@/lib/store";
import type { Stack } from "@/lib/types";
import { useStackActions } from "@/lib/useStackActions";
import { useAuth, useToast } from "./AppProviders";
import sheet from "./Sheet.module.css";
import r from "./Repost.module.css";

export function RepostGlyph({ size = 16, color = "var(--muted-66)", width = 2 }: { size?: number; color?: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </svg>
  );
}

/** The ↻ count in an action row; opens the repost sheet. Your own stacks show the count only. */
export function RepostButton({ stack, className, size = 16, count }: { stack: Stack; className: string; size?: number; count: (n: number) => string }) {
  const e = useEngagement(stack);
  const { viewer, requireAuth } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const color = e.reposted ? "var(--accent)" : "var(--muted-66)";
  return (
    <>
      <button
        className={className}
        style={{ color }}
        aria-pressed={e.reposted}
        aria-label={e.reposted ? "Reposted" : "Repost"}
        onClick={() => {
          if (viewer?.id === stack.author.id) return toast("You can't repost your own stack.");
          requireAuth(() => setOpen(true), "Sign in to repost stacks to your profile.");
        }}
      >
        <RepostGlyph size={size} color={color} />
        {count(e.reposts)}
      </button>
      {open && <RepostSheet stack={stack} e={e} onClose={() => setOpen(false)} />}
    </>
  );
}

function RepostSheet({ stack, e, onClose }: { stack: Stack; e: Engagement; onClose: () => void }) {
  const a = useStackActions();
  const [mode, setMode] = useState<"plain" | "note">("plain");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(p: Promise<boolean>) {
    setBusy(true);
    const ok = await p;
    setBusy(false);
    if (ok) onClose();
  }

  return (
    <div className={sheet.scrim} onClick={onClose}>
      <div className={`${sheet.sheet} ${r.sheet}`} onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-label="Repost">
        <div className={sheet.grabber} />
        <div className={r.context}>
          {stack.title} · by @{stack.author.handle}
        </div>
        {e.reposted ? (
          <>
            <div className={r.already}>
              You reposted this
              {e.repostNote ? (
                <>
                  {" "}
                  with a note: “{e.repostNote}”
                </>
              ) : (
                "."
              )}
            </div>
            <button className={r.undo} disabled={busy} onClick={() => run(a.undoRepost(stack.id, e))}>
              Undo repost
            </button>
          </>
        ) : (
          <>
            <button className={`${r.option} ${mode === "plain" ? r.optionOn : ""}`} aria-pressed={mode === "plain"} onClick={() => setMode("plain")}>
              <span className={r.optionIcon}>
                <RepostGlyph size={18} color="oklch(54% 0.16 45)" />
              </span>
              <span className={r.optionText}>
                <span className={r.optionTitle}>Repost</span>
                <span className={r.optionSub}>Add to your Reposts tab</span>
              </span>
            </button>
            <div className={`${r.option} ${r.noteOption} ${mode === "note" ? r.optionOn : ""}`}>
              <button className={r.optionHead} aria-pressed={mode === "note"} onClick={() => setMode("note")}>
                <span className={r.optionIcon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="oklch(54% 0.16 45)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M4 5h16v11H9l-5 4z" />
                  </svg>
                </span>
                <span className={r.optionText}>
                  <span className={r.optionTitle}>Repost with a note</span>
                  <span className={r.optionSub}>Say why it&apos;s worth a look</span>
                </span>
              </button>
              {mode === "note" && (
                <>
                  <textarea
                    className={r.note}
                    value={note}
                    maxLength={MAX_REPOST_NOTE}
                    rows={2}
                    autoFocus
                    onChange={(ev) => setNote(ev.target.value)}
                    placeholder="What makes this one good?"
                    aria-label="Note"
                  />
                  <div className={r.count} style={{ color: note.length >= MAX_REPOST_NOTE - 30 ? "oklch(54% 0.16 45)" : undefined }}>
                    {note.length} / {MAX_REPOST_NOTE}
                  </div>
                </>
              )}
            </div>
            <button className={r.confirm} disabled={busy} onClick={() => run(a.repost(stack.id, e, mode === "note" ? note : ""))}>
              Repost
            </button>
          </>
        )}
      </div>
    </div>
  );
}
