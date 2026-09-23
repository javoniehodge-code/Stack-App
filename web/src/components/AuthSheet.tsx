"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import styles from "./Sheet.module.css";

// Passwordless sign-in: email a 6-digit code, then verify it in place, so
// whatever the viewer was doing (a draft, a like) survives signing in.
export default function AuthSheet({
  message,
  onCancel,
  onSignedIn,
}: {
  message: string;
  onCancel: () => void;
  onSignedIn: (p: Profile) => void;
}) {
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sb = createClient();

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault();
    const addr = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) {
      setError("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error } = await sb.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: true } });
    setBusy(false);
    if (error) setError(error.message);
    else setStep("code");
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { data, error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    if (error || !data.user) {
      setBusy(false);
      setError(error?.message ?? "That code didn't work. Try again.");
      return;
    }
    const { data: profile } = await sb.from("profiles").select("id,handle,name,bio").eq("id", data.user.id).single();
    setBusy(false);
    if (profile) onSignedIn(profile as Profile);
    else setError("Signed in, but your profile couldn't be loaded.");
  }

  return (
    <div className={styles.scrim} onClick={onCancel}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className={styles.grabber} />
        <div id="auth-title" className={styles.title}>
          Sign in to continue
        </div>
        {step === "email" ? (
          <form onSubmit={sendCode}>
            <div className={styles.message}>{message}</div>
            <input
              className={styles.input}
              type="email"
              autoComplete="email"
              inputMode="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              aria-label="Email"
            />
            {error && <div className={styles.error}>{error}</div>}
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? "Sending…" : "Sign in / Create account"}
            </button>
          </form>
        ) : (
          <form onSubmit={verify}>
            <div className={styles.message}>
              We sent a 6-digit code to <strong className={styles.strong}>{email.trim()}</strong>. Enter it to continue.
            </div>
            <input
              className={`${styles.input} ${styles.code}`}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              autoFocus
              aria-label="Code"
            />
            {error && <div className={styles.error}>{error}</div>}
            <button type="submit" className={styles.primary} disabled={busy || code.length < 6}>
              {busy ? "Checking…" : "Verify"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}
        <button type="button" className={styles.secondary} onClick={onCancel}>
          Not now
        </button>
      </div>
    </div>
  );
}
