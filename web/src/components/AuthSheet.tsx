"use client";

import { useState } from "react";
import { PROFILE_SELECT } from "@/lib/queries";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";
import styles from "./Sheet.module.css";

type Step = "signin" | "signup" | "verify" | "forgot" | "reset";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HANDLE_RE = /^[a-z0-9._]{2,30}$/;
const MIN_PASSWORD = 8;

// Sign in with email or username + password. New accounts confirm their email
// once with a 6-digit code. Everything happens in this sheet, so whatever the
// viewer was doing (a draft, a like) survives signing in.
export default function AuthSheet({
  message,
  onCancel,
  onSignedIn,
}: {
  message: string;
  onCancel: () => void;
  onSignedIn: (p: Profile) => void;
}) {
  const sb = createClient();
  const [step, setStep] = useState<Step>("signin");
  const [identifier, setIdentifier] = useState("");
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const go = (s: Step) => {
    setStep(s);
    setError(null);
    setNotice(null);
    setCode("");
    setPassword("");
  };

  async function finish() {
    const { data } = await sb.auth.getUser();
    if (!data.user) {
      setError("Signed in, but the session couldn't be loaded. Try again.");
      return;
    }
    const { data: profile } = await sb.from("profiles").select(PROFILE_SELECT).eq("id", data.user.id).single();
    if (profile) onSignedIn(profile as Profile);
    else setError("Signed in, but your profile couldn't be loaded.");
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
    } catch {
      setError("Something went wrong. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const signIn = (e: React.FormEvent) => {
    e.preventDefault();
    const id = identifier.trim();
    if (!id || !password) return setError("Enter your email or username and your password.");
    run(async () => {
      if (id.includes("@")) {
        const { error } = await sb.auth.signInWithPassword({ email: id, password });
        if (error?.code === "email_not_confirmed") {
          setEmail(id);
          await sb.auth.resend({ type: "signup", email: id });
          go("verify");
          setNotice("Your email isn't confirmed yet. We sent you a new code.");
          return;
        }
        if (error) return setError("Wrong email or password.");
      } else {
        const res = await fetch("/auth/sign-in", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ username: id, password }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          return setError(body?.error ?? "Wrong username or password.");
        }
      }
      await finish();
    });
  };

  const signUp = (e: React.FormEvent) => {
    e.preventDefault();
    const h = handle.trim().replace(/^@/, "").toLowerCase();
    const addr = email.trim();
    if (!name.trim()) return setError("Add your name.");
    if (!HANDLE_RE.test(h)) return setError("Usernames are 2–30 characters: letters, numbers, dots and underscores.");
    if (!EMAIL_RE.test(addr)) return setError("Enter a valid email address.");
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    run(async () => {
      const { data: taken } = await sb.from("profiles").select("id").eq("handle", h).maybeSingle();
      if (taken) return setError("That username is taken.");
      const { data, error } = await sb.auth.signUp({ email: addr, password, options: { data: { name: name.trim(), handle: h } } });
      if (error) return setError(error.message);
      // Supabase hides whether an email is registered; an existing account comes back with no identities.
      if (data.user && data.user.identities?.length === 0) return setError("There's already an account with that email. Sign in instead.");
      if (data.session) return finish();
      setEmail(addr);
      setStep("verify");
      setCode("");
    });
  };

  const verify = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "signup" });
      if (error) return setError("That code didn't work. Check it, or send a new one.");
      await finish();
    });
  };

  const resend = () =>
    run(async () => {
      const { error } = await sb.auth.resend({ type: "signup", email: email.trim() });
      if (error) setError(error.message);
      else setNotice("We sent a new code.");
    });

  const sendReset = (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) return setError("Enter the email you signed up with.");
    run(async () => {
      const { error } = await sb.auth.resetPasswordForEmail(addr);
      if (error) return setError(error.message);
      setStep("reset");
      setCode("");
      setPassword("");
    });
  };

  const reset = (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for your password.`);
    run(async () => {
      const { error } = await sb.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "recovery" });
      if (error) return setError("That code didn't work. Check it, or request a new one.");
      const { error: upd } = await sb.auth.updateUser({ password });
      if (upd) return setError(upd.message);
      await finish();
    });
  };

  const codeInput = (
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
  );
  const feedback = (
    <>
      {error && <div className={styles.error}>{error}</div>}
      {notice && <div className={styles.notice}>{notice}</div>}
    </>
  );

  return (
    <div className={styles.scrim} onClick={onCancel}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className={styles.grabber} />

        {step === "signin" && (
          <form onSubmit={signIn}>
            <div id="auth-title" className={styles.title}>
              Sign in to continue
            </div>
            <div className={styles.message}>{message}</div>
            <input
              className={styles.input}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="Email or username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoFocus
              aria-label="Email or username"
            />
            <input
              className={styles.input}
              type="password"
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Password"
            />
            {feedback}
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => {
                if (identifier.includes("@")) setEmail(identifier.trim());
                go("forgot");
              }}
            >
              Forgot password?
            </button>
            <button type="button" className={styles.switch} onClick={() => go("signup")}>
              New to Stack? <strong>Create an account</strong>
            </button>
          </form>
        )}

        {step === "signup" && (
          <form onSubmit={signUp}>
            <div id="auth-title" className={styles.title}>
              Create your account
            </div>
            <div className={styles.message}>{message}</div>
            <input className={styles.input} autoComplete="name" placeholder="Name" maxLength={50} value={name} onChange={(e) => setName(e.target.value)} autoFocus aria-label="Name" />
            <input
              className={styles.input}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              placeholder="Username"
              maxLength={31}
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              aria-label="Username"
            />
            <input className={styles.input} type="email" autoComplete="email" inputMode="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <input
              className={styles.input}
              type="password"
              autoComplete="new-password"
              placeholder={`Password (${MIN_PASSWORD}+ characters)`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="Password"
            />
            {feedback}
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? "Creating account…" : "Create account"}
            </button>
            <button type="button" className={styles.switch} onClick={() => go("signin")}>
              Already have an account? <strong>Sign in</strong>
            </button>
          </form>
        )}

        {step === "verify" && (
          <form onSubmit={verify}>
            <div id="auth-title" className={styles.title}>
              Confirm your email
            </div>
            <div className={styles.message}>
              We sent a 6-digit code to <strong className={styles.strong}>{email.trim()}</strong>. Enter it to finish creating your account.
            </div>
            {codeInput}
            {feedback}
            <button type="submit" className={styles.primary} disabled={busy || code.length < 6}>
              {busy ? "Checking…" : "Confirm"}
            </button>
            <button type="button" className={styles.secondary} onClick={resend} disabled={busy}>
              Send a new code
            </button>
          </form>
        )}

        {step === "forgot" && (
          <form onSubmit={sendReset}>
            <div id="auth-title" className={styles.title}>
              Reset your password
            </div>
            <div className={styles.message}>Enter the email you signed up with and we&apos;ll send you a code.</div>
            <input className={styles.input} type="email" autoComplete="email" inputMode="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus aria-label="Email" />
            {feedback}
            <button type="submit" className={styles.primary} disabled={busy}>
              {busy ? "Sending…" : "Send code"}
            </button>
            <button type="button" className={styles.secondary} onClick={() => go("signin")}>
              Back to sign in
            </button>
          </form>
        )}

        {step === "reset" && (
          <form onSubmit={reset}>
            <div id="auth-title" className={styles.title}>
              Choose a new password
            </div>
            <div className={styles.message}>
              Enter the code we sent to <strong className={styles.strong}>{email.trim()}</strong> and your new password.
            </div>
            {codeInput}
            <input
              className={styles.input}
              type="password"
              autoComplete="new-password"
              placeholder={`New password (${MIN_PASSWORD}+ characters)`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-label="New password"
            />
            {feedback}
            <button type="submit" className={styles.primary} disabled={busy || code.length < 6}>
              {busy ? "Saving…" : "Save and sign in"}
            </button>
            <button type="button" className={styles.secondary} onClick={() => go("forgot")}>
              Send a new code
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
