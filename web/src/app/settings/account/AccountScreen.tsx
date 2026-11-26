"use client";

import type { UserIdentity } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { useAuth, useToast } from "@/components/AppProviders";
import shell from "@/components/AppShell.module.css";
import { GoogleIcon } from "@/components/icons";
import { createClient } from "@/lib/supabase/client";
import p from "../../profile/Profile.module.css";
import SettingsHeader from "../SettingsHeader";
import s from "../Settings.module.css";

// What /auth/callback reports after Connect Google (?google=<result>).
const CONNECT_RESULT: Record<string, { msg: string }> = {
  connected: { msg: "Google connected · same account, same profile" },
  cancelled: { msg: "" },
  taken: { msg: "That Google account already signs in to a different Stack account." },
  failed: { msg: "Couldn’t connect Google. Try again." },
};

/**
 * Account and sign-in (spec: Settings, D-8): the account email and the ways to sign in. Connect Google links a
 * Google account to this account while signed in, so Continue with Google opens it even when Google reports the
 * address differently (for example a Gmail address without its dots). Linking needs both proofs: this account's
 * session and a sign-in on Google's own page.
 */
export default function AccountScreen() {
  const { viewer, requireAuth } = useAuth();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [google, setGoogle] = useState<UserIdentity | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!viewer) return;
    const sb = createClient();
    sb.auth.getUser().then(({ data }) => {
      setEmail(data.user?.email ?? "");
      setGoogle(data.user?.identities?.find((i) => i.provider === "google") ?? null);
    });
  }, [viewer]);

  // Back from Google: say how connecting went, then drop the result from the address.
  useEffect(() => {
    const url = new URL(window.location.href);
    const result = url.searchParams.get("google");
    if (!result) return;
    url.searchParams.delete("google");
    window.history.replaceState(window.history.state, "", url.pathname + url.search + url.hash);
    const r = CONNECT_RESULT[result] ?? CONNECT_RESULT.failed;
    // Errors stay up longer (a toast with a button does), so there's time to read them.
    if (result === "connected") toast(r.msg);
    else if (r.msg) toast(r.msg, { label: "OK", run: () => {} });
  }, [toast]);

  if (!viewer) {
    return (
      <main className={`${shell.screen} ${p.gate}`}>
        <h1 className={p.gateTitle}>Sign in to see your account</h1>
        <button className={p.gateButton} onClick={() => requireAuth(null, "Sign in to change your settings.")}>
          Sign in / Create account
        </button>
      </main>
    );
  }

  async function connectGoogle() {
    if (busy) return;
    setBusy(true);
    setError("");
    const { error } = await createClient().auth.linkIdentity({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?mode=link&next=${encodeURIComponent("/settings/account")}` },
    });
    // On success the browser is on its way to Google.
    if (error) {
      setBusy(false);
      setError("Couldn’t reach Google. Check your connection and try again.");
    }
  }

  const googleEmail = typeof google?.identity_data?.email === "string" ? google.identity_data.email : "";

  return (
    <main className={shell.screen}>
      <SettingsHeader title="Account and sign-in" />
      <div className={s.scroll}>
        <div className={s.section}>Account email</div>
        <div className={s.group}>
          <div className={s.row}>
            <span className={s.rowLabel}>{email || " "}</span>
            {email && <span className={s.verified}>✓ Verified</span>}
          </div>
        </div>
        <div className={s.section}>Ways to sign in</div>
        <div className={s.group}>
          <div className={s.row}>
            <span className={s.methodIcon} aria-hidden="true">
              <GoogleIcon />
            </span>
            <span className={s.method}>
              <span className={s.methodName}>Google</span>
              <span className={s.methodSub}>{google ? googleEmail || "Connected" : "Sign in with your Google account"}</span>
            </span>
            {google === undefined ? null : google ? (
              <span className={s.connected}>Connected</span>
            ) : (
              <button type="button" className={s.connect} onClick={connectGoogle} disabled={busy}>
                {busy ? "Connecting…" : "Connect"}
              </button>
            )}
          </div>
          <div className={s.row}>
            <span className={s.methodIcon} aria-hidden="true">
              ✉️
            </span>
            <span className={s.method}>
              <span className={s.methodName}>Email code</span>
              <span className={s.methodSub}>A 6-digit code sent to your account email</span>
            </span>
            <span className={s.rowValue}>Always on</span>
          </div>
        </div>
        {error && (
          <div role="alert" className={s.alert}>
            {error}
          </div>
        )}
        <p className={s.note}>Both open this same account. Signing in with either never creates a second profile.</p>
      </div>
    </main>
  );
}
