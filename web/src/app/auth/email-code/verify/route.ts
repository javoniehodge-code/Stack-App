import type { NextRequest } from "next/server";
import { authClient, readRequest, reply, resolveSignInEmail } from "@/lib/signInEmail";

/**
 * Checks a sign-in code for the account the typed address resolves to, and returns that session's tokens for
 * the browser's sign-in attempt to adopt. A wrong or expired code, and an address with no code pending, get the
 * same answer.
 */
export async function POST(req: NextRequest) {
  const input = await readRequest(req, "code");
  if (!input || !/^\d{6}$/.test(input.code)) return reply({ error: "invalid_code" }, 400);
  const target = await resolveSignInEmail(input.email);
  if (!target) return reply({ error: "unavailable" }, 503);
  const { data, error } = await authClient().auth.verifyOtp({ email: target, token: input.code, type: "email" });
  if (error || !data.session) {
    if (error?.status === 429) return reply({ error: "rate_limited" }, 429);
    const serverSide = error?.name === "AuthRetryableFetchError" || (error?.status ?? 0) >= 500;
    return serverSide ? reply({ error: "unavailable" }, 503) : reply({ error: "invalid_code" }, 400);
  }
  return reply({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
}
