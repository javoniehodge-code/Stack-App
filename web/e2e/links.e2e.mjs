// End-to-end checks for readable links (agreed Nov 27): a Stack at /{username}/{slug} and a profile at /{username};
// the older /s/{id} and /u/{username} forward there; after a username change the old links forward to the new one,
// the old username stays reserved to its owner, and switching back works. Runs only against the disposable test environment (web/e2e/README.md), after the same
// read-only target checks as the other runners (test-target.mjs). It writes only to the account it creates
// (links.<run>.*@stack.test) and removes it at the end, with its drafts and stacks.
//
//   APP_URL API_URL MAILPIT_URL ANON_KEY TEST_DB TEST_ENV_TOKEN [SHOTS=<dir>]  node web/e2e/links.e2e.mjs
import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { verifyTestDatabase } from "./test-target.mjs";

const refuse = (why) => {
  console.error(`refusing to run: ${why}`);
  process.exit(2);
};
const env = (k) => process.env[k] || refuse(`set ${k}`);
const APP = env("APP_URL"), API = env("API_URL"), MAIL = env("MAILPIT_URL"), DB = env("TEST_DB"), TOKEN = env("TEST_ENV_TOKEN");
const SHOTS = process.env.SHOTS || "";
const RUN = Date.now().toString(36);

const psql = (q, readOnly) =>
  execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", DB, "-c", q], {
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: readOnly ? "-c default_transaction_read_only=on" : "" },
  }).trim();
const sql = (q) => psql(q, true);

for (const u of [APP, API, MAIL]) if (!["localhost", "127.0.0.1"].includes(new URL(u).hostname)) refuse(`${u} isn't local`);
verifyTestDatabase({ conn: DB, token: TOKEN, read: sql, refuse });
if (!(await fetch(`${MAIL}/api/v1/info`).then((r) => r.ok).catch(() => false))) refuse("MAILPIT_URL isn't a Mailpit inbox");
if (sql("select to_regproc('public.current_handle') is not null") !== "t") refuse("the readable links migration isn't applied to the test database");
console.log(`target verified: ${new URL(APP).host}, database ${sql("select current_database()")}`);

const created = [];
const cleanup = () => {
  if (created.length) psql(`delete from auth.users where email in (${created.map((e) => `'${e}'`).join(",")})`, false);
  console.log(`cleaned up ${created.length} accounts created by this run`);
};
process.on("uncaughtException", (e) => {
  console.error(e);
  try {
    cleanup();
  } finally {
    process.exit(1);
  }
});

/** Picks Food & Drink when no category is picked, and answers No to the place question when the city is empty, so the
 *  Stacks below are published as they were when categories and the city were required (Task 3; optional since Nov 27). */
async function readyToPublish(page) {
  const cat = page.getByRole("button", { name: "Food & Drink" });
  await cat.waitFor({ timeout: 5000 }).catch(() => {});
  if ((await cat.count()) && !(await page.locator("button[class*=catChip][aria-pressed=true]").count())) await cat.click();
  const city = page.getByLabel("City");
  if ((await city.isVisible().catch(() => false)) && !(await city.inputValue())) await page.getByRole("radio", { name: "No" }).click();
}

const results = [];
const check = (name, ok, detail = "") => {
  results.push(!!ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function latestCode(email, after) {
  for (let i = 0; i < 40; i++) {
    const r = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`)).json();
    const m = (r.messages || []).find((x) => new Date(x.Created).getTime() > after);
    if (m) return ((await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json()).Text.match(/\b(\d{6})\b/) || [])[1];
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`no email for ${email}`);
}

async function signUp(page, tag) {
  const email = `links.${RUN}.${tag}@stack.test`;
  created.push(email);
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  const after = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(await latestCode(email, after));
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await page.getByLabel("Display name").fill(`Links ${tag.toUpperCase()}`);
  await page.getByLabel("Username").fill(`l${RUN}${tag}`.slice(0, 30));
  await page.getByText("✓ Available").waitFor();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  return sql(`select id from auth.users where email = '${email}'`);
}

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const ctx = await browser.newContext(phone);
const page = await ctx.newPage();
const uid = await signUp(page, "a");
const handleA = sql(`select handle from public.profiles where id = '${uid}'`);
const pathOf = (pg) => decodeURIComponent(new URL(pg.url()).pathname) + new URL(pg.url()).search;
const draftIdOf = (pg) => (new URL(pg.url()).pathname.match(/^\/drafts\/([0-9a-f-]{36})$/) || [])[1];

// A published Stack, as in the real account: "Cities to Travel To".
await page.goto(APP + "/new");
await page.getByLabel("Title").fill("Cities to Travel To");
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Skip" }).click();
await page.getByRole("textbox", { name: "Item heading" }).fill("Tokyo");
await page.getByRole("button", { name: "Done", exact: true }).last().click();
const id = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
await page.getByRole("button", { name: "Finalize" }).click();
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const slug = sql(`select slug from public.stacks where id = '${id}'`);
const readable = `/${handleA}/cities-to-travel-to`;
await page.waitForURL((u) => u.pathname === readable, { timeout: 10000 }).catch(() => {});
check("1. After publishing, the address is the readable one: /{username}/cities-to-travel-to", slug === "cities-to-travel-to" && pathOf(page) === readable, pathOf(page));

// 2. Visitors (signed out): the readable addresses work, and the old ones forward to them.
const guestCtx = await browser.newContext(phone);
const guest = await guestCtx.newPage();
await guest.goto(APP + readable);
const stackShown = await guest.getByRole("heading", { name: "Cities to Travel To" }).isVisible().catch(() => false) || (await guest.getByText("Cities to Travel To").first().isVisible());
await guest.goto(APP + `/s/${id}`);
await guest.waitForURL((u) => u.pathname === readable, { timeout: 10000 }).catch(() => {});
const fromOld = pathOf(guest);
await guest.goto(APP + `/s/${id}?comment=1`);
await guest.waitForURL((u) => u.pathname === readable, { timeout: 10000 }).catch(() => {});
const fromOldQuery = pathOf(guest);
await guest.goto(APP + `/${handleA}`);
const profileShown = await guest.getByText("Links A").first().isVisible().catch(() => false);
await guest.goto(APP + `/u/${handleA}`);
await guest.waitForURL((u) => u.pathname === `/${handleA}`, { timeout: 10000 }).catch(() => {});
const fromOldProfile = pathOf(guest);
check(
  "2. The Stack opens at /{username}/{slug} and the profile at /{username}; /s/{id} (keeping ?comment=1) and /u/{username} forward to them",
  stackShown && fromOld === readable && fromOldQuery === `${readable}?comment=1` && profileShown && fromOldProfile === `/${handleA}`,
  `${fromOld} · ${fromOldQuery} · profile ${profileShown} · ${fromOldProfile}`,
);

// 3. Tapping the Stack on the profile opens its readable address; the author's name on the Stack opens /{username}.
await guest.goto(APP + `/${handleA}`);
await guest.getByText("Cities to Travel To").first().click();
await guest.waitForURL((u) => u.pathname === readable, { timeout: 10000 }).catch(() => {});
const cardTo = pathOf(guest);
await guest.getByText("Links A").first().click();
await guest.waitForURL((u) => u.pathname === `/${handleA}`, { timeout: 10000 }).catch(() => {});
const authorTo = pathOf(guest);
// Your own /{username} is your Profile tab.
await page.goto(APP + `/${handleA}`);
await page.waitForURL(/\/profile$/, { timeout: 10000 }).catch(() => {});
check("3. Links use the readable addresses: a profile's Stack card and a Stack's author; your own /{username} opens your Profile", cardTo === readable && authorTo === `/${handleA}` && pathOf(page) === "/profile", `${cardTo} · ${authorTo} · ${pathOf(page)}`);

// 4. A new username: the Stack moves to it, and the old links forward to the new ones.
const handleB = `${handleA}x`.slice(0, 30);
psql(`update public.profiles set handle = '${handleB}' where id = '${uid}'`, false);
const movedTo = `/${handleB}/cities-to-travel-to`;
await guest.goto(APP + readable);
await guest.waitForURL((u) => u.pathname === movedTo, { timeout: 10000 }).catch(() => {});
const oldStack = pathOf(guest);
const oldStackShown = await guest.getByText("Cities to Travel To").first().isVisible().catch(() => false);
await guest.goto(APP + `/${handleA}`);
await guest.waitForURL((u) => u.pathname === `/${handleB}`, { timeout: 10000 }).catch(() => {});
const oldProfile = pathOf(guest);
await guest.goto(APP + `/s/${id}`);
await guest.waitForURL((u) => u.pathname === movedTo, { timeout: 10000 }).catch(() => {});
const oldId = pathOf(guest);
check(
  "4. After a username change, the old /{old}/{slug} and /{old} forward to the new username, and /s/{id} goes to the new address",
  oldStack === movedTo && oldStackShown && oldProfile === `/${handleB}` && oldId === movedTo && sql(`select user_id from public.past_handles where handle = '${handleA}'`) === uid,
  `${oldStack} · ${oldProfile} · ${oldId}`,
);

// 5. Nobody else can take the old username: the live hint says no, and saving it is refused. Its owner can.
const uidB = await signUp(guest, "b");
const asUser = (who, q) => {
  try {
    return execFileSync("psql", ["-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", DB], {
      encoding: "utf8",
      input: `begin;\nset local role authenticated;\nselect set_config('request.jwt.claims', '{"sub":"${who}","role":"authenticated"}', true) is not null as ok \\g /dev/null\n${q};\nrollback;\n`,
    }).trim();
  } catch (e) {
    return String(e.stderr || e.message);
  }
};
const hintOther = asUser(uidB, `select public.handle_available('${handleA}')`);
const takeOther = asUser(uidB, `update public.profiles set handle = '${handleA}' where id = '${uidB}'`);
const hintOwner = asUser(uid, `select public.handle_available('${handleA}')`);
const reservedFile = asUser(uidB, "select public.handle_available('favicon.ico')");
check(
  "5. Someone else can't take the old username (the hint says no; saving it is refused as unavailable); its owner can; file names like favicon.ico can't be usernames",
  hintOther === "f" && takeOther.includes("that username isn't available") && hintOwner === "t" && reservedFile === "f",
  JSON.stringify({ hintOther, takeOther: takeOther.slice(0, 80), hintOwner, reservedFile }),
);

// 6. Switching back to the old username works: the Stack is back at its first address, and the in-between username
//    forwards there.
psql(`update public.profiles set handle = '${handleA}' where id = '${uid}'`, false);
await guest.goto(APP + movedTo);
await guest.waitForURL((u) => u.pathname === readable, { timeout: 10000 }).catch(() => {});
const backTo = pathOf(guest);
check(
  "6. Back to the old username: the Stack is at /{old}/{slug} again, and the in-between username's links forward there",
  backTo === readable && sql(`select count(*) from public.past_handles where handle = '${handleA}'`) === "0" && sql(`select user_id from public.past_handles where handle = '${handleB}'`) === uid,
  backTo,
);

// 7. A private Stack stays private at its readable address: visitors get the not-found page.
psql(`update public.stacks set visibility = 'private' where id = '${id}'`, false);
await guestCtx.clearCookies();
await guest.goto(APP + readable);
const hidden = !(await guest.getByText("Cities to Travel To").first().isVisible().catch(() => false));
await page.goto(APP + readable);
const ownerSees = await page.getByText("Cities to Travel To").first().isVisible().catch(() => false);
check("7. A private Stack's readable address shows nothing to a visitor, and the Stack to its owner", hidden && ownerSees, `hidden ${hidden} · owner ${ownerSees}`);

// 8. A Stack's page fills the screen at its readable address (no tab bar), opened directly, from a card, or through
//    an old /s/{id} link; the tab bar still shows on other screens (home, Explore, a profile, a followers list).
await page.goto(APP + "/profile");
const tabBar = (pg) => pg.locator('nav[aria-label="Main"]').isVisible().catch(() => false);
psql(`update public.stacks set visibility = 'public' where id = '${id}'`, false);
const nav8 = {};
await guest.goto(APP + readable);
await guest.getByText("Cities to Travel To").first().waitFor({ timeout: 10000 }).catch(() => {});
nav8.direct = await tabBar(guest);
await guest.goto(APP + `/${handleA}`);
await guest.getByText("Cities to Travel To").first().waitFor({ timeout: 10000 }).catch(() => {});
nav8.profile = await tabBar(guest);
await guest.getByText("Cities to Travel To").first().click();
await guest.waitForURL((u) => u.pathname === readable, { timeout: 10000 }).catch(() => {});
nav8.card = await tabBar(guest);
await guest.goto(APP + `/s/${id}`);
await guest.waitForURL((u) => u.pathname === readable, { timeout: 10000 }).catch(() => {});
await guest.getByText("Cities to Travel To").first().waitFor({ timeout: 10000 }).catch(() => {});
nav8.oldLink = await tabBar(guest);
for (const path of ["/", "/explore", `/u/${handleA}/followers`]) {
  await guest.goto(APP + path);
  await guest.locator('nav[aria-label="Main"]').waitFor({ timeout: 10000 }).catch(() => {});
  nav8[path] = await tabBar(guest);
}
check(
  "8. No tab bar on a Stack at its readable address (opened directly, from a profile's card, or through /s/{id}); the tab bar shows on home, Explore, a profile and a followers list",
  !nav8.direct && !nav8.card && !nav8.oldLink && nav8.profile && nav8["/"] && nav8["/explore"] && nav8[`/u/${handleA}/followers`],
  JSON.stringify(nav8),
);

// 9. Two overlapping transactions: while A changes their username away from handleA (not yet committed), B tries to
//    take handleA. B must wait for A and then be refused, and handleA stays A's; A can switch back to it after.
const session = (sqlText) => {
  const p = spawn("psql", ["-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", DB], { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  p.stdout.on("data", (b) => (out += b));
  p.stderr.on("data", (b) => (out += b));
  const done = new Promise((ok) => p.on("exit", (code) => ok({ code, out })));
  p.stdin.write(sqlText);
  return { p, done, out: () => out };
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const handleC = `${handleA}y`.slice(0, 30);
const a9 = session(`begin;\nupdate public.profiles set handle = '${handleC}' where id = '${uid}';\nselect 'held';\n`);
for (let i = 0; i < 50 && !a9.out().includes("held"); i++) await sleep(100);
const b9 = session(`update public.profiles set handle = '${handleA}' where id = '${uidB}';\n`);
b9.p.stdin.end();
let bWaited = false;
for (let i = 0; i < 50 && !bWaited; i++) {
  await sleep(100);
  bWaited = sql(`select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%update public.profiles set handle%' and query not like '%pg_stat_activity%'`) !== "0";
}
a9.p.stdin.end("commit;\n");
const [ra, rb] = await Promise.all([a9.done, b9.done]);
const after9 = { a: sql(`select handle from public.profiles where id = '${uid}'`), b: sql(`select handle from public.profiles where id = '${uidB}'`), owner: sql(`select user_id from public.past_handles where handle = '${handleA}'`) };
// A switches back to handleA.
let back9 = "";
try {
  psql(`update public.profiles set handle = '${handleA}' where id = '${uid}'`, false);
  back9 = sql(`select handle from public.profiles where id = '${uid}'`);
} catch (e) {
  back9 = String(e.stderr || e.message).slice(0, 120);
}
await guest.goto(APP + `/${handleC}/cities-to-travel-to`);
await guest.waitForURL((u) => u.pathname === readable, { timeout: 10000 }).catch(() => {});
check(
  "9. Overlapping: while A retires a username, B trying to take it waits and is refused; it stays A's, and A can switch back to it (A's in-between username then forwards)",
  ra.code === 0 && bWaited && rb.code !== 0 && rb.out.includes("that username isn't available") && after9.a === handleC && after9.b !== handleA && after9.owner === uid &&
    back9 === handleA && pathOf(guest) === readable,
  JSON.stringify({ aCode: ra.code, bWaited, bCode: rb.code, b: rb.out.trim().slice(0, 90), after9, back9, at: pathOf(guest) }),
);

await browser.close();
cleanup();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\n${results.length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
