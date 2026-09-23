import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_URL } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

// Signs in with a username and password. The account's email is looked up here
// on the server with the secret key, so it is never sent to the browser.
// Email + password sign-in happens directly in the browser and doesn't use this.
export async function POST(request: NextRequest) {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) {
    return NextResponse.json({ error: "Username sign-in isn't set up yet. Sign in with your email instead." }, { status: 501 });
  }
  const body = (await request.json().catch(() => null)) as { username?: unknown; password?: unknown } | null;
  const username = typeof body?.username === "string" ? body.username.trim().replace(/^@/, "").toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const wrong = NextResponse.json({ error: "Wrong username or password." }, { status: 400 });
  if (!/^[a-z0-9._]{2,30}$/.test(username) || !password) return wrong;

  const admin = createAdminClient(SUPABASE_URL, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: profile } = await admin.from("profiles").select("id").eq("handle", username).maybeSingle();
  if (!profile) return wrong;
  const { data: user } = await admin.auth.admin.getUserById(profile.id as string);
  const email = user?.user?.email;
  if (!email) return wrong;

  const sb = await createClient();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "email_not_confirmed") {
      return NextResponse.json({ error: "Confirm your email first. Sign in with your email address to get a new code." }, { status: 400 });
    }
    return wrong;
  }
  return NextResponse.json({ ok: true });
}
