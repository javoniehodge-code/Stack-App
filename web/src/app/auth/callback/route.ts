import { NextResponse, type NextRequest } from "next/server";
import { safePath } from "@/lib/pendingSignIn";
import { createClient } from "@/lib/supabase/server";

// Where Supabase Auth sends the browser back after Continue with Google. It finishes the sign-in (the code is
// exchanged for a session cookie), then returns to the page the visitor came from with ?signin=<result>, so the
// app can finish or reopen the sign-in there:
//   google     signed in
//   cancelled  the visitor backed out on Google's screen
//   existing   Google's address shares a Gmail inbox with an existing account (the database refuses a second
//              account for one inbox), so the visitor is pointed to email sign-in
//   failed     anything else
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const dest = new URL(safePath(searchParams.get("next")), origin);
  const code = searchParams.get("code");
  let result: "google" | "cancelled" | "existing" | "failed";
  if (code) {
    const sb = await createClient();
    const { error } = await sb.auth.exchangeCodeForSession(code);
    result = error ? "failed" : "google";
  } else {
    const error = searchParams.get("error");
    const description = searchParams.get("error_description") ?? "";
    result = error === "access_denied" ? "cancelled" : /database error saving new user/i.test(description) ? "existing" : "failed";
  }
  dest.searchParams.set("signin", result);
  const res = NextResponse.redirect(dest);
  // A sign-in that didn't finish leaves its one-time PKCE verifier behind; it's useless now, so clear it.
  if (result !== "google") for (const c of request.cookies.getAll()) if (c.name.endsWith("-code-verifier")) res.cookies.delete(c.name);
  return res;
}
