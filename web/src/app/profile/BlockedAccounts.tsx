"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useToast } from "@/components/AppProviders";
import sheet from "@/components/Sheet.module.css";
import { type BlockedAccount, fetchMyBlocks, unblockUser } from "@/lib/blocks";
import { initials } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import p from "./Profile.module.css";

/** The Blocked accounts view inside Edit profile. */
export default function BlockedAccounts({ onBack }: { onBack: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [people, setPeople] = useState<BlockedAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetchMyBlocks(createClient()).then(setPeople);
  }, []);

  async function unblock(person: BlockedAccount) {
    setBusy(person.id);
    const err = await unblockUser(createClient(), person.id);
    setBusy(null);
    if (err) return toast(err);
    setPeople((list) => (list ?? []).filter((x) => x.id !== person.id));
    toast(`Unblocked @${person.handle}`);
    router.refresh();
  }

  return (
    <>
      <div className={p.blockedHead}>
        <button type="button" className={p.blockedBack} onClick={onBack}>
          ‹ Edit profile
        </button>
      </div>
      <div className={sheet.title} style={{ marginBottom: 6 }}>
        Blocked accounts
      </div>
      <div className={p.socialHint}>You and the people you block can&apos;t see each other&apos;s profiles, stacks or comments.</div>
      {people === null && <div className={p.blockedEmpty}>Loading…</div>}
      {people?.length === 0 && <div className={p.blockedEmpty}>You haven&apos;t blocked anyone.</div>}
      {people?.map((person) => (
        <div key={person.id} className={p.blockedRow}>
          <span className={p.blockedAvatar}>{initials(person.name)}</span>
          <span className={p.blockedNames}>
            <span className={p.blockedName}>{person.name}</span>
            <span className={p.blockedHandle}>@{person.handle}</span>
          </span>
          <button type="button" className={p.unblock} disabled={busy === person.id} onClick={() => unblock(person)}>
            Unblock
          </button>
        </div>
      ))}
    </>
  );
}
