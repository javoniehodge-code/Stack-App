// End-to-end checks for themed cards (agreed Nov 27): feed and search cards with the theme band, Follow and the first
// 5 picks; Explore's Trending band with the category; Recently added with the theme square; profile tiles with the
// theme strip. Runs only against the disposable test environment (web/e2e/README.md), after the same read-only target
// checks as the other runners (test-target.mjs). It writes only to the accounts it creates (cards.<run>.*@stack.test)
// and their Stacks, and removes them at the end.
//
//   APP_URL API_URL MAILPIT_URL ANON_KEY TEST_DB TEST_ENV_TOKEN [SHOTS=<dir>]  node web/e2e/cards.e2e.mjs
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
  const email = `cards.${RUN}.${tag}@stack.test`;
  created.push(email);
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  const after = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(await latestCode(email, after));
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await page.getByLabel("Display name").fill(`Cards ${tag.toUpperCase()}`);
  await page.getByLabel("Username").fill(`c${RUN}${tag}`.slice(0, 30));
  await page.getByText("✓ Available").waitFor();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  return sql(`select id from auth.users where email = '${email}'`);
}


const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const ctxA = await browser.newContext(phone);
const pageA = await ctxA.newPage();
const uidA = await signUp(pageA, "a");
const ctxB = await browser.newContext(phone);
const page = await ctxB.newPage();
const uidB = await signUp(page, "b");
const ctxC = await browser.newContext(phone);
const uidC = await signUp(await ctxC.newPage(), "c");
await ctxC.close();
const handleA = sql(`select handle from public.profiles where id = '${uidA}'`);
const handleC = sql(`select handle from public.profiles where id = '${uidC}'`);
const shot = async (pg, name) => SHOTS && (await pg.screenshot({ path: `${SHOTS}/${name}.png` }));

// A's Stacks, written straight to the test database: one with a theme and category chosen in Finalize and 7 picks,
// one published before themes (no theme: it gets the one its title suggests) with 2 picks.
const line = (t) => `{"id":"${crypto.randomUUID()}","text":"${t}","link":null,"format":"num"}`;
const seven = ["Tacos El Gordo", "Contramar", "Pujol", "Rosetta", "Masala y Maiz", "Expendio de Maiz", "Panaderia Rosetta"];
const W = `Tacos ${RUN}`;
const themedId = psql(
  `insert into public.stacks (author_id, title, sections, status, published_at, line_count, theme_emoji, theme_color, categories, visibility)
   values ('${uidA}', '${W} in Mexico City', '[{"label":null,"lines":[${seven.map(line).join(",")}]}]', 'published', now() - interval '2 hours', 7, '🌮', 'oklch(84% 0.12 40)', '{"Food & Drink"}', 'public') returning id`,
  false,
).split("\n")[0];
const plainId = psql(
  `insert into public.stacks (author_id, title, sections, status, published_at, line_count, likes_count, visibility)
   values ('${uidA}', 'Books ${RUN} to read', '[{"label":null,"lines":[${["Dune", "Piranesi"].map(line).join(",")}]}]', 'published', now() - interval '1 hour', 2, 1000000, 'public') returning id`,
  false,
).split("\n")[0];
const card = (pg, title) => pg.locator("article").filter({ has: pg.getByText(title, { exact: true }) });
const follows = (who, whom) => sql(`select count(*) from public.follows where follower_id = '${who}' and followee_id = '${whom}'`) === "1";

// 0. A repost in Following: B follows C, not A; C reposts A's Stack. The card is A's, so its Follow is for A.
psql(`insert into public.follows (follower_id, followee_id) values ('${uidB}', '${uidC}')`, false);
psql(`insert into public.reposts (user_id, stack_id) values ('${uidC}', '${themedId}')`, false);
await page.goto(APP + "/");
await page.getByRole("button", { name: /For you/ }).click();
await page.getByRole("menuitemradio", { name: "Following" }).click();
const rp = page.locator("div").filter({ has: page.getByText("Cards C reposted") }).locator("article").filter({ has: page.getByText(`${W} in Mexico City`, { exact: true }) }).first();
await rp.waitFor({ timeout: 15000 });
const rpFollow = rp.locator("[class*=pmAuthorRow]").getByRole("button");
const rpLabel = (await rpFollow.innerText()).trim();
await shot(page, "repost-follow");
await rpFollow.click();
for (let i = 0; i < 40 && !follows(uidB, uidA); i++) await new Promise((r) => setTimeout(r, 250));
check(
  "0. A repost from someone B follows, of an author B doesn't follow, says Follow; tapping it follows that author (not the reposter)",
  rpLabel === "Follow" && follows(uidB, uidA) && (await rpFollow.innerText()).trim() === "Following",
  `label before: ${rpLabel}, B follows A: ${follows(uidB, uidA)}`,
);
// Back to B not following A, for the checks below.
psql(`delete from public.follows where follower_id = '${uidB}' and followee_id = '${uidA}'`, false);

// 1–4. The feed card: band, author with Follow, the first 5 picks, See all.
await page.goto(APP + "/");
const fc = card(page, `${W} in Mexico City`);
await fc.waitFor({ timeout: 15000 });
const band = (await fc.locator("[data-split]").first().innerText()).replace(/\s+/g, " ");
check("1. The feed card's band shows the theme emoji with the picks count, and the time", /🌮\s*7 picks/.test(band) && /2h/.test(band), band);
const bandBg = await fc.locator("[data-split]").first().evaluate((el) => el.style.background);
check("2. The band is in the chosen theme colour", /oklch\((84%|0\.84) 0\.12 40\)/.test(bandBg), bandBg);
const picks = await fc.locator("[class*=pmNum]").count();
check("3. It shows the first 5 of 7 picks and See all 7 lines", picks === 5 && (await fc.getByText("See all 7 lines").isVisible()), `${picks} picks`);
await shot(page, "feed-card");
await fc.getByRole("button", { name: "Follow" }).first().click();
await page.waitForFunction(() => true);
for (let i = 0; i < 40 && !follows(uidB, uidA); i++) await new Promise((r) => setTimeout(r, 250));
await page.reload();
await card(page, `${W} in Mexico City`).waitFor();
check(
  "4. Follow on a feed card follows the author, and after a reload the card says Following",
  await card(page, `${W} in Mexico City`).getByRole("button", { name: "Following" }).first().isVisible(),
);
const old = card(page, `Books ${RUN} to read`);
const oldBand = (await old.locator("[data-split]").first().innerText()).replace(/\s+/g, " ");
check("5. A Stack published before themes gets the theme its title suggests, with 2 picks", /2 picks/.test(oldBand) && !/🌮/.test(oldBand), oldBand);

// 6–7. Explore: Trending band with the category; Recently added with the theme square and "Name · N picks".
await page.goto(APP + "/explore");
const trend = page.locator("[class*=pmTrending]").filter({ hasText: `Books ${RUN} to read` });
await trend.waitFor({ timeout: 10000 });
const tBand = (await trend.locator("[data-split]").innerText()).replace(/\s+/g, " ");
check("6. A Trending card has the small band with the picks count", /2 picks/.test(tBand), tBand);
const recent = page.locator("a[class*=recentStack]").filter({ hasText: `${W} in Mexico City` });
const rText = (await recent.innerText()).replace(/\s+/g, " ");
check(
  "7. Recently added shows the theme emoji, \"Cards A · 7 picks\", and links to the readable address",
  rText.includes("🌮") && rText.includes("Cards A · 7 picks") && (await recent.getAttribute("href")).startsWith(`/${handleA}/`),
  rText,
);
await shot(page, "explore");
const trendT = page.locator("[class*=pmTrending]").filter({ hasText: `${W} in Mexico City` });
if (await trendT.count()) check("6b. The themed Stack's Trending band shows its category", (await trendT.locator("[data-split]").innerText()).includes("Food & Drink"));

// 8. Search results are feed cards.
await page.goto(APP + `/explore?q=${encodeURIComponent(W)}`);
const sc = card(page, `${W} in Mexico City`);
await sc.waitFor({ timeout: 10000 });
check("8. A search result is a feed card with the band, Following and See all", /🌮\s*7 picks/.test(await sc.innerText()) && (await sc.getByText("See all 7 lines").isVisible()) && (await sc.getByRole("button", { name: "Following" }).first().isVisible()));
await shot(page, "search");

// 8b. Search results load their comments: C's comment shows when the discussion opens, and B can reply to it.
psql(`insert into public.comments (stack_id, author_id, body) values ('${themedId}', '${uidC}', 'Try the al pastor ${RUN}')`, false);
await page.goto(APP + `/explore?q=${encodeURIComponent(W)}`);
const sc2 = card(page, `${W} in Mexico City`);
await sc2.waitFor({ timeout: 10000 });
const toggle = sc2.getByRole("button", { name: /View 1 comment/ });
const toggleShown = await toggle.isVisible();
await sc2.locator("[class*=commentToggle]").first().click();
const commentShown = await sc2.getByText(`Try the al pastor ${RUN}`).isVisible();
let reply = "";
if (commentShown) {
  await sc2.getByRole("button", { name: "Reply", exact: true }).first().click();
  await sc2.getByLabel(`Reply to @${handleC}`).fill(`Will do ${RUN}`);
  await sc2.getByRole("button", { name: "Post", exact: true }).click();
}
for (let i = 0; i < 40 && commentShown && !reply; i++) {
  reply = sql(`select r.body from public.comments r join public.comments c on c.id = r.parent_id where c.stack_id = '${themedId}' and r.author_id = '${uidB}' and c.author_id = '${uidC}'`);
  if (!reply) await new Promise((r) => setTimeout(r, 250));
}
const replyShown = await sc2.getByText(`Will do ${RUN}`).isVisible().catch(() => false);
await shot(page, "search-comments");
check(
  "8b. A search result shows \"View 1 comment\", opens to C's comment, and B's reply is saved as a reply to it and shown",
  toggleShown && commentShown && reply.includes(`Will do ${RUN}`) && replyShown,
  `toggle ${toggleShown} · comment ${commentShown} · saved "${reply}" · shown ${replyShown}`,
);

// 9. Profile tiles: a strip in the theme with its emoji.
await page.goto(APP + `/${handleA}`);
const tile = page.locator("[class*=gridCard]").filter({ hasText: `${W} in Mexico City` });
await tile.waitFor({ timeout: 10000 });
const strip = tile.locator("[class*=gridStrip]");
check("9. A profile tile has the theme strip with the emoji", (await strip.innerText()).includes("🌮") && /oklch\((84%|0\.84) 0\.12 40\)/.test(await strip.evaluate((el) => el.style.background)));
await shot(page, "profile");
await pageA.goto(APP + "/profile");
const ownTile = pageA.locator("[class*=gridCard]").filter({ hasText: `Books ${RUN} to read` });
await ownTile.waitFor({ timeout: 10000 });
check("10. Your own profile's tiles have the strip too", (await ownTile.locator("[class*=gridStrip]").count()) === 1);

// 11. Nothing overflows sideways on a 320 px phone.
const narrow = await browser.newContext({ ...phone, viewport: { width: 320, height: 640 }, storageState: await ctxB.storageState() });
const np = await narrow.newPage();
let wide = [];
for (const p of ["/", "/explore", `/explore?q=${encodeURIComponent(W)}`, `/${handleA}`]) {
  await np.goto(APP + p);
  await np.waitForLoadState("networkidle");
  if (await np.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) wide.push(p);
}
check("11. On a 320 px phone none of these pages scroll sideways", wide.length === 0, wide.join(" "));
await shot(np, "explore-320");

await browser.close();
psql(`delete from public.stacks where id in ('${themedId}', '${plainId}')`, false);
cleanup();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
