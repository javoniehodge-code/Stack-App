// End-to-end checks for email-code sign-in (Party Mode Task 1a). Runs only against the disposable test
// environment described in web/e2e/README.md: the app (APP_URL), its Supabase-compatible API (API_URL, with
// ANON_KEY), a Mailpit test inbox (MAILPIT_URL) and the test database (TEST_DB, a libpq connection string).
//
// Before it writes anything (database rows, or sign-ins through the browser), it verifies, read-only, that:
//   - every URL is local, and TEST_DB is a local Unix socket to a database named stack_test_*;
//   - that database carries the test marker (stack_test_env.marker) whose token equals TEST_ENV_TOKEN;
//   - EXISTING_EMAIL is the marker's fixture account (an @….test address) and the fixture Stack exists and is its;
//   - the API and the app actually serve that fixture Stack, so they're wired to the same test database.
// Any failure exits with code 2 and nothing written. `--verify-only` stops after the checks.
// It writes only to records the test owns: the fixture account's likes, saves and sessions on the fixture
// Stack, and the accounts it creates in this run (deleted at the end).
//
//   APP_URL=http://localhost:3000 API_URL=http://localhost:54321 MAILPIT_URL=http://127.0.0.1:8025 \
//   ANON_KEY=... TEST_DB="host=/tmp port=55433 dbname=stack_test_x user=postgres" TEST_ENV_TOKEN=... \
//   EXISTING_EMAIL=existing.user@stack.test node web/e2e/sign-in.e2e.mjs [--verify-only]
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { createRequire } from "node:module";
import { verifyTestDatabase } from "./test-target.mjs";

const refuse = (why) => {
  console.error(`refusing to run: ${why}`);
  process.exit(2);
};
const env = (k) => process.env[k] || refuse(`set ${k}`);
const APP = env("APP_URL"), API = env("API_URL"), MAIL = env("MAILPIT_URL"), ANON = env("ANON_KEY"), DB = env("TEST_DB");
const TOKEN = env("TEST_ENV_TOKEN"), EXISTING = env("EXISTING_EMAIL");
const SQL_LOG = process.env.E2E_SQL_LOG; // optional: every statement is logged here, marked R (read-only) or W
const RUN = Date.now().toString(36);

// Statements run through psql. Reads run in read-only transactions, so even a mistaken write fails there.
// Writes are refused until the target has been verified.
let verified = false;
const psql = (q, readOnly) => {
  if (SQL_LOG) appendFileSync(SQL_LOG, `${readOnly ? "R" : "W"} ${q.replace(/\s+/g, " ")}\n`);
  return execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", DB, "-c", q], {
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: readOnly ? "-c default_transaction_read_only=on" : "" },
  }).trim();
};
const read = (q) => psql(q, true);
const write = (q) => {
  if (!verified) throw new Error("write attempted before the test target was verified");
  return psql(q, false);
};

async function verifyTarget() {
  for (const u of [APP, API, MAIL]) {
    const h = new URL(u).hostname;
    if (h !== "localhost" && h !== "127.0.0.1") refuse(`${u} isn't local`);
  }
  const m = verifyTestDatabase({ conn: DB, token: TOKEN, read, refuse });
  if (m.fixture_email !== EXISTING || !/@[^@]+\.test$/.test(EXISTING)) refuse("EXISTING_EMAIL isn't the marker's fixture account");
  const fx = read(
    `select json_build_object('user', u.id, 'title', s.title, 'handle', p.handle) from auth.users u join public.profiles p on p.id = u.id
       join public.stacks s on s.author_id = u.id and s.id = '${m.fixture_stack_id}' and s.status = 'published'
      where u.email = '${EXISTING}'`,
  );
  if (!fx) refuse("the fixture account or its fixture Stack is missing");
  const fixture = { ...JSON.parse(fx), stack: m.fixture_stack_id };
  const api = await fetch(`${API}/rest/v1/stacks?select=id&id=eq.${fixture.stack}`, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
    .then((r) => r.json())
    .catch(() => null);
  if (!Array.isArray(api) || api.length !== 1) refuse("API_URL doesn't serve the fixture Stack, so it isn't wired to the test database");
  const html = await fetch(`${APP}/`).then((r) => r.text()).catch(() => "");
  if (!html.includes(fixture.stack)) refuse("APP_URL doesn't show the fixture Stack, so it isn't wired to the test API");
  if (!(await fetch(`${MAIL}/api/v1/info`).then((r) => r.ok).catch(() => false))) refuse("MAILPIT_URL isn't a Mailpit inbox");
  return fixture;
}

const FX = await verifyTarget();
console.log(`target verified: ${new URL(APP).host}, database ${read("select current_database()")}, fixture @${FX.handle}`);
if (process.argv.includes("--verify-only")) process.exit(0);
verified = true;
const STACK_TITLE = FX.title;

// Accounts this run creates; only these are deleted at the end.
const created = [];
const newEmail = (prefix) => {
  const e = `${prefix}.${RUN}.${created.length}@stack.test`;
  created.push(e);
  return e;
};
/** Registers an address this run will create an account for, so cleanup removes it. */
const track = (email) => {
  created.push(email.toLowerCase());
  return email;
};
// Start from a known state for the fixture account: no likes, saves or sessions on the fixture Stack.
const resetFixture = () => {
  write(`delete from public.likes where user_id = '${FX.user}' and stack_id = '${FX.stack}'`);
  write(`delete from public.saves where user_id = '${FX.user}' and stack_id = '${FX.stack}'`);
  write(`delete from auth.sessions where user_id = '${FX.user}'`);
};
resetFixture();

// Clean up: only the accounts this run created (their profiles, likes and sessions go with them), and the fixture
// account's likes, saves and sessions on the fixture Stack. Runs at the end, and also if the run crashes.
let cleaned = false;
const cleanup = () => {
  if (cleaned) return;
  cleaned = true;
  if (created.length) write(`delete from auth.users where email in (${created.map((e) => `'${e}'`).join(",")})`);
  resetFixture();
  console.log(`cleaned up ${created.length} accounts created by this run and reset the fixture`);
};
process.on("uncaughtException", (e) => {
  console.error(e);
  try {
    cleanup();
  } finally {
    process.exit(1);
  }
});

// Playwright is preinstalled globally in the test machine rather than a project dependency.
const { chromium } = createRequire(import.meta.url)("playwright");
const sql = read;
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

// `inbox` is the account's saved address when `email` is a Gmail alias of it (the code goes there).
async function enterEmail(page, email, inbox = email) {
  await waitForResendWindow(inbox);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  const sentAfter = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  return sentAfter;
}

/** Messages Mailpit received for `email` after `after` (ms). */
async function mailCount(email, after) {
  const r = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
  return (r.messages || []).filter((x) => new Date(x.Created).getTime() > after).length;
}
async function logout(page) {
  await page.goto(APP + "/settings");
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(APP + "/");
}
const postJson = (path, body) =>
  fetch(APP + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.text() }));
/** Accounts that hold an inbox key. */
const accountsForInbox = (key) => sql(`select count(*) from private.account_email_keys where email_key = '${key}'`);

/** Auth cookies the app's own client stores. None means the browser isn't signed in. */
const authCookies = async (ctx) => (await ctx.cookies()).filter((c) => c.name.startsWith("sb-")).map((c) => c.name);
/** Active server-side sessions for an account. */
const sessionsFor = (userId) => sql(`select count(*) from auth.sessions where user_id = '${userId}'`);
/**
 * Holds back the response (not the request) of the first matching call for `ms`, so the server finishes the work
 * but the browser hears about it late, like a slow connection.
 */
async function delayFirstResponse(page, pattern, ms) {
  let first = true;
  await page.route(pattern, async (route) => {
    if (!first || route.request().method() === "OPTIONS") return route.continue();
    first = false;
    const res = await route.fetch();
    await new Promise((r) => setTimeout(r, ms));
    await route.fulfill({ response: res });
  });
}

const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
// Accounts made by scenarios 3 (email code, work address) and 7 (email code, dotted Gmail), reused by 8.
let s3Email = "";
let s7Saved = "";

/**
 * Plays Google's consent screen. The next "Continue with Google" reaches Supabase Auth's /authorize, which would
 * send the browser to accounts.google.com; instead the browser goes straight back to Auth's callback, as Google
 * would after the visitor picks `googleEmail` (or, with `cancel`, backs out). Auth then exchanges the code with
 * the fake Google server (e2e/fake-google.mjs), which vouches for that address. With `away`, the browser is left
 * on a stand-in Google page instead, as if the visitor never came back.
 */
async function playGoogle(page, googleEmail, { cancel = false, away = false } = {}) {
  await page.route(
    "**/auth/v1/authorize?*",
    async (route) => {
      if (away) return route.fulfill({ status: 200, contentType: "text/html", body: "<title>Google</title>Choose an account" });
      const res = await route.fetch({ maxRedirects: 0 });
      const google = new URL(res.headers()["location"]);
      if (google.hostname !== "accounts.google.com") throw new Error(`Auth sent the browser to ${google.hostname}`);
      const back = new URL(google.searchParams.get("redirect_uri"));
      back.searchParams.set("state", google.searchParams.get("state"));
      if (cancel) {
        back.searchParams.set("error", "access_denied");
        back.searchParams.set("error_description", "The user denied access");
      } else back.searchParams.set("code", Buffer.from(JSON.stringify({ email: googleEmail, sub: `google-${googleEmail}` })).toString("base64url"));
      await route.fulfill({ status: 302, headers: { location: back.toString() } });
    },
    { times: 1 },
  );
}
/** Providers linked to the account with `email`, e.g. "email,google". */
const providersOf = (email) =>
  sql(`select coalesce(string_agg(i.provider, ',' order by i.provider), '') from auth.users u left join auth.identities i on i.user_id = u.id where u.email = '${email}'`);

// 0a. A slow code check that finishes after its sheet was closed and another opened from a different action.
//     The late result must not run the first action, close the newer sheet, or sign the browser in.
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const userId = FX.user, stackId = FX.stack;
  resetFixture();
  const likes0 = sql(`select count(*) from public.likes where stack_id = '${stackId}'`);
  const saves0 = sql(`select count(*) from public.saves where stack_id = '${stackId}'`);
  await delayFirstResponse(page, "**/auth/email-code/verify", 4000);
  await page.goto(APP + "/");
  const card = page.locator("article", { hasText: STACK_TITLE }).first();
  await card.getByRole("button", { name: "Like", exact: true }).click();
  const sentAfter = await enterEmail(page, EXISTING);
  const { code } = await latestCode(EXISTING, sentAfter);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByText("Checking your code…").waitFor();
  await page.keyboard.press("Escape"); // close the first sheet while its code is still being checked
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await card.getByRole("button", { name: "Save", exact: true }).click(); // a different action opens a new sheet
  await page.getByText("Sign in to save stacks").waitFor();
  await page.waitForTimeout(5500); // the first check's response arrives during this wait
  check("0a-1. The late result didn't close the newer sheet", await page.getByText("Sign in to save stacks").isVisible() && (await page.getByRole("dialog").count()) === 1);
  check("0a-2. The first sheet's Like never ran", sql(`select count(*) from public.likes where stack_id = '${stackId}'`) === likes0);
  const cookies = await authCookies(ctx);
  check("0a-3. The browser isn't signed in", cookies.length === 0, cookies.join(",") || "no auth cookies");
  check("0a-4. The late session was revoked on the server", sessionsFor(userId) === "0", `${sessionsFor(userId)} active sessions`);
  // The newer sheet still works, and runs its own action only.
  const sentAfter2 = await enterEmail(page, EXISTING);
  const { code: code2 } = await latestCode(EXISTING, sentAfter2);
  await page.getByLabel("6-digit code").fill(code2);
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await card.getByRole("button", { name: "Unsave" }).waitFor();
  check(
    "0a-5. Signing in on the newer sheet runs only its Save, once",
    sql(`select count(*) from public.saves where stack_id = '${stackId}'`) === String(Number(saves0) + 1) && sql(`select count(*) from public.likes where stack_id = '${stackId}'`) === likes0,
  );
  await page.goto(APP + "/settings");
  await page.getByRole("button", { name: "Log out" }).click();
  await page.waitForURL(APP + "/");
  resetFixture();
  await ctx.close();
}

// 0b. Create account keeps the sheet open while it commits: a slow response shows the progress state, Escape and
//     the backdrop can't close the sheet, and the flow completes when the answer arrives.
// 0c. A failed Create account keeps the sheet open with an error and nothing saved, and Create account again works.
{
  const email = newEmail("slow");
  const handle = `slow.${RUN}`;
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await delayFirstResponse(page, "**/rest/v1/rpc/create_profile", 4000);
  await page.goto(APP + "/");
  await page.getByRole("link", { name: "Create" }).click();
  const sentAfter = await enterEmail(page, email);
  const { code } = await latestCode(email, sentAfter);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  const uid = sql(`select id from auth.users where email = '${email}'`);
  await page.getByLabel("Display name").fill("Slow Tester");
  await page.getByLabel("Username").fill(handle);
  await page.getByText("✓ Available").waitFor();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const progress = page.getByRole("button", { name: "Creating account…" });
  await progress.waitFor();
  await page.keyboard.press("Escape");
  await page.mouse.click(195, 40); // the backdrop above the sheet
  await page.waitForTimeout(500);
  check(
    "0b-1. While committing, the sheet stays open and shows “Creating account…” (Escape and backdrop ignored)",
    (await page.getByRole("dialog").count()) === 1 && (await progress.isVisible()) && (await progress.isDisabled()),
  );
  check("0b-2. Nothing is signed in yet", (await authCookies(ctx)).length === 0);
  await page.waitForURL(/\/create/, { timeout: 10000 });
  check("0b-3. When the answer arrives the sheet closes and the pending Create runs", (await page.getByRole("dialog").count()) === 0, page.url());
  check("0b-4. Saved: exactly one profile, with the chosen name and username", sql(`select count(*) || '|' || max(handle) || '|' || max(name) from public.profiles where id = '${uid}'`) === `1|${handle}|Slow Tester`);
  check("0b-5. The browser is signed in as that account", (await authCookies(ctx)).length > 0 && sessionsFor(uid) === "1");
  await ctx.close();
}
{
  const email = newEmail("fail");
  const handle = `fail.${RUN}`;
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  let failNext = true;
  await page.route("**/rest/v1/rpc/create_profile", (route) => {
    if (route.request().method() === "OPTIONS" || !failNext) return route.continue();
    failNext = false;
    return route.abort("connectionreset"); // the request never reaches the server
  });
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  const sentAfter = await enterEmail(page, email);
  const { code } = await latestCode(email, sentAfter);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  const uid = sql(`select id from auth.users where email = '${email}'`);
  await page.getByLabel("Display name").fill("Retry Tester");
  await page.getByLabel("Username").fill(handle);
  await page.getByText("✓ Available").waitFor();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByText("Couldn’t create your account").waitFor();
  check(
    "0c-1. A failed Create account keeps the sheet open, shows the error and keeps the typed name and username",
    (await page.getByRole("dialog").count()) === 1 && (await page.getByLabel("Display name").inputValue()) === "Retry Tester" && (await page.getByLabel("Username").inputValue()) === handle,
  );
  check("0c-2. Nothing was saved and nothing is signed in", sql(`select count(*) from public.profiles where id = '${uid}'`) === "0" && (await authCookies(ctx)).length === 0);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByText("@" + handle).first().waitFor();
  check("0c-3. Create account again succeeds: one profile, signed in, profile shown", sql(`select count(*) from public.profiles where id = '${uid}'`) === "1" && (await authCookies(ctx)).length > 0);
  await ctx.close();
}

// 1. Existing user, starting from a protected action (Like). Wrong code first, then the right one.
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const userId = FX.user;
  const before = sql(`select handle || '|' || name from public.profiles where id = '${userId}'`);
  const stackId = FX.stack;
  const allLikes0 = Number(sql(`select count(*) from public.likes where stack_id = '${stackId}'`));
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
  check("1e. The pending Like ran exactly once, as the existing user", likes === "1" && Number(allLikes) === allLikes0 + 1, `likes by user ${likes}, total ${allLikes0} → ${allLikes}`);
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
  const stackId = FX.stack;
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
  const email = newEmail("new");
  s3Email = email;
  const newHandle = `tester.${RUN}`; // unique per run, so reruns don't collide
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
  for (const [h, expect] of [["ab", "At least 3"], ["explore", "isn’t available"], [FX.handle, "is taken"], ["_edge", "Can’t start or end"]]) {
    await page.getByLabel("Username").fill(h);
    await page.waitForFunction(([el, t]) => document.querySelector(el)?.textContent?.includes(t), ["#auth-handle-hint", expect], { timeout: 5000 }).catch(() => {});
    check(`3d. Username “${h}” is refused`, (await hint.innerText()).includes(expect), await hint.innerText());
  }
  await page.getByLabel("Username").fill(newHandle);
  await page.getByText("✓ Available").waitFor();
  check("3e. A free username shows ✓ Available", true);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.waitForURL(/\/create/);
  check("3f. The pending Create ran: the editor opened", page.url().includes("/create"), page.url());
  const prof = sql(`select handle || '|' || name from public.profiles where id = '${uid}'`);
  check("3g. Profile created with the chosen name and username", prof === `${newHandle}|New Tester`, prof);
  check("3h. One account for the email", sql(`select count(*) from auth.users where email = '${email}'`) === "1");
  await ctx.close();
}

// 4. A verified account that closed the sheet at setup resumes there next time, and can't skip it.
{
  const email = newEmail("later");
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  const sentAfter = await enterEmail(page, email);
  const { code } = await latestCode(email, sentAfter);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  const uid = sql(`select id from auth.users where email = '${email}'`);
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.waitForTimeout(500);
  await page.reload();
  check("4a. Closing at setup leaves the browser signed out", (await authCookies(ctx)).length === 0 && (await page.getByRole("heading", { name: "Sign in to see your profile" }).isVisible()));
  check("4b. …and its session is revoked on the server", sessionsFor(uid) === "0", `${sessionsFor(uid)} active sessions`);
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  const sentAfter2 = await enterEmail(page, email);
  const { code: code2 } = await latestCode(email, sentAfter2);
  await page.getByLabel("6-digit code").fill(code2);
  await page.getByRole("heading", { name: "Make it yours" }).waitFor({ timeout: 10000 }).catch(() => {});
  check("4c. Signing in again with a new code returns to “Make it yours”", await page.getByRole("heading", { name: "Make it yours" }).isVisible());
  await ctx.close();
}

// 7. Gmail aliases reach one account, work addresses with dots stay separate, and the server routes don't reveal
//    whether an account exists.
{
  const saved = track(`g.${RUN}.tester@gmail.com`);
  s7Saved = saved;
  const key = `g${RUN}tester@gmail.com`;
  const handle = `g${RUN}`;
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  let after = await enterEmail(page, saved);
  await page.getByLabel("6-digit code").fill((await latestCode(saved, after)).code);
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await page.getByLabel("Display name").fill("Gmail Tester");
  await page.getByLabel("Username").fill(handle);
  await page.getByText("✓ Available").waitFor();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const uid = sql(`select id from auth.users where email = '${saved}'`);
  check("7a. A Gmail account is created with its address saved exactly as typed", !!uid && sql(`select handle from public.profiles where id = '${uid}'`) === handle, saved);
  await logout(page);

  for (const [label, typed] of [
    ["7b. The regular address, signing in again", saved],
    ["7c. Undotted", `g${RUN}tester@gmail.com`],
    ["7d. The regular address with +test", `g.${RUN}.tester+test@gmail.com`],
    ["7e. Plus alias in mixed case", `G${RUN}Tester+stack@Gmail.com`],
  ]) {
    await page.goto(APP + "/profile");
    await page.getByRole("button", { name: "Sign in / Create account" }).click();
    after = await enterEmail(page, typed, saved);
    const { code } = await latestCode(saved, after);
    const strayed = typed.toLowerCase() === saved ? 0 : await mailCount(typed.toLowerCase(), after);
    await page.getByLabel("6-digit code").fill(code);
    const signedIn = await page.getByRole("dialog").waitFor({ state: "detached", timeout: 10000 }).then(() => true, () => false);
    const sameProfile = signedIn && (await page.getByText("@" + handle).first().waitFor({ timeout: 10000 }).then(() => true, () => false));
    check(
      `${label} (${typed}): code sent to the saved address, no setup, same account and profile`,
      sameProfile && strayed === 0 && accountsForInbox(key) === "1" && (typed.toLowerCase() === saved || sql(`select count(*) from auth.users where lower(email) = lower('${typed}')`) === "0"),
      `codes at saved address: 1, at typed address: ${strayed}`,
    );
    await logout(page);
  }

  // Work addresses: dots matter, so w.first.last and wfirstlast are different people.
  const work = track(`w.${RUN}.tester@company.test`);
  const workAlias = track(`w${RUN}tester@company.test`);
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  after = await enterEmail(page, work);
  await page.getByLabel("6-digit code").fill((await latestCode(work, after)).code);
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await page.getByLabel("Display name").fill("Work Tester");
  await page.getByLabel("Username").fill(`w${RUN}`);
  await page.getByText("✓ Available").waitFor();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await logout(page);
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  after = await enterEmail(page, workAlias);
  await page.getByLabel("6-digit code").fill((await latestCode(workAlias, after)).code);
  const setup = await page.getByRole("heading", { name: "Make it yours" }).waitFor({ timeout: 10000 }).then(() => true, () => false);
  check(
    "7f. A dotted work address stays distinct: the undotted one gets its own code and a new-account setup",
    setup && (await mailCount(work, after)) === 0 && sql(`select count(*) from auth.users where email in ('${work}', '${workAlias}')`) === "2",
  );
  await page.keyboard.press("Escape");
  await ctx.close();

  // The routes answer the same for an alias of an existing account and for an address nobody has.
  const fresh = track(`n.${RUN}.probe@gmail.com`);
  await waitForResendWindow(saved);
  const sendExisting = await postJson("/auth/email-code/send", { email: `G.${RUN}TESTER+probe@gmail.com` });
  const sendFresh = await postJson("/auth/email-code/send", { email: fresh });
  const verifyExisting = await postJson("/auth/email-code/verify", { email: `g${RUN}tester+probe@gmail.com`, code: "000000" });
  const verifyNobody = await postJson("/auth/email-code/verify", { email: `nobody.${RUN}@gmail.com`, code: "000000" });
  const leaks = [sendExisting, sendFresh, verifyExisting, verifyNobody].some((r) => r.body.toLowerCase().includes(saved.toLowerCase()));
  check(
    "7g. Send: an existing account's alias and an unknown address get the same answer",
    sendExisting.status === sendFresh.status && sendExisting.body === sendFresh.body,
    `${sendExisting.status} ${sendExisting.body} vs ${sendFresh.status} ${sendFresh.body}`,
  );
  check(
    "7h. Verify: a wrong code for an existing account's alias and for an address with no account get the same answer",
    verifyExisting.status === verifyNobody.status && verifyExisting.body === verifyNobody.body,
    `${verifyExisting.status} ${verifyExisting.body}`,
  );
  check("7i. No response contains the saved address", !leaks);

  // Two sign-ups for the same new inbox at the same moment create one account.
  const raceA = track(`race.${RUN}@gmail.com`);
  const raceB = track(`race${RUN}+b@gmail.com`);
  const [ra, rb] = await Promise.all([postJson("/auth/email-code/send", { email: raceA }), postJson("/auth/email-code/send", { email: raceB })]);
  check(
    "7j. Simultaneous sign-ups for one new Gmail inbox create exactly one account, and neither request fails with a server error",
    accountsForInbox(`race${RUN}@gmail.com`) === "1" && sql(`select count(*) from auth.users where email in ('${raceA}', '${raceB}')`) === "1" && ra.status < 500 && rb.status < 500,
    `${ra.status} / ${rb.status}`,
  );
}

// 8. Continue with Google. The page is left for Google and reloaded on return, so the action that asked for
//    sign-in is saved first and finished once on return; Google can't make a second account for a Gmail inbox.
{
  const stackId = FX.stack;
  const likesOn = () => Number(sql(`select count(*) from public.likes where stack_id = '${stackId}'`));
  const likesBy = (email) => sql(`select count(*) from public.likes l join auth.users u on u.id = l.user_id where l.stack_id = '${stackId}' and u.email = '${email}'`);
  const card = (page) => page.locator("article", { hasText: STACK_TITLE }).first();

  // 8a. A new person: Like → Google → back on the same page at "Make it yours" → the Like happens after setup.
  {
    const gmail = track(`goog.${RUN}.new@gmail.com`);
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    await page.goto(APP + "/");
    await card(page).getByRole("button", { name: "Like", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: "/tmp/claude-0/testenv/shot-5-google-start-phone.png" });
    await playGoogle(page, gmail);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.getByRole("heading", { name: "Make it yours" }).waitFor();
    check("8a-1. Back from Google on the same page, without the result left in the address", new URL(page.url()).pathname === "/" && !page.url().includes("signin="), page.url());
    check("8a-2. A new Google account continues at choosing a name, with its address shown as verified", await page.getByText(`✓ ${gmail} verified`).isVisible());
    check("8a-3. The Like waits for the profile", likesBy(gmail) === "0");
    await page.getByLabel("Display name").fill("Google Tester");
    await page.getByLabel("Username").fill(`goog${RUN}`);
    await page.getByText("✓ Available").waitFor();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await card(page).getByRole("button", { name: "Unlike" }).waitFor({ timeout: 10000 }).catch(() => {});
    check("8a-4. After setup the Like ran exactly once, for the new account", likesBy(gmail) === "1", `likes by the account: ${likesBy(gmail)}`);
    check("8a-5. One account, signed in with Google", sql(`select count(*) from auth.users where email = '${gmail}'`) === "1" && providersOf(gmail) === "google", providersOf(gmail));
    await page.reload();
    check("8a-6. Still signed in and liked after a reload", await card(page).getByRole("button", { name: "Unlike" }).isVisible());
    await ctx.close();
  }

  // 8b. The same address as an email-code account: Google is added to that account, which signs straight in.
  {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    const uid = sql(`select id from auth.users where email = '${s3Email}'`);
    await page.goto(APP + "/");
    await card(page).getByRole("button", { name: "Save", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await playGoogle(page, s3Email);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await card(page).getByRole("button", { name: "Unsave" }).waitFor({ timeout: 15000 }).catch(() => {});
    const saves = sql(`select count(*) from public.saves where stack_id = '${stackId}' and user_id = '${uid}'`);
    check("8b-1. Returning account: no sheet, signed straight in, and the Save ran once", !(await page.getByRole("dialog").isVisible()) && saves === "1", `saves ${saves}`);
    check("8b-2. Same account: one user for the address, now with both email and Google", sql(`select count(*) from auth.users where email = '${s3Email}'`) === "1" && providersOf(s3Email) === "email,google" && sql(`select id from auth.users where email = '${s3Email}'`) === uid, providersOf(s3Email));
    // Create from the tab bar, after logging out: Google brings the returning account to Create.
    await logout(page);
    await page.getByRole("link", { name: "Create" }).click();
    await page.getByRole("dialog").waitFor();
    await playGoogle(page, s3Email);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.waitForURL(/\/create/, { timeout: 15000 }).catch(() => {});
    check("8b-3. Create, via Google: the editor opens after sign-in", new URL(page.url()).pathname === "/create", page.url());
    await ctx.close();
  }

  // 8c. Task 1b acceptance check: a Google address that's an undotted version of an email-code Gmail account is
  //     refused, pointing to email sign-in; no second account; email sign-in then works and finishes the Like.
  {
    const key = s7Saved.replace(/\./g, "").replace("@gmailcom", "@gmail.com");
    const variant = key; // what Google reports for the same inbox, without the dots
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    const total0 = likesOn();
    await page.goto(APP + "/");
    await card(page).getByRole("button", { name: "Like", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await playGoogle(page, variant);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.getByText("This Gmail inbox already has a Stack account").waitFor({ timeout: 15000 }).catch(() => {});
    await page.screenshot({ path: "/tmp/claude-0/testenv/shot-6-google-existing-phone.png" });
    check("8c-1. Refused with a message pointing to email sign-in", await page.getByText("This Gmail inbox already has a Stack account. Continue with email to sign in to it.").isVisible());
    check("8c-2. No second account: no user for Google's address, and one account holds the inbox", sql(`select count(*) from auth.users where email = '${variant}'`) === "0" && accountsForInbox(key) === "1", `inbox accounts ${accountsForInbox(key)}`);
    check("8c-3. Not signed in (no auth cookies at all), and the Like didn't run", (await authCookies(ctx)).length === 0 && likesOn() === total0, (await authCookies(ctx)).join(", "));
    check("8c-4. The sheet still has the original action's message", await page.getByText("Sign in to like stacks").isVisible());
    const after = await enterEmail(page, variant, s7Saved);
    await page.getByLabel("6-digit code").fill((await latestCode(s7Saved, after)).code);
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await card(page).getByRole("button", { name: "Unlike" }).waitFor({ timeout: 10000 }).catch(() => {});
    check("8c-5. Continuing with email signs in to that account and finishes the Like once", likesBy(s7Saved) === "1" && likesOn() === total0 + 1, `likes ${total0} → ${likesOn()}`);
    check("8c-6. Still one account for the inbox, with email only", accountsForInbox(key) === "1" && providersOf(s7Saved) === "email", providersOf(s7Saved));
    await ctx.close();
  }

  // 8d. Backing out on Google's screen returns to the sign-in sheet; nothing runs, and Not now drops it.
  {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    const total0 = likesOn();
    await page.goto(APP + "/");
    await card(page).getByRole("button", { name: "Like", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await playGoogle(page, "", { cancel: true });
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.waitForURL((u) => u.origin === APP && !u.pathname.startsWith("/auth/"), { timeout: 15000 });
    await page.getByRole("dialog").waitFor({ timeout: 10000 }).catch(() => {});
    check("8d-1. Cancelled: back to the sign-in sheet with the original message, no error", (await page.getByText("Sign in to like stacks").isVisible()) && (await page.getByRole("dialog").getByRole("alert").count()) === 0);
    check("8d-2. Not signed in (no auth cookies at all), nothing liked", (await authCookies(ctx)).length === 0 && likesOn() === total0, (await authCookies(ctx)).join(", "));
    await page.getByRole("button", { name: "Not now" }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.reload();
    await page.waitForTimeout(500);
    check("8d-3. Not now, then a reload: no sheet and still nothing liked", !(await page.getByRole("dialog").isVisible()) && likesOn() === total0);
    await ctx.close();
  }

  // 8e. Leaving for Google and coming back some other way drops the saved action.
  {
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    const total0 = likesOn();
    await page.goto(APP + "/");
    await card(page).getByRole("button", { name: "Like", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await playGoogle(page, "", { away: true });
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.waitForURL(/\/auth\/v1\/authorize/);
    await page.goto(APP + "/");
    await page.waitForTimeout(500);
    const left = await page.evaluate(() => sessionStorage.getItem("stack-pending-sign-in"));
    check("8e. Left Google without signing in: no sheet, the saved action is gone, nothing liked", !(await page.getByRole("dialog").isVisible()) && left === null && likesOn() === total0);
    await ctx.close();
  }

  // 8f. A comment typed while signed out comes back after Google (and isn't posted without the person).
  {
    const gmail = track(`goog.${RUN}.comment@gmail.com`);
    const ctx = await browser.newContext(phone);
    const page = await ctx.newPage();
    const comments0 = sql(`select count(*) from public.comments where stack_id = '${stackId}'`);
    await page.goto(APP + "/");
    const c = card(page);
    await c.getByRole("button", { name: /comment/i }).first().click();
    await c.getByLabel(`Comment on ${STACK_TITLE}`).fill("Great list!");
    await c.getByRole("button", { name: "Post", exact: true }).click();
    await page.getByRole("dialog").waitFor();
    await playGoogle(page, gmail);
    await page.getByRole("button", { name: "Continue with Google" }).click();
    await page.getByRole("heading", { name: "Make it yours" }).waitFor();
    await page.getByLabel("Display name").fill("Comment Tester");
    await page.getByLabel("Username").fill(`gc${RUN}`);
    await page.getByText("✓ Available").waitFor();
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
    const field = card(page).getByLabel(`Comment on ${STACK_TITLE}`);
    await field.waitFor({ timeout: 10000 }).catch(() => {});
    check("8f. The typed comment is back in the open comments, and wasn't posted for them", (await field.inputValue().catch(() => "")) === "Great list!" && sql(`select count(*) from public.comments where stack_id = '${stackId}'`) === comments0);
    await ctx.close();
  }
}

// 6. Keyboard only: Tab and Shift+Tab stay inside the sheet on each step, and closing returns focus to the opener.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(APP + "/");
  const like = page.locator("article", { hasText: STACK_TITLE }).first().getByRole("button", { name: "Like", exact: true });
  // Reach the Like button with Tab alone.
  for (let i = 0; i < 60 && !(await like.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  check("6a. The Like button is reachable with Tab", await like.evaluate((el) => el === document.activeElement));
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  const inside = () => page.evaluate(() => !!document.activeElement && !!document.querySelector('[role="dialog"]')?.contains(document.activeElement));
  const cycle = async (key, n) => {
    const seen = new Set();
    for (let i = 0; i < n; i++) {
      await page.keyboard.press(key);
      if (!(await inside())) return { ok: false, seen };
      seen.add(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent?.trim().slice(0, 30) || document.activeElement?.tagName));
    }
    return { ok: true, seen };
  };
  let r = await cycle("Tab", 8);
  check("6b. Start step: Tab ×8 stays inside the sheet", r.ok, [...r.seen].join(" → "));
  r = await cycle("Shift+Tab", 8);
  check("6c. Start step: Shift+Tab ×8 stays inside the sheet", r.ok, [...r.seen].join(" → "));
  // Move to the email step with the keyboard and check again.
  await page.getByRole("button", { name: "Continue with email" }).focus();
  await page.keyboard.press("Enter");
  await page.getByLabel("Email address").waitFor();
  r = await cycle("Tab", 8);
  const r2 = await cycle("Shift+Tab", 8);
  check("6d. Email step: Tab and Shift+Tab stay inside the sheet", r.ok && r2.ok, [...r.seen].join(" → "));
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.waitForTimeout(100);
  check("6e. Escape closes the sheet and returns focus to the Like button", await like.evaluate((el) => el === document.activeElement));
  // Not now, chosen with the keyboard, does the same.
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Not now" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.waitForTimeout(100);
  check("6f. Not now returns focus to the Like button", await like.evaluate((el) => el === document.activeElement));
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

cleanup();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
