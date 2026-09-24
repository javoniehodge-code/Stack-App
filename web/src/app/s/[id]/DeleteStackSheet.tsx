"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useToast } from "@/components/AppProviders";
import sheet from "@/components/Sheet.module.css";
import { createClient } from "@/lib/supabase/client";
import s from "./Detail.module.css";

export default function DeleteStackSheet({ stackId, title, onClose }: { stackId: string; title: string; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    // RLS only lets authors delete their own stacks; an empty result means nothing was removed.
    const { data, error } = await createClient().from("stacks").delete().eq("id", stackId).select("id");
    if (error || !data?.length) {
      setBusy(false);
      setError("Couldn't delete this stack. Try again.");
      return;
    }
    toast("Stack deleted.");
    router.replace("/profile");
    router.refresh();
  }

  return (
    <div className={sheet.scrim} onClick={busy ? undefined : onClose}>
      <div className={sheet.sheet} onClick={(e) => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-labelledby="del-title" aria-describedby="del-msg">
        <div className={sheet.grabber} />
        <div id="del-title" className={sheet.title}>
          Delete this stack?
        </div>
        <div id="del-msg" className={sheet.message}>
          <span className={sheet.strong}>{title}</span> and its likes, saves and comments will be removed for everyone. This can&apos;t be undone.
        </div>
        {error && <div className={sheet.error}>{error}</div>}
        <button type="button" className={`${sheet.primary} ${s.danger}`} onClick={remove} disabled={busy}>
          {busy ? "Deleting…" : "Delete stack"}
        </button>
        <button type="button" className={sheet.secondary} onClick={onClose} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
