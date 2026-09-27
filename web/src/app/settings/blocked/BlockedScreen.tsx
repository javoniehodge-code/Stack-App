"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth, useToast } from "@/components/AppProviders";
import shell from "@/components/AppShell.module.css";
import { type BlockedAccount, fetchMyBlocks, unblockUser } from "@/lib/blocks";
import { initials } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";
import SettingsHeader from "../SettingsHeader";
import s from "../Settings.module.css";

export default function BlockedScreen() {
  const router = useRouter();
  const toast = useToast();
  const { viewer } = useAuth();
  const [people, setPeople] = useState<BlockedAccount[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!viewer) return;
    fetchMyBlocks(createClient()).then(setPeople);
  }, [viewer]);

  async function unblock(person: BlockedAccount) {
    setBusy(person.id);
    const err = await unblockUser(createClient(), person.id);
    setBusy(null);
    if (err) return toast(err);
    setPeople((list) => (list ?? []).filter((x) => x.id !== person.id));
    toast(`@${person.handle} unblocked`);
    router.refresh();
  }

  return (
    <main className={shell.screen}>
      <SettingsHeader title="Blocked accounts" />
      <div className={s.scroll} style={{ paddingTop: 12 }}>
        {viewer && people === null && <div className={s.empty}>Loading…</div>}
        {(!viewer || people?.length === 0) && (
          <div className={s.empty}>You haven&apos;t blocked anyone. Block someone from the share menu on their profile.</div>
        )}
        {people?.map((person) => (
          <div key={person.id} className={s.person}>
            <span className={s.personAvatar}>{initials(person.name)}</span>
            <span className={s.personNames}>
              <span className={s.personName}>{person.name}</span>
              <span className={s.personHandle}>@{person.handle}</span>
            </span>
            <button className={s.unblock} disabled={busy === person.id} onClick={() => unblock(person)}>
              Unblock
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
