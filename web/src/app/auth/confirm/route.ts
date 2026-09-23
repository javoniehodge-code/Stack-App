import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Fallback for email templates that send a link instead of a 6-digit code.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const next = searchParams.get("next");
  const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (token_hash && type) {
    const sb = await createClient();
    const { error } = await sb.auth.verifyOtp({ type, token_hash });
    if (!error) return NextResponse.redirect(new URL(dest, origin));
  }
  return NextResponse.redirect(new URL("/profile", origin));
}
