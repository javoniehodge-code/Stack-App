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
  const parts = Object.fromEntries([...DB.matchAll(/(\w+)=('[^']*'|\S+)/g)].map((m) => [m[1], m[2].replace(/^'|'$/g, "")]));
  if (!parts.host?.startsWith("/") || parts.hostaddr || /[,]/.test(parts.host)) refuse("TEST_DB must be a single local Unix socket (host=/…)");
  if (!/^stack_test_[a-z0-9_]+$/.test(parts.dbname ?? "")) refuse("TEST_DB must name a disposable database called stack_test_*");
  let marker;
  try {
    if (read("select current_database()") !== parts.dbname) refuse("connected to a different database than TEST_DB names");
    if (read("select to_regclass('stack_test_env.marker') is not null") !== "t") refuse("the database has no test marker");
    marker = read("select json_agg(m) from stack_test_env.marker m");
  } catch (e) {
    refuse(`couldn't read the test database (${String(e.stderr || e.message).trim().split("\n")[0]})`);
  }
  const rows = JSON.parse(marker || "[]");
  if (rows.length !== 1 || rows[0].token !== TOKEN) refuse("the test marker's token doesn't match TEST_ENV_TOKEN");
  const m = rows[0];
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

async function enterEmail(page, email) {
  await waitForResendWindow(email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  const sentAfter = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  return sentAfter;
}

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

// 0a. A slow code check that finishes after its sheet was closed and another opened from a different action.
//     The late result must not run the first action, close the newer sheet, or sign the browser in.
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const userId = FX.user, stackId = FX.stack;
  resetFixture();
  const likes0 = sql(`select count(*) from public.likes where stack_id = '${stackId}'`);
  const saves0 = sql(`select count(*) from public.saves where stack_id = '${stackId}'`);
  await delayFirstResponse(page, "**/auth/v1/verify", 4000);
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
