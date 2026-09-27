"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/AppProviders";
import sheet from "@/components/Sheet.module.css";
import { blockUser } from "@/lib/blocks";
import { setFollowing } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import s from "@/app/s/[id]/Detail.module.css";

export default function BlockSheet({ profile, onClose }: { profile: Profile; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function block() {
    setBusy(true);
    setError(null);
    const err = await blockUser(createClient(), profile.id);
    if (err) {
      setBusy(false);
      setError(err);
      return;
    }
    setFollowing(profile.id, false);
    toast(`Blocked @${profile.handle}`);
    router.replace("/");
    router.refresh();
  }

  return (
    <div className={sheet.scrim} onClick={busy ? undefined : onClose}>
      <div className={sheet.sheet} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="block-title" aria-describedby="block-msg">
        <div className={sheet.grabber} />
        <div id="block-title" className={sheet.title}>
          Block @{profile.handle}?
        </div>
        <div id="block-msg" className={sheet.message}>
          You won&apos;t see each other&apos;s profiles, stacks or comments anywhere on Stack, and any follows between you are removed. They won&apos;t be
          told. You can unblock them from Edit profile.
        </div>
        {error && <div className={sheet.error}>{error}</div>}
        <button type="button" className={`${sheet.primary} ${s.danger}`} onClick={block} disabled={busy}>
          {busy ? "Blocking…" : "Block"}
        </button>
        <button type="button" className={sheet.secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
