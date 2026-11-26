// Regression check for /auth/callback: wherever `next` points, the browser is only ever sent back to Stack's own
// origin. Covers paths that look local but parse to another site (tabs and newlines are dropped by URL parsers,
// backslashes count as slashes), absolute URLs, and both modes (sign-in and Connect Google). It uses the error
// form of the callback (?error=access_denied), so nothing is sent to Supabase.
//
//   APP_URL=http://localhost:3000 node web/e2e/callback-redirect.test.mjs
const APP = process.env.APP_URL;
if (!APP || !["localhost", "127.0.0.1"].includes(new URL(APP).hostname)) {
  console.error("refusing to run: set APP_URL to the local test app");
  process.exit(2);
}
const origin = new URL(APP).origin;

// [next, the path expected on Stack's origin]
const cases = [
  ["//evil.example", "/"],
  ["/\\evil.example", "/"],
  ["\\\\evil.example", "/"],
  ["/\t/evil.example", "/"],
  ["/\n/evil.example", "/"],
  ["/\r/evil.example", "/"],
  ["/\t\\evil.example", "/"],
  ["\t//evil.example", "/"],
  ["//\tevil.example", "/"],
  ["/\u0000/evil.example", "/"],
  ["https://evil.example/", "/"],
  ["https:evil.example", "/"],
  ["http://localhost:3000.evil.example/", "/"],
  ["javascript:alert(1)", "/"],
  ["", "/"],
  // Legitimate returns keep their path and query.
  ["/", "/"],
  ["/profile?tab=saved", "/profile?tab=saved"],
  ["/s/abc123", "/s/abc123"],
  ["/settings/account", "/settings/account"],
  ["/@evil.example", "/@evil.example"],
];

let failures = 0;
for (const mode of ["", "link"]) {
  for (const [next, want] of cases) {
    const q = new URLSearchParams({ next, error: "access_denied" });
    if (mode) q.set("mode", mode);
    const res = await fetch(`${APP}/auth/callback?${q}`, { redirect: "manual" });
    const loc = res.headers.get("location") ?? "";
    let url = null;
    try {
      url = new URL(loc, origin);
    } catch {}
    const param = mode ? "google" : "signin";
    const path = url ? `${url.pathname}${url.search}`.replace(new RegExp(`[?&]${param}=cancelled$`), "") : "";
    const ok = res.status >= 300 && res.status < 400 && url?.origin === origin && path === want;
    if (!ok) failures++;
    console.log(`${ok ? "PASS" : "FAIL"}  ${mode || "sign-in"}  next=${JSON.stringify(next)} → ${loc}`);
  }
}
console.log(failures ? `\n${failures} callback checks failed` : `\nall ${cases.length * 2} callback checks passed`);
process.exit(failures ? 1 : 0);
