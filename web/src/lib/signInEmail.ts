import "server-only";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_KEY, SUPABASE_URL } from "@/lib/supabase/env";

// Email-code sign-in goes through Stack's server so that Gmail aliases reach one account: the server asks the
// database which saved address owns the typed address's inbox (resolve_sign_in_email, which only accepts this
// server's token) and uses that address with Supabase Auth. The browser never learns the saved address, or
// whether an account exists.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** A Supabase client that keeps nothing between requests. */
export const authClient = () =>
  createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

/** Reads `{ email, ...fields }` from a JSON request; null if it isn't a well-formed request. */
export async function readRequest<K extends string>(req: NextRequest, ...fields: K[]) {
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return null;
  const out = { email } as { email: string } & Record<K, string>;
  for (const f of fields) {
    const v = body?.[f];
    if (typeof v !== "string") return null;
    (out as Record<string, string>)[f] = v;
  }
  return out;
}

/** The address Supabase Auth should use for `email`, or null if the lookup isn't available. */
export async function resolveSignInEmail(email: string): Promise<string | null> {
  const token = process.env.SIGN_IN_RESOLVER_TOKEN;
  if (!token) return null;
  const { data, error } = await authClient().rpc("resolve_sign_in_email", { p_email: email, p_token: token });
  return error || typeof data !== "string" ? null : data;
}

export const reply = (body: Record<string, unknown>, status = 200) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
