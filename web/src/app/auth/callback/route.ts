import { NextResponse, type NextRequest } from "next/server";
import { safePath } from "@/lib/pendingSignIn";
import { createClient } from "@/lib/supabase/server";

// Where Supabase Auth sends the browser back after Continue with Google (or Connect Google). It finishes the sign-in (the code is
// exchanged for a session cookie), then returns to the page the visitor came from with ?signin=<result>, so the
// app can finish or reopen the sign-in there:
//   google     signed in
//   cancelled  the visitor backed out on Google's screen
//   existing   Google's address shares a Gmail inbox with an existing account (the database refuses a second
//              account for one inbox), so the visitor is pointed to email sign-in
//   failed     anything else
// With ?mode=link (Connect Google in Settings, already signed in) it reports ?google=<result> instead:
//   connected, cancelled, taken (that Google account already belongs to another Stack account), failed.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const dest = new URL(safePath(searchParams.get("next")), origin);
  const link = searchParams.get("mode") === "link";
  const code = searchParams.get("code");
  const error = searchParams.get("error");
  const description = `${searchParams.get("error_code") ?? ""} ${searchParams.get("error_description") ?? ""}`;
  let ok = false;
  if (code) {
    const sb = await createClient();
    ok = !(await sb.auth.exchangeCodeForSession(code)).error;
  }
  const cancelled = !code && error === "access_denied";
  if (link) {
    dest.searchParams.set("google", ok ? "connected" : cancelled ? "cancelled" : /identity_already_exists|already linked/i.test(description) ? "taken" : "failed");
  } else {
    dest.searchParams.set("signin", ok ? "google" : cancelled ? "cancelled" : /database error saving new user/i.test(description) ? "existing" : "failed");
  }
  const res = NextResponse.redirect(dest);
  // A sign-in that didn't finish leaves its one-time PKCE verifier behind; it's useless now, so clear it.
  if (!ok) for (const c of request.cookies.getAll()) if (c.name.endsWith("-code-verifier")) res.cookies.delete(c.name);
  return res;
}
