// End-to-end checks for email-code sign-in (Party Mode Task 1a). Runs against an isolated test stack only:
// the app (APP_URL), its Supabase-compatible API (API_URL, with ANON_KEY) and a Mailpit test inbox (MAILPIT_URL),
// plus psql access to the test database (TEST_DB, a libpq connection string) for checking rows.
// It refuses to run unless every URL points at localhost / 127.0.0.1.
//
//   APP_URL=http://localhost:3000 API_URL=http://localhost:54321 MAILPIT_URL=http://127.0.0.1:8025 \
//   ANON_KEY=... TEST_DB="host=/tmp port=55433 dbname=stack_test user=postgres" \
//   EXISTING_EMAIL=existing.user@stack.test LIKE_STACK_TITLE="Test Tacos" node web/e2e/sign-in.e2e.mjs
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

// Playwright is preinstalled globally in the test machine rather than a project dependency.
const { chromium } = createRequire(import.meta.url)("playwright");

const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error(`set ${k}`);
  return v;
};
const APP = env("APP_URL"), API = env("API_URL"), MAIL = env("MAILPIT_URL"), ANON = env("ANON_KEY"), DB = env("TEST_DB");
const EXISTING = env("EXISTING_EMAIL"), STACK_TITLE = env("LIKE_STACK_TITLE");
for (const u of [APP, API, MAIL]) {
  const h = new URL(u).hostname;
  if (h !== "localhost" && h !== "127.0.0.1") throw new Error(`refusing to run against ${u}: test URLs must be local`);
}
if (!/host=\/[^\s]*/.test(DB)) throw new Error("TEST_DB must use a local socket (host=/...)");

const sql = (q) => execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", DB, "-c", q], { encoding: "utf8" }).trim();
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function latestCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() > after);
    if (m) {
      const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
      const code = (full.Text.match(/\b(\d{6})\b/) || [])[1];
      return { code, subject: full.Subject };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email for ${email}`);
}

// Supabase allows one code per address every 30 seconds. On a rerun, wait until the last one is old enough.
async function waitForResendWindow(email) {
  for (;;) {
    const age = sql(
      `select coalesce(extract(epoch from now() - greatest(confirmation_sent_at, recovery_sent_at))::int, 999) from auth.users where email = '${email}'`,
    );
    if (!age || Number(age) > 31) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

async function enterEmail(page, email) {
  await waitForResendWindow(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  const sentAfter = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  return sentAfter;
}

const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

// 1. Existing user, starting from a protected action (Like). Wrong code first, then the right one.
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const userId = sql(`select id from auth.users where email = '${EXISTING}'`);
  const before = sql(`select handle || '|' || name from public.profiles where id = '${userId}'`);
  const stackId = sql(`select id from public.stacks where title = '${STACK_TITLE}'`);
  await page.goto(APP + "/");
  const card = page.locator("article", { hasText: STACK_TITLE }).first();
  await card.getByRole("button", { name: "Like", exact: true }).click();
  await page.getByRole("dialog").waitFor();
  check("1a. Like while signed out opens the sign-in sheet with the action's message", await page.getByText("Sign in to like stacks").isVisible());
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/claude-0/testenv/shot-1-start-phone.png" });
  const sentAfter = await enterEmail(page, EXISTING);
  const { code, subject } = await latestCode(EXISTING, sentAfter);
  check("1b. The code arrives in the test inbox", /^\d{6}$/.test(code || ""), `subject "${subject}"`);
  check("1c. Resend is held back for 30 seconds", await page.getByRole("button", { name: /Resend code in \d+s/ }).isDisabled());
  const wrong = code === "000000" ? "111111" : "000000";
  await page.getByLabel("6-digit code").fill(wrong);
  await page.locator("#auth-code-error").waitFor();
  check("1d. A wrong code shows an inline error and stays on the step", (await page.locator("#auth-code-error").innerText()).includes("isn’t right"));
  await page.screenshot({ path: "/tmp/claude-0/testenv/shot-2-wrong-code-phone.png" });
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await card.getByRole("button", { name: "Unlike" }).waitFor();
  const likes = sql(`select count(*) from public.likes where stack_id = '${stackId}' and user_id = '${userId}'`);
  const allLikes = sql(`select count(*) from public.likes where stack_id = '${stackId}'`);
  check("1e. The pending Like ran exactly once, as the existing user", likes === "1" && allLikes === "1", `likes by user ${likes}, total ${allLikes}`);
  const after = sql(`select handle || '|' || name from public.profiles where id = '${userId}'`);
  const users = sql(`select count(*) from auth.users where email = '${EXISTING}'`);
  check("1f. Same account and profile: one auth user, profile unchanged", users === "1" && after === before, `${after}`);
  await page.goto(APP + "/profile");
  check("1g. Profile tab opens the original profile", await page.getByText("@" + before.split("|")[0]).first().isVisible());
  await page.reload();
  check("1h. The session survives a reload", await page.getByText("@" + before.split("|")[0]).first().isVisible());
  await page.goto(APP + "/settings");
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(APP + "/");
  await page.goto(APP + "/profile");
  check("1i. Log out signs out", await page.getByRole("heading", { name: "Sign in to see your profile" }).isVisible());
  await ctx.close();
}

// 2. Not now drops the pending action.
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const stackId = sql(`select id from public.stacks where title = '${STACK_TITLE}'`);
  const before = sql(`select count(*) from public.likes where stack_id = '${stackId}'`);
  await page.goto(APP + "/");
  await page.locator("article", { hasText: STACK_TITLE }).first().getByRole("button", { name: "Like", exact: true }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const after = sql(`select count(*) from public.likes where stack_id = '${stackId}'`);
  check("2. Not now closes the sheet and writes nothing", before === after, `likes ${before} → ${after}`);
  await ctx.close();
}

// 3. New user from Create (+): verify, then choose a name and username before any profile exists; then Create opens.
{
  const stamp = Date.now().toString(36);
  const email = `new.${stamp}@stack.test`;
  const newHandle = `tester.${stamp}`; // unique per run, so reruns don't collide
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await page.goto(APP + "/");
  await page.getByRole("link", { name: "Create" }).click();
  await page.getByRole("dialog").waitFor();
  const sentAfter = await enterEmail(page, email);
  const { code } = await latestCode(email, sentAfter);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  const uid = sql(`select id from auth.users where email = '${email}'`);
  check("3a. After the code, a new account sees “Make it yours”", !!uid);
  check("3b. No profile exists yet for the new account", sql(`select count(*) from public.profiles where id = '${uid}'`) === "0");
  const anon = await (await fetch(`${API}/rest/v1/profiles?select=id,handle&id=eq.${uid}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })).json();
  check("3c. Signed-out API can't find the account before setup", Array.isArray(anon) && anon.length === 0);
  await page.screenshot({ path: "/tmp/claude-0/testenv/shot-3-setup-phone.png" });
  await page.getByLabel("Display name").fill("New Tester");
  const hint = page.locator("#auth-handle-hint");
  for (const [h, expect] of [["ab", "At least 3"], ["explore", "isn’t available"], ["existing.tester", "is taken"], ["_edge", "Can’t start or end"]]) {
    await page.getByLabel("Username").fill(h);
    await page.waitForFunction(([el, t]) => document.querySelector(el)?.textContent?.includes(t), ["#auth-handle-hint", expect], { timeout: 5000 }).catch(() => {});
    check(`3d. Username “${h}” is refused`, (await hint.innerText()).includes(expect), await hint.innerText());
  }
  await page.getByLabel("Username").fill(newHandle);
  await page.getByText("✓ Available").waitFor();
  check("3e. A free username shows ✓ Available", true);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/create/);
  check("3f. The pending Create ran: the editor opened", page.url().includes("/create"), page.url());
  const prof = sql(`select handle || '|' || name from public.profiles where id = '${uid}'`);
  check("3g. Profile created with the chosen name and username", prof === `${newHandle}|New Tester`, prof);
  check("3h. One account for the email", sql(`select count(*) from auth.users where email = '${email}'`) === "1");
  await ctx.close();
}

// 4. A verified account that closed the sheet at setup resumes there next time, and can't skip it.
{
  const email = `later.${Date.now()}@stack.test`;
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  const sentAfter = await enterEmail(page, email);
  const { code } = await latestCode(email, sentAfter);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await page.keyboard.press("Escape");
  await page.reload();
  check("4a. Without a profile the app still treats the visitor as signed out", await page.getByRole("heading", { name: "Sign in to see your profile" }).isVisible());
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  await page.getByRole("heading", { name: "Make it yours" }).waitFor({ timeout: 5000 }).catch(() => {});
  check("4b. Signing in again continues at “Make it yours”", await page.getByRole("heading", { name: "Make it yours" }).isVisible());
  await ctx.close();
}

// 5. Desktop: the sheet is a centered dialog.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  await page.waitForTimeout(400); // let the sheet's entrance animation finish before measuring
  const box = await page.getByRole("dialog").boundingBox();
  check("5. On desktop the sheet is a centered dialog, at most 480px wide", box && box.width <= 480 && Math.abs(box.x + box.width / 2 - 640) < 40, box ? `${Math.round(box.width)}px wide` : "");
  await page.screenshot({ path: "/tmp/claude-0/testenv/shot-4-start-desktop.png" });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
