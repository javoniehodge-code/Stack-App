import type { NextRequest } from "next/server";
import { authClient, readRequest, reply, resolveSignInEmail } from "@/lib/signInEmail";

const rateLimited = (e: { status?: number; code?: string } | null) => !!e && (e.status === 429 || e.code === "over_email_send_rate_limit");

/**
 * Sends a sign-in code. The code goes to the saved address of the account that owns the typed address's inbox
 * (Gmail dots and +tags are ignored), or to the typed address for a new account. The answer is the same either
 * way: { ok: true }, or an error that says nothing about whether an account exists.
 */
export async function POST(req: NextRequest) {
  const input = await readRequest(req);
  if (!input) return reply({ error: "invalid_email" }, 400);
  const target = await resolveSignInEmail(input.email);
  if (!target) return reply({ error: "unavailable" }, 503);
  const auth = authClient().auth;
  let { error } = await auth.signInWithOtp({ email: target, options: { shouldCreateUser: true } });
  if (error && !rateLimited(error)) {
    // A concurrent sign-up for the same inbox may have just created its account (this one was then refused):
    // look again and send to that account instead.
    const again = await resolveSignInEmail(input.email);
    if (again && again !== target) ({ error } = await auth.signInWithOtp({ email: again, options: { shouldCreateUser: true } }));
  }
  if (rateLimited(error)) return reply({ error: "rate_limited" }, 429);
  if (error) return reply({ error: "send_failed" }, 502);
  return reply({ ok: true });
}
