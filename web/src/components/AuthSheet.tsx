"use client";

import { createClient as createSupabaseClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { normalizeHandle, handleProblem } from "@/lib/handles";
import { fetchProfile } from "@/lib/queries";
import { createClient } from "@/lib/supabase/client";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";
import type { Profile } from "@/lib/types";
import { useToast } from "./AppProviders";
import s from "./AuthSheet.module.css";

type Step = "start" | "email" | "code" | "profile";
type HandleState = { state: "idle" | "bad" | "checking" | "ok"; msg: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_AFTER_MS = 30_000;
const MAX_TRIES = 5;
const NAME_MAX = 40;
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * A Supabase client for one sign-in attempt. It keeps the session in memory only, so a verification that
 * finishes after the attempt was cancelled or replaced never signs the app in. The app's own client adopts the
 * session only once the attempt succeeds and is still the current one.
 */
const attemptClient = () =>
  createSupabaseClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `stack-attempt-${crypto.randomUUID()}` },
  });

// One screen for signing in and creating an account (spec Flow 10): email, a 6-digit code, and for a new
// account a display name and username.
//
// Every sheet belongs to one sign-in attempt. `isCurrent` says whether that attempt is still the open one;
// `onSignedIn` completes it (runs its pending action once) and returns false if it was already cancelled or
// replaced. Results that arrive for a stale attempt are dropped, and their session is revoked.
export default function AuthSheet({
  message,
  isCurrent,
  onCancel,
  onSignedIn,
}: {
  message: string;
  isCurrent: () => boolean;
  onCancel: () => void;
  onSignedIn: (p: Profile) => boolean;
}) {
  const sb = createClient();
  const toast = useToast();
  const [client] = useState(attemptClient);
  // Which client holds this attempt's session: the attempt's own, or (for an account the app already had
  // signed in without a profile) the app's.
  const owner = useRef<SupabaseClient>(client);
  const adopted = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [tries, setTries] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  // Server answer for a username: whether it's free (null while unknown, for example after a network error).
  const [avail, setAvail] = useState<{ handle: string; free: boolean | null } | null>(null);
  const [verifiedEmail, setVerifiedEmail] = useState("");
  const [busy, setBusy] = useState<null | "sending" | "checking" | "creating">(null);
  const [formError, setFormError] = useState("");

  /** Ends this attempt's session on the server without touching the app's (other devices stay signed in). */
  const revoke = () => {
    if (!adopted.current) owner.current.auth.signOut({ scope: "local" }).catch(() => {});
  };

  /** Signs the app in with this attempt's session and completes the attempt, or revokes it if it's stale. */
  async function complete(profile: Profile, session: Session | null) {
    if (!isCurrent()) return revoke();
    if (session && owner.current === client) {
      const { error } = await sb.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token });
      if (error) {
        setFormError("Signed in, but the session couldn’t be saved. Try again.");
        return;
      }
    }
    adopted.current = true;
    // Cancelled or replaced while the session was being saved: undo it.
    if (!onSignedIn(profile)) sb.auth.signOut({ scope: "local" }).catch(() => {});
  }

  // Closing the sheet (or replacing it) without finishing never leaves a session behind.
  useEffect(() => () => revoke(), []);

  // The app has a session for an account that never finished setting up a profile: continue at that step.
  // (Sign-ins from this sheet don't leave one behind, but older sessions might.)
  useEffect(() => {
    let live = true;
    sb.auth.getUser().then(async ({ data }) => {
      if (!live || !data.user) return;
      const p = await fetchProfile(sb, "id", data.user.id);
      if (!live) return;
      owner.current = sb;
      if (p) return complete(p, null);
      setVerifiedEmail(data.user.email ?? "");
      setStep("profile");
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes; Tab and Shift+Tab stay inside the sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onCancel();
      if (e.key !== "Tab" || !dialog.current) return;
      const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) {
        e.preventDefault();
        dialog.current.focus();
        return;
      }
      const first = items[0], last = items[items.length - 1];
      const inside = dialog.current.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first || document.activeElement === dialog.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // While checking a code there's nothing to focus, so the sheet itself holds focus.
  useEffect(() => {
    if (busy === "checking") dialog.current?.focus();
  }, [busy]);

  // Ticks the resend countdown.
  useEffect(() => {
    if (step !== "code" || now > resendAt) return;
    const t = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(t);
  }, [step, now, resendAt]);
  const resendLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));

  async function sendCode(isResend = false) {
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) return setEmailError(addr ? "That email doesn’t look right." : "Enter your email.");
    setBusy("sending");
    setEmailError("");
    setCodeError("");
    try {
      const { error } = await client.auth.signInWithOtp({ email: addr, options: { shouldCreateUser: true } });
      if (!isCurrent()) return;
      if (error) {
        const msg =
          error.status === 429 || error.code === "over_email_send_rate_limit"
            ? "Too many codes requested. Wait a minute, then try again."
            : "Couldn’t send a code. Check your connection and try again.";
        if (isResend) setCodeError(msg);
        else setEmailError(msg);
        return;
      }
      setCode("");
      setTries(0);
      setResendAt(Date.now() + RESEND_AFTER_MS);
      setNow(Date.now());
      setStep("code");
      if (isResend) toast(`New code sent to ${addr}`);
    } catch {
      if (isCurrent()) (isResend ? setCodeError : setEmailError)("Couldn’t send a code. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function verify(token: string) {
    if (busy) return;
    setBusy("checking");
    setCodeError("");
    try {
      const { data, error } = await client.auth.verifyOtp({ email: email.trim(), token, type: "email" });
      // Cancelled or replaced while the code was being checked: drop the result and end its session.
      if (!isCurrent()) return revoke();
      if (error || !data.user) {
        setCode("");
        // A dropped connection or server error isn't a wrong guess, so it doesn't count as a try.
        if (error?.name === "AuthRetryableFetchError" || (error?.status ?? 0) >= 500) {
          setCodeError("Couldn’t check the code. Check your connection and try again.");
          return;
        }
        const n = tries + 1;
        setTries(n);
        // Supabase answers the same way for a wrong code and an expired one.
        if (n >= MAX_TRIES) setCodeError("Too many tries. Send a new code.");
        else setCodeError("That code isn’t right or has expired. Check the email and try again, or send a new code.");
        return;
      }
      const profile = await fetchProfile(client, "id", data.user.id);
      if (!isCurrent()) return revoke();
      if (profile) return await complete(profile, data.session);
      setVerifiedEmail(data.user.email ?? email.trim());
      setStep("profile");
    } catch {
      if (isCurrent()) setCodeError("Couldn’t check the code. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const onCode = (v: string) => {
    if (tries >= MAX_TRIES) return;
    const c = v.replace(/\D/g, "").slice(0, 6);
    setCode(c);
    setCodeError("");
    if (c.length === 6) verify(c);
  };

  // Checks the username as it's typed: the rules here, availability on the server.
  const problem = handleProblem(handle);
  useEffect(() => {
    if (step !== "profile" || problem) return;
    let live = true;
    const t = setTimeout(async () => {
      const { data, error } = await owner.current.rpc("handle_available", { p_handle: handle });
      if (live) setAvail({ handle, free: error ? null : !!data });
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [handle, step, problem]);
  const handleState: HandleState = problem
    ? { state: handle ? "bad" : "idle", msg: problem }
    : avail?.handle !== handle
      ? { state: "checking", msg: "Checking…" }
      : avail.free === false
        ? { state: "bad", msg: `@${handle} is taken. Try another.` }
        : { state: avail.free ? "ok" : "idle", msg: `Your profile will be stack.app/${handle}` };

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    const nm = name.trim();
    if (!nm) return setFormError("Add a display name.");
    if (problem || handleState.state === "bad") return;
    setBusy("creating");
    setFormError("");
    try {
      const db = owner.current;
      const { data, error } = await db.rpc("create_profile", { p_name: nm, p_handle: handle });
      // Cancelled or replaced meanwhile: the profile may exist now, but this attempt doesn't sign in.
      if (!isCurrent()) return revoke();
      if (error) {
        if (error.hint === "handle_taken" || error.hint === "handle_reserved" || error.hint === "handle_invalid") setAvail({ handle, free: false });
        else if (error.hint === "name") setFormError("Use 1–50 characters for your name.");
        else setFormError("Couldn’t create your account. Check your connection and try again.");
        return;
      }
      const p = await fetchProfile(db, "id", (data as { id: string }).id);
      if (!isCurrent()) return revoke();
      if (!p) return setFormError("Your account was created, but it couldn’t be loaded. Try again.");
      const { data: sess } = await db.auth.getSession();
      await complete(p, sess.session);
    } catch {
      if (isCurrent()) setFormError("Couldn’t create your account. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  const back = () => {
    setStep(step === "code" ? "email" : "start");
    setCode("");
    setCodeError("");
  };
  const backButton = (
    <button type="button" className={s.back} onClick={back} aria-label="Back">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14.5 5.5L8 12l6.5 6.5" />
      </svg>
    </button>
  );
  const canCreate = !!name.trim() && handleState.state === "ok" && !busy;


  return (
    <div className={s.scrim} onClick={onCancel}>
      <div ref={dialog} tabIndex={-1} className={s.sheet} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className={s.grabber} aria-hidden="true" />

        {busy === "checking" ? (
          <div className={s.busy} role="status">
            <span aria-hidden="true" className={s.bounce}>
              ✉️
            </span>
            <div className={s.busyLabel} id="auth-title">
              Checking your code…
            </div>
          </div>
        ) : step === "start" ? (
          <>
            <div className={s.badgeWrap}>
              <span aria-hidden="true" className={s.badge}>
                🎉
              </span>
            </div>
            <h2 id="auth-title" className={`${s.title} ${s.center}`}>
              Sign in or join stack
            </h2>
            <p className={`${s.text} ${s.center}`}>{message}</p>
            <button type="button" className={s.primary} onClick={() => setStep("email")} autoFocus>
              <span aria-hidden="true">✉️</span>
              <span>Continue with email</span>
            </button>
            <p className={s.fine}>New here? We’ll set up your account. Already have one? You’ll go straight in.</p>
            <button type="button" className={s.quiet} onClick={onCancel}>
              Not now
            </button>
          </>
        ) : step === "email" ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendCode();
            }}
            noValidate
          >
            {backButton}
            <h2 id="auth-title" className={s.title}>
              What’s your email?
            </h2>
            <p className={s.text}>We’ll send you a 6-digit code. No password needed.</p>
            <input
              className={`${s.field} ${emailError ? s.fieldBad : ""}`}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              placeholder="you@example.com"
              aria-label="Email address"
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "auth-email-error" : undefined}
              value={email}
              maxLength={120}
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError("");
              }}
              autoFocus
            />
            {emailError && (
              <div id="auth-email-error" role="alert" className={s.error}>
                {emailError}
              </div>
            )}
            <button type="submit" className={s.primary} style={{ marginTop: 18 }} disabled={busy === "sending"} aria-disabled={!email.trim()}>
              {busy === "sending" ? "Sending…" : "Send code"}
            </button>
          </form>
        ) : step === "code" ? (
          <div>
            {backButton}
            <h2 id="auth-title" className={s.title}>
              Check your email
            </h2>
            <p className={s.text}>
              Enter the 6-digit code we sent to <b className={s.strong}>{email.trim()}</b>.
            </p>
            <label className={s.codeWrap}>
              <input
                className={s.codeInput}
                value={code}
                onChange={(e) => onCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                aria-label="6-digit code"
                aria-invalid={!!codeError}
                aria-describedby={codeError ? "auth-code-error" : undefined}
                disabled={tries >= MAX_TRIES}
                autoFocus
              />
              <span aria-hidden="true" className={s.boxes}>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={`${s.box} ${codeError ? s.boxBad : i === code.length ? s.boxNext : ""} ${code[i] ? s.boxFilled : ""}`}>
                    {code[i] ?? ""}
                  </span>
                ))}
              </span>
            </label>
            {codeError && (
              <div id="auth-code-error" role="alert" className={s.error}>
                {codeError}
              </div>
            )}
            <div className={s.row}>
              <button type="button" className={s.link} disabled={resendLeft > 0 || busy === "sending"} onClick={() => sendCode(true)}>
                {resendLeft > 0 ? `Resend code in ${resendLeft}s` : busy === "sending" ? "Sending…" : "Resend code"}
              </button>
              <button type="button" className={s.linkQuiet} onClick={back}>
                Wrong email?
              </button>
            </div>
            <p className={s.fine} style={{ textAlign: "left" }}>
              Codes expire after 10 minutes.
            </p>
          </div>
        ) : (
          <form onSubmit={createAccount} noValidate>
            <div className={s.verified}>✓ {verifiedEmail} verified</div>
            <h2 id="auth-title" className={s.title}>
              Make it yours
            </h2>
            <p className={s.text}>This is how people find you and see your stacks.</p>
            <div className={s.preview} aria-hidden="true">
              <span className={s.avatar}>{(name.trim().charAt(0) || "?").toUpperCase()}</span>
              <span className={s.previewText}>
                <span className={s.previewName}>{name.trim() || "Your name"}</span>
                <span className={s.previewUrl}>stack.app/{handle || "username"}</span>
              </span>
            </div>
            <label className={s.label} htmlFor="auth-name">
              Display name
            </label>
            <input
              id="auth-name"
              className={s.field}
              autoComplete="name"
              placeholder="Your name"
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => {
                setName(e.target.value.replace(/\s+/g, " "));
                setFormError("");
              }}
              autoFocus
            />
            <label className={s.label} htmlFor="auth-handle" style={{ marginTop: 16 }}>
              Username
            </label>
            <span className={`${s.field} ${s.handleField} ${handleState.state === "bad" ? s.fieldBad : ""}`}>
              <span aria-hidden="true" className={s.at}>
                @
              </span>
              <input
                id="auth-handle"
                className={s.handleInput}
                placeholder="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={handle}
                maxLength={31}
                aria-invalid={handleState.state === "bad"}
                aria-describedby="auth-handle-hint"
                onChange={(e) => setHandle(normalizeHandle(e.target.value))}
              />
              {handleState.state === "ok" && <span className={s.ok}>✓ Available</span>}
            </span>
            <div id="auth-handle-hint" aria-live="polite" className={`${s.hint} ${handleState.state === "bad" ? s.hintBad : handleState.state === "ok" ? s.hintOk : ""}`}>
              {handleState.msg}
            </div>
            {formError && (
              <div role="alert" className={s.error}>
                {formError}
              </div>
            )}
            <button type="submit" className={s.primary} style={{ marginTop: 20 }} aria-disabled={!canCreate} disabled={busy === "creating"}>
              {busy === "creating" ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
