"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AppProviders";
import shell from "@/components/AppShell.module.css";
import { Chevron } from "@/components/ProfileShare";
import { fetchMyBlocks } from "@/lib/blocks";
import { createClient } from "@/lib/supabase/client";
import EditProfileSheet from "../profile/EditProfileSheet";
import p from "../profile/Profile.module.css";
import SettingsHeader from "./SettingsHeader";
import s from "./Settings.module.css";

export default function SettingsScreen() {
  const router = useRouter();
  const { viewer, requireAuth } = useAuth();
  const [editing, setEditing] = useState(false);
  const [blocked, setBlocked] = useState<number | null>(null);

  useEffect(() => {
    if (!viewer) return;
    fetchMyBlocks(createClient()).then((list) => setBlocked(list.length));
  }, [viewer]);

  if (!viewer) {
    return (
      <main className={`${shell.screen} ${p.gate}`}>
        <h1 className={p.gateTitle}>Sign in to change your settings</h1>
        <button className={p.gateButton} onClick={() => requireAuth(null, "Sign in to change your settings.")}>
          Sign in / Create account
        </button>
      </main>
    );
  }

  async function logOut() {
    await createClient().auth.signOut();
    router.push("/");
    router.refresh();
  }

  return (
    <main className={shell.screen}>
      <SettingsHeader title="Settings and privacy" />
      <div className={s.scroll}>
        <div className={s.section}>Account</div>
        <div className={s.group}>
          <button className={s.row} onClick={() => setEditing(true)}>
            <span className={s.rowLabel}>Edit profile</span>
            <Chevron />
          </button>
        </div>
        <div className={s.section}>Privacy</div>
        <div className={s.group}>
          <Link href="/settings/blocked" className={s.row}>
            <span className={s.rowLabel}>Blocked accounts</span>
            {!!blocked && <span className={s.rowValue}>{blocked}</span>}
            <Chevron />
          </Link>
        </div>
        <button className={s.logOut} onClick={logOut}>
          Log out
        </button>
      </div>
      {editing && <EditProfileSheet onClose={() => setEditing(false)} />}
    </main>
  );
}
