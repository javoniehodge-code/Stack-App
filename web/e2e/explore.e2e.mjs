// End-to-end checks for categories in Explore and search (agreed Nov 27, part 2): the 12 categories with their emoji and
// colour, 6 shown then "More categories"; tapping one shows only the Stacks in it (choice 2A); search also matches a
// category's name and still matches the title, city, name and username; a Back button instead of Cancel. Runs only
// against the disposable test environment (web/e2e/README.md), after the same read-only target checks as the other
// runners (test-target.mjs). It writes only to the accounts it creates (explore.<run>.*@stack.test) and their
// Stacks, and removes them at the end.
//
//   APP_URL API_URL MAILPIT_URL ANON_KEY TEST_DB TEST_ENV_TOKEN [SHOTS=<dir>]  node web/e2e/explore.e2e.mjs
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
if (sql("select to_regproc('public.category_stacks') is not null") !== "t") refuse("the explore categories migration isn't applied to the test database");
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

const results_ = [];
const check = (name, ok, detail = "") => {
  results_.push(!!ok);
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
  const email = `explore.${RUN}.${tag}@stack.test`;
  created.push(email);
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  const after = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(await latestCode(email, after));
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await page.getByLabel("Display name").fill(`Explore ${tag.toUpperCase()}`);
  await page.getByLabel("Username").fill(`e${RUN}${tag}`.slice(0, 30));
  await page.getByText("✓ Available").waitFor();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  return sql(`select id from auth.users where email = '${email}'`);
}



const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const ctxA = await browser.newContext(phone);
const uidA = await signUp(await ctxA.newPage(), "a");
await ctxA.close();
const ctx = await browser.newContext(phone);
const page = await ctx.newPage();
const uidB = await signUp(page, "b");
const handleA = sql(`select handle from public.profiles where id = '${uidA}'`);
const shot = async (pg, name) => SHOTS && (await pg.screenshot({ path: `${SHOTS}/${name}.png` }));
const pathOf = (pg) => decodeURIComponent(new URL(pg.url()).pathname + new URL(pg.url()).search);

// A's Stacks, written straight to the test database.
const line = (t) => `{"id":"${crypto.randomUUID()}","text":"${t}","link":null,"format":"num"}`;
const stack = (title, cats, extra = {}) =>
  psql(
    `insert into public.stacks (author_id, title, sections, status, published_at, line_count, categories, visibility, likes_count, location)
     values ('${uidA}', '${title}', '[{"label":null,"lines":[${line("One")}]}]', 'published', now(), 1, '${cats}', '${extra.visibility ?? "public"}', ${extra.likes ?? 0}, '${extra.location ?? ""}') returning id`,
    false,
  ).split("\n")[0];
const ramen = `Ramen ${RUN}`, hikes = `Hikes ${RUN}`, foodPhotos = `Food photos ${RUN}`, secret = `Secret supper ${RUN}`;
const ids = [
  stack(ramen, '{"Food & Drink"}', { likes: 900000, location: `Sapporo${RUN}` }),
  stack(hikes, '{"Sports & Outdoors","Travel & Places"}', { likes: 800000 }),
  stack(foodPhotos, '{"Art & Design"}'), // "Food" in its title, but not in Food & Drink
  stack(secret, '{"Food & Drink"}', { visibility: "unlisted", likes: 950000 }), // unlisted: never in Explore
];
const results = () => page.locator("article[class*=pmFeedCard] [class*=pmTitle]").allInnerTexts();
const waitResults = async () => {
  await page.getByText(/^\d+ stacks?$/).waitFor({ timeout: 15000 });
};

// 1–2. Explore: 6 chips with emoji and colour, then a dashed More categories; 6 boxes, with sample titles.
await page.goto(APP + "/explore");
const chips = page.locator("[class*=chips] button");
const chipTexts = (await chips.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
check(
  "1. Six category chips with their emoji (🍜 Food & Drink … 🏺 Home & Living), then More categories",
  chipTexts.length === 7 && chipTexts[0] === "🍜 Food & Drink" && chipTexts[5] === "🏺 Home & Living" && chipTexts[6] === "More categories",
  chipTexts.join(" | "),
);
const boxes = page.locator("button[class*=category]");
const foodBox = (await boxes.first().innerText()).replace(/\s+/g, " ");
const foodBg = await boxes.first().evaluate((el) => el.style.background);
check(
  "2. Six category boxes; Food & Drink in its colour, with its most-liked public Stack and not the unlisted one",
  (await boxes.count()) === 6 && foodBox.includes(ramen) && !foodBox.includes(secret) && /0\.84 0\.12 40|84% 0\.12 40/.test(foodBg),
  `${await boxes.count()} boxes · ${foodBox} · ${foodBg}`,
);
await shot(page, "explore-top");

// 3. More categories · 6 more, then Fewer categories.
const more = page.getByRole("button", { name: "More categories · 6 more" });
await more.click();
const twelve = await boxes.count();
const fewer = await page.getByRole("button", { name: "Fewer categories" }).isVisible();
await page.getByRole("button", { name: "Fewer categories" }).click();
check("3. More categories · 6 more shows all 12; Fewer categories goes back to 6", twelve === 12 && fewer && (await boxes.count()) === 6, `${twelve} then ${await boxes.count()}`);

// 4. The dashed chip opens the full grid and scrolls to it.
await page.locator("[class*=chipMore]").click();
await page.waitForTimeout(800);
const gridTop = await page.getByRole("heading", { name: "Categories" }).evaluate((el) => el.getBoundingClientRect().top);
check("4. The More categories chip opens all 12 and scrolls to them", (await boxes.count()) === 12 && gridTop >= 0 && gridTop < 300, `top ${Math.round(gridTop)}`);
await shot(page, "explore-categories");

// 5. Tapping a category box shows only the Stacks in it (2A).
await boxes.filter({ hasText: "Sports & Outdoors" }).click();
await page.waitForURL(/cat=/);
await waitResults();
const sports = await results();
check(
  "5. Tapping Sports & Outdoors shows its Stacks only, under its name, at /explore?cat=Sports & Outdoors",
  pathOf(page) === "/explore?cat=Sports & Outdoors" && sports.includes(hikes) && !sports.includes(ramen) && (await page.getByRole("heading", { name: "Sports & Outdoors" }).isVisible()),
  `${pathOf(page)} · ${sports.join(", ")}`,
);

// 6. Back returns to Explore; there's no Cancel button.
const cancel = await page.getByRole("button", { name: "Cancel" }).count();
await page.getByRole("button", { name: "Back to Explore" }).click();
await page.waitForURL((u) => u.pathname === "/explore" && !u.search);
check("6. Back (not Cancel) clears the category and returns to Explore", cancel === 0 && (await chips.count()) === 7 && (await page.getByRole("button", { name: "Back to Explore" }).count()) === 0);

// 7. A chip: Food & Drink shows Ramen, not "Food photos" (Food in its title only) and not the unlisted one.
await chips.first().click();
await page.waitForURL(/cat=/);
await waitResults();
const food = await results();
check(
  "7. The Food & Drink chip shows only Stacks in Food & Drink: not one with Food in its title, nor an unlisted one",
  food.includes(ramen) && !food.includes(foodPhotos) && !food.includes(secret),
  food.join(", "),
);
await shot(page, "explore-category");

// 8. An empty category.
await page.goto(APP + "/explore?cat=Games %26 Hobbies");
const empty = await page.getByText("Nothing in Games & Hobbies yet").isVisible();
check("8. An empty category says Nothing in Games & Hobbies yet", empty);

// 9. Addresses: any letter case works; an unknown category shows Explore.
await page.goto(APP + "/explore?cat=food %26 drink");
await waitResults();
const lower = (await results()).includes(ramen) && (await page.getByRole("heading", { name: "Food & Drink" }).isVisible());
await page.goto(APP + "/explore?cat=Books");
const unknown = (await chips.count()) === 7;
check("9. /explore?cat=food & drink opens Food & Drink; an unknown category shows Explore", lower && unknown);

// 10–11. Search: a category's name, and still the title, city, name and username.
const search = async (q) => {
  await page.goto(APP + "/explore");
  const box = page.getByRole("searchbox", { name: "Search stacks" });
  await box.fill(q);
  await box.press("Enter");
  await page.waitForURL(/q=/);
  await waitResults();
  return results();
};
const byCat = await search("outdoors");
check("10. Searching \"outdoors\" finds a Stack by its category (Sports & Outdoors)", byCat.includes(hikes), byCat.join(", "));
const byTitle = await search(`Ramen ${RUN}`), byCity = await search(`Sapporo${RUN}`), byName = await search("Explore A"), byHandle = await search(`@${handleA}`);
check(
  "11. Search still matches the title, city, name and @username",
  byTitle.includes(ramen) && byCity.includes(ramen) && byName.includes(ramen) && byHandle.includes(hikes) && !byHandle.includes(secret),
  `${byTitle.length} · ${byCity.length} · ${byName.length} · ${byHandle.length}`,
);
const backOnSearch = await page.getByRole("button", { name: "Back to Explore" }).isVisible();
await shot(page, "search-back");
check("12. A search shows Back too", backOnSearch);

// 13. Trending shows a Stack's category on its band.
await page.goto(APP + "/explore");
const trend = page.locator("[class*=pmTrending]").filter({ hasText: ramen });
check("13. Trending shows the Stack's category on its band", (await trend.locator("[data-split]").innerText()).includes("Food & Drink"));

// 14. Nothing scrolls sideways on a 320 px phone.
const narrow = await browser.newContext({ ...phone, viewport: { width: 320, height: 640 } });
const np = await narrow.newPage();
const wide = [];
for (const p of ["/explore", "/explore?cat=Entertainment %26 Culture", "/explore?q=outdoors"]) {
  await np.goto(APP + p);
  await np.waitForLoadState("networkidle");
  if (p === "/explore") await np.getByRole("button", { name: "More categories · 6 more" }).click();
  if (await np.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) wide.push(p);
}
await shot(np, "explore-320");
check("14. On a 320 px phone none of these pages scroll sideways (all 12 categories open)", wide.length === 0, wide.join(" "));

await browser.close();
psql(`delete from public.stacks where id in (${ids.map((i) => `'${i}'`).join(",")})`, false);
cleanup();
const failed = results_.filter((r) => !r).length;
console.log(`\n${results_.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
