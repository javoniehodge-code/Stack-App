"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/AppProviders";
import { blockUser } from "@/lib/blocks";
import { setFollowing } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import b from "./Block.module.css";

/** "Block @handle?" confirmation, opened from the profile share sheet. */
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
    toast(`@${profile.handle} blocked`);
    router.replace("/");
    router.refresh();
  }

  return (
    <div className={b.scrim} onClick={busy ? undefined : onClose}>
      <div className={b.dialog} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="block-title" aria-describedby="block-msg">
        <div id="block-title" className={b.title}>
          Block @{profile.handle}?
        </div>
        <div id="block-msg" className={b.message}>
          They won&apos;t be able to see your stacks or find your profile, and you won&apos;t see theirs. They won&apos;t be notified.
        </div>
        {error && <div className={b.error}>{error}</div>}
        <button type="button" className={b.block} onClick={block} disabled={busy}>
          {busy ? "Blocking…" : "Block"}
        </button>
        <button type="button" className={b.cancel} onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
