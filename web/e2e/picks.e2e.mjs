// End-to-end checks for the pick editor (Task 2b): picks with a heading, subheading, link and tags; the tags tray;
// counters that never cut text; the 15-item and 5-section limits; Undo on delete; older content converting; and
// publishing picks with stable ids and tags. Runs only against the disposable test environment (web/e2e/README.md),
// after the same read-only target checks as the other runners (test-target.mjs). It writes only to the account it
// creates (picks.<run>.*@stack.test) and removes it at the end, with its drafts and stacks.
//
//   APP_URL API_URL MAILPIT_URL ANON_KEY TEST_DB TEST_ENV_TOKEN [SHOTS=<dir>]  node web/e2e/picks.e2e.mjs
import { execFileSync } from "node:child_process";
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
if (sql("select to_regproc('public.one_line') is not null") !== "t") refuse("the pick_model migration isn't applied to the test database");
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

async function signUp(page) {
  const email = `picks.${RUN}.a@stack.test`;
  created.push(email);
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  const after = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(await latestCode(email, after));
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await page.getByLabel("Display name").fill("Picks Tester");
  await page.getByLabel("Username").fill(`p${RUN}`.slice(0, 30));
  await page.getByText("✓ Available").waitFor();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  return sql(`select id from auth.users where email = '${email}'`);
}

const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
const lines = (id) => JSON.parse(sql(`select coalesce(content->'sections', '[]') from public.drafts where id = '${id}'`) || "[]").flatMap((s) => s.lines);
/** Waits until the draft's saved content passes `ok`. */
async function until(page, id, ok) {
  for (let i = 0; i < 60; i++) {
    if (ok(lines(id))) return true;
    await page.waitForTimeout(250);
  }
  return false;
}
const draftIdOf = (page) => (new URL(page.url()).pathname.match(/^\/drafts\/([0-9a-f-]{36})$/) || [])[1];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Puts a draft for this account straight into the drafts table (it's this run's own account) and opens it. */
async function seed(page, uid, content) {
  const id = sql("select gen_random_uuid()");
  psql(`insert into public.drafts (id, owner_id, content, step) values ('${id}', '${uid}', '${JSON.stringify({ v: 1, ...content }).replace(/'/g, "''")}', 'build')`, false);
  await page.goto(APP + `/drafts/${id}`);
  return id;
}
const pick = (i, extra = {}) => ({ text: `Pick ${i}`, link: null, format: "num", ...extra });

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const uid = await signUp(page);

// 1. The save status shows from the first page.
await page.goto(APP + "/new");
await page.getByLabel("Title").fill(`Late-night tacos ${RUN}`);
await page.getByText("Saved just now").waitFor({ timeout: 10000 }).catch(() => {});
check("1. On the Title page the status says Saved just now", await page.getByText("Saved just now").isVisible());
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Skip" }).click();

// 2. A pick: heading and subheading, saved with a stable id. Line breaks become spaces.
const heading = page.getByRole("textbox", { name: "Item heading" });
await heading.fill("Taquería\nOrinoco");
await page.getByRole("textbox", { name: "Item subheading" }).fill("Trompo tacos until 3am.");
const id = draftIdOf(page) ?? (await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page)));
await until(page, id, (ls) => ls[0]?.note === "Trompo tacos until 3am.");
const first = lines(id)[0];
check("2. A pick saves its heading and subheading (line breaks become spaces) with a stable id", first?.text === "Taquería Orinoco" && first.note === "Trompo tacos until 3am." && UUID.test(first.id ?? ""), JSON.stringify(first));
const pickId = first?.id;

// No per-item note (over a limit, missing a heading, an older web address) shows anywhere.
const noNotes = async () => !(await page.getByText(/^(heading|subheading) \d+\/\d+ · \d+ over$|^Needs a (heading|title)\.$|^Still has /).first().isVisible());

// 3. The tags tray: suggested tags, one price at a time, a typed tag, and at most 3.
await page.getByRole("button", { name: "Tags", exact: true }).click();
const tray = page.getByRole("menu", { name: "Tags" });
await tray.getByRole("menuitemcheckbox", { name: "Late night", exact: true }).click();
await tray.getByRole("menuitemcheckbox", { name: "$", exact: true }).click();
await tray.getByRole("menuitemcheckbox", { name: "$$", exact: true }).click();
await until(page, id, (ls) => (ls[0]?.tags ?? []).join() === "Late night,$$");
check("3a. Choosing a second price swaps it in: Late night and $$", (lines(id)[0]?.tags ?? []).join() === "Late night,$$", JSON.stringify(lines(id)[0]?.tags));
const own = tray.getByLabel("Your own");
await own.fill("Outdoor seating with heaters");
check(
  "3b. A typed tag over 20 characters shows how far over and can't be added",
  (await tray.getByText("28/20 · 8 over. Shorten it to add.").isVisible()) && (await tray.getByRole("button", { name: "Add", exact: true }).getAttribute("aria-disabled")) === "true",
);
await own.fill("Outdoor seating");
await tray.getByRole("button", { name: "Add", exact: true }).click();
await until(page, id, (ls) => (ls[0]?.tags ?? []).length === 3);
await shot(page, "tags-tray-full");
const brunch = tray.getByRole("menuitemcheckbox", { name: "Brunch", exact: true });
await brunch.click({ force: true });
await page.waitForTimeout(1500);
check(
  "3c. At 3 tags the others dim, the tray says why, and a 4th can't be added",
  (lines(id)[0]?.tags ?? []).join() === "Late night,$$,Outdoor seating" && (await brunch.getAttribute("aria-disabled")) === "true" && (await tray.getByText("This item has 3 tags. Remove one to add another.").isVisible()),
  JSON.stringify(lines(id)[0]?.tags),
);
await tray.getByRole("button", { name: "Remove tag $$" }).click();
await until(page, id, (ls) => (ls[0]?.tags ?? []).length === 2);
check("3d. Tapping a chosen tag removes it", (lines(id)[0]?.tags ?? []).join() === "Late night,Outdoor seating");
await tray.getByRole("menuitemcheckbox", { name: "$", exact: true }).click();
await tray.getByRole("button", { name: "Done", exact: true }).click();
await until(page, id, (ls) => (ls[0]?.tags ?? []).length === 3);

// 4. Counters: shown near a limit, explained past it; text is never cut.
const long = "Tacos al pastor, suadero and campechano at the stand by the metro, open very late on Fridays";
await heading.fill(long);
await until(page, id, (ls) => ls[0]?.text === long);
await shot(page, "heading-over");
const overText = `heading ${long.length}/80 · ${long.length - 80} over`;
check(
  "4a. A long heading isn't cut: the counter says how far over, and there's no warning box above the picks",
  (await heading.inputValue()) === long && (await page.getByText(overText).isVisible()) && !(await page.getByText("Fix these before publishing").isVisible()),
  `${long.length} characters saved`,
);
await heading.fill("Taquería Orinoco");
await until(page, id, (ls) => ls[0]?.text === "Taquería Orinoco");
check("4b. Once it fits, the counter goes and the pick keeps its id", !(await page.getByText(/^heading \d+\/80 · \d+ over$/).isVisible()) && lines(id)[0]?.id === pickId);

// 5. Enter adds the next pick in the same format; a link shows its domain.
await heading.press("Enter");
await page.getByRole("textbox", { name: "Item heading" }).fill("El Huequito");
await page.getByRole("button", { name: "Link", exact: true }).click();
await page.getByLabel("Link", { exact: true }).fill("elhuequito.com.mx/menu");
await page.getByRole("button", { name: "Add", exact: true }).click();
await until(page, id, (ls) => ls.length === 2 && ls[1].link === "https://elhuequito.com.mx/menu");
check("5. Enter adds a numbered pick; Add link stores https:// and the pill shows the domain", lines(id)[1]?.format === "num" && (await page.getByText("elhuequito.com.mx").first().isVisible()));

// 5b. A second link, with a name; a third is refused with the reason; a link can be removed from its pill.
await page.getByRole("button", { name: "Link", exact: true }).click();
await page.getByLabel("Link", { exact: true }).fill("https://maps.example.com/huequito");
await page.getByLabel("Name (optional)").fill("Map");
await page.getByRole("button", { name: "Add", exact: true }).click();
await until(page, id, (ls) => (ls[1]?.links ?? []).length === 2);
const two = lines(id)[1];
await page.getByRole("button", { name: "Link", exact: true }).click();
const fullMsg = await page.getByText("A pick can have up to 2 links. Remove one to add another.").isVisible();
check(
  "5b. A pick takes a second link with its name; a third says why and opens nothing",
  JSON.stringify(two.links) === '[{"url":"https://elhuequito.com.mx/menu"},{"url":"https://maps.example.com/huequito","name":"Map"}]' && two.link === "https://elhuequito.com.mx/menu" && fullMsg && !(await page.getByRole("dialog").isVisible()),
  JSON.stringify(two.links),
);
await page.getByRole("button", { name: "Edit link Map" }).click();
await page.getByRole("button", { name: "Remove link" }).click();
await until(page, id, (ls) => (ls[1]?.links ?? []).length === 1);
await page.getByRole("button", { name: "Link", exact: true }).click();
await page.getByLabel("Link", { exact: true }).fill("https://maps.example.com/huequito");
await page.getByLabel("Name (optional)").fill("Map");
await page.getByRole("button", { name: "Add", exact: true }).click();
await until(page, id, (ls) => (ls[1]?.links ?? []).length === 2);
check("5c. Removing a link from its pill leaves the other; it can be added back", (lines(id)[1]?.links ?? []).map((k) => k.name ?? k.url).join() === "https://elhuequito.com.mx/menu,Map");
await page.getByRole("button", { name: "Done", exact: true }).first().click();
await shot(page, "build");

// 6. Delete has a 5-second Undo; reorder keeps every pick's id.
await page.getByRole("button", { name: "Edit", exact: true }).click();
await page.getByRole("menuitem", { name: "Delete" }).click();
await page.getByRole("button", { name: "Delete item" }).first().click();
await until(page, id, (ls) => ls.length === 1);
const undo = page.getByRole("button", { name: "Undo" });
check("6a. Deleting a pick shows Item deleted with Undo", (await page.getByText("Item deleted").isVisible()) && (await undo.isVisible()));
await undo.click();
await until(page, id, (ls) => ls.length === 2);
check("6b. Undo brings the pick back with the same id and tags", lines(id)[0]?.id === pickId && lines(id)[0]?.tags?.length === 3);
await page.getByRole("button", { name: "Done", exact: true }).click();
await page.getByRole("button", { name: "Edit", exact: true }).click();
await page.getByRole("menuitem", { name: "Reorder" }).click();
await page.getByRole("button", { name: "Move item down" }).first().click();
await until(page, id, (ls) => ls[1]?.id === pickId);
check("6c. Reordering moves the pick and keeps its id", lines(id)[1]?.id === pickId && lines(id)[0]?.text === "El Huequito");
await page.getByRole("button", { name: "Done", exact: true }).click();
await page.waitForTimeout(5500);
check("6d. The Undo message is gone after 5 seconds", !(await page.getByText("Item deleted").isVisible()));

// 7. Publishing: the stack keeps each pick's id, subheading and tags, and its page shows them.
await page.getByRole("button", { name: "Finalize" }).click();
await readyToPublish(page);
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const pub = JSON.parse(sql(`select sections from public.stacks where id = '${id}'`) || "[]").flatMap((s) => s.lines);
check(
  "7a. The published stack has the same pick ids, the subheading and the tags",
  pub.length === 2 && pub[1].id === pickId && pub[1].note === "Trompo tacos until 3am." && (pub[1].tags ?? []).join() === "Late night,Outdoor seating,$",
  JSON.stringify(pub[1]),
);
await page.goto(APP + `/s/${id}`);
await page.getByText("Trompo tacos until 3am.").waitFor({ timeout: 10000 }).catch(() => {});
await shot(page, "stack-page");
check(
  "7b. The stack page shows the subheading, the tag chips and both links in order",
  (await page.getByText("Trompo tacos until 3am.").isVisible()) &&
    (await page.getByText("Outdoor seating").first().isVisible()) &&
    (await page.getByText("Late night").first().isVisible()) &&
    (await page.locator("a[href^='https://']").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).join() === "https://elhuequito.com.mx/menu,https://maps.example.com/huequito",
);

// 7c. As in the design: the pick's tags are flat labels in their group's colours, in the tray's order (Price before
//     When, typed ones last), with "You say" on your own Stack; the filter lists every tag and tapping one filters;
//     each pick has round Pin and Send buttons (coming soon); your own Stack has ⋯ (no Edit pill) and no Remix.
const chip7 = page.getByRole("button", { name: "Filter by 🌙 Late night" }).last();
const chipStyle = await chip7.evaluate((el) => { const c = getComputedStyle(el); return [c.borderTopStyle, c.borderRadius, c.backgroundColor].join("|"); }).catch(() => "");
const order7 = await page.locator("[class*=pmTags]").first().locator("button").allInnerTexts();
const say7 = await page.locator("[class*=pmYouSay]").first().innerText().catch(() => "");
const note7 = await page.locator("[class*=pmFilterNote]").innerText().catch(() => "");
await chip7.click();
const filtered7 = (await page.locator("[class*=pmFilterNote]").innerText().catch(() => "")) + " | " + (await page.locator("[class*=pmHead]").allInnerTexts()).join();
await page.getByRole("button", { name: /^All 2$/ }).click();
await page.getByRole("button", { name: "Add to your bucket list" }).first().click();
const pinToast = await page.getByText("Pinning picks to your bucket list is coming soon.").isVisible();
check(
  "7c. Design details: flat tag labels in group colours and order, You say, the tag filter, Pin and Send per pick (coming soon), ⋯ for your own Stack, no Remix",
  chipStyle.startsWith("none|7px|") && !chipStyle.endsWith("rgba(0, 0, 0, 0)") &&
    order7.join() === "$,🌙 Late night,Outdoor seating" &&
    /^you say$/i.test(say7.trim()) &&
    note7 === "Your tags. Viewers can filter by them." &&
    filtered7 === "Showing 1 of 2 · 🌙 Late night | Taquería Orinoco" &&
    (await page.getByRole("button", { name: "Add to your bucket list" }).count()) === 2 &&
    (await page.getByRole("button", { name: "Send this pick" }).count()) === 2 &&
    pinToast &&
    (await page.getByRole("button", { name: "Edit, visibility and delete" }).isVisible()) &&
    !(await page.getByRole("button", { name: /^Remix/ }).isVisible()),
  `${chipStyle} · ${order7.join()} · ${say7} · ${note7} · ${filtered7}`,
);
// A visitor (signed out) sees Remix with its count, a pink Follow, and ⋯ (Report and Block, coming soon).
const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const gp = await guest.newPage();
await gp.goto(APP + `/s/${id}`);
await gp.getByText("Trompo tacos until 3am.").waitFor({ timeout: 10000 }).catch(() => {});
// Solid, not faded: full opacity, filled with the page's pink accent (the build may write the colour as lab()).
const followBg = await gp.getByRole("button", { name: "Follow", exact: true }).evaluate((el) => {
  const c = getComputedStyle(el);
  const accent = c.getPropertyValue("--accent").trim().replace(/%/, "");
  return c.opacity === "1" && c.backgroundColor.replace(/%/, "") === accent && /^lab\(44\.8|^oklch\(0\.55 0\.22 350/.test(c.backgroundColor) ? "pink" : `${c.opacity} ${c.backgroundColor} ${accent}`;
}).catch(() => "");
await gp.getByRole("button", { name: "More options" }).click().catch(() => {});
check(
  "7d. A visitor sees Remix, a solid pink Follow, Filter by tag, and ⋯ says Report and Block are coming soon",
  (await gp.getByRole("button", { name: /^Remix/ }).isVisible()) &&
    followBg === "pink" &&
    (await gp.getByText("Filter by tag, or tap any tag on a pick").isVisible()) &&
    (await gp.getByText("Reporting and blocking are coming soon.").isVisible()),
  followBg,
);
// 7e. On a short phone screen, once the picks scroll under it, the sticky tag filter stays fully visible and every
//     chip can still be tapped (nothing covers it).
await gp.setViewportSize({ width: 390, height: 560 });
await gp.locator("[class*=pmBody]").evaluate((el) => el.scrollTo(0, el.scrollHeight));
await gp.waitForTimeout(300);
const stuck = await gp.locator("[class*=pmBody]").evaluate((body) => {
  const box = body.getBoundingClientRect();
  const filter = body.querySelector("[class*=pmFilter]");
  const fs = getComputedStyle(filter);
  const chips = [...body.querySelectorAll("[class*=pmFilterRow] button")];
  return {
    // Pinned flush to the top edge, with nothing above it that browsers place differently (Safari and Chrome
    // disagree on a sticky offset when the scroller has top padding; only Chrome runs here).
    flush: Math.abs(filter.getBoundingClientRect().top - box.top) < 1 && fs.top === "0px" && getComputedStyle(body).paddingTop === "0px",
    scrolled: body.scrollTop > 0,
    chips: chips.length,
    ok: chips.filter((c) => {
      const r = c.getBoundingClientRect();
      const x = Math.min(r.left + r.width / 2, box.right - 4), y = r.top + r.height / 2;
      return r.top >= box.top && r.bottom <= box.bottom && (r.left >= box.right || c.contains(document.elementFromPoint(x, y)));
    }).length,
  };
});
await gp.getByRole("button", { name: "Filter by 🌙 Late night" }).first().tap();
const note7e = await gp.locator("[class*=pmFilterNote]").innerText().catch(() => "");
check(
  "7e. After scrolling on a short screen, the sticky tag filter sits flush at the top (the same in Safari and Chrome) and its chips are fully visible and tappable",
  stuck.flush && stuck.scrolled && stuck.chips >= 3 && stuck.ok === stuck.chips && note7e === "Showing 1 of 2 · 🌙 Late night",
  `${JSON.stringify(stuck)} · ${note7e}`,
);
await guest.close();

// 8. Editing the published stack keeps pick ids too. Before it, the Stack page says Published; right after the edit
//    is saved (seconds after publishing), it says Updated.
const TODAY = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const metaOf = async () => {
  await page.locator("[class*=pmMeta]").waitFor({ timeout: 10000 }).catch(() => {});
  return (await page.locator("[class*=pmMeta]").innerText().catch(() => "")).trim();
};
await page.goto(APP + `/s/${id}`);
const before8 = await metaOf();
await page.goto(APP + `/create?edit=${id}`);
await page.getByText("Trompo tacos until 3am.").click();
await page.getByRole("textbox", { name: "Item subheading" }).fill("Trompo tacos until 4am.");
await page.getByRole("button", { name: "Done", exact: true }).first().click();
// Editing saves from Finalize (agreed Nov 27).
await page.getByRole("button", { name: "Finalize" }).click();
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.waitForURL(new RegExp(`/s/${id}`), { timeout: 15000 }).catch(() => {});
const edited = JSON.parse(sql(`select sections from public.stacks where id = '${id}'`) || "[]").flatMap((s) => s.lines);
check("8. Publishing an edit updates the pick and keeps its id", edited[1]?.id === pickId && edited[1]?.note === "Trompo tacos until 4am.", JSON.stringify(edited[1]));
await page.goto(APP + `/s/${id}`);
await page.getByText("Trompo tacos until 4am.").waitFor({ timeout: 10000 }).catch(() => {});
const after8 = await metaOf();
const secs8 = sql(`select round(extract(epoch from updated_at - published_at)) from public.stacks where id = '${id}'`);
check(
  "8b. A fresh publish says Published; an edit saved right after (under a minute) says Updated",
  before8.includes(`Published ${TODAY}`) && after8.includes(`Updated ${TODAY}`) && Number(secs8) < 60,
  `${before8} → ${after8} (${secs8}s after publishing)`,
);

// 9. The item limit: at 15 picks, Add item says why and adds nothing.
const full = await seed(page, uid, { title: "Fifteen", sections: [{ label: "", lines: Array.from({ length: 15 }, (_, i) => pick(i + 1)) }] });
await page.getByText("15 of 15 items · remove one to add another").waitFor({ timeout: 10000 }).catch(() => {});
const addItem = page.getByRole("button", { name: "15 of 15 items · remove one to add another" });
await addItem.click({ force: true });
await page.waitForTimeout(1500);
check("9. At 15 items Add item reads 15 of 15 items, looks off, and adds nothing", (await addItem.getAttribute("aria-disabled")) === "true" && lines(full).length === 15 && !(await page.getByRole("textbox", { name: "Item heading" }).isVisible()));

// 10. The section limit: with 5 sections, Section in the toolbar says why and adds none.
const five = await seed(page, uid, { title: "Five", sections: Array.from({ length: 5 }, (_, i) => ({ label: `Area ${i + 1}`, lines: [pick(i + 1)] })) });
await page.getByText("Pick 5").click();
await page.getByRole("button", { name: "Section", exact: true }).click({ force: true });
await page.waitForTimeout(1500);
const secs = JSON.parse(sql(`select content->'sections' from public.drafts where id = '${five}'`));
check(
  "10. With 5 sections, Section looks off, says A Stack can have up to 5 sections., and adds none",
  (await page.getByRole("button", { name: "Section", exact: true }).getAttribute("aria-disabled")) === "true" && (await page.getByText("A Stack can have up to 5 sections.").isVisible()) && secs.filter((s) => s.label).length === 5,
);

// 11. Older content: paragraphs and bold lines open as bulleted picks, ** marks go, an old detail becomes the
//     subheading, and anything over the new limits is listed (not cut).
const old = await seed(page, uid, {
  title: "Older stack",
  sections: [
    {
      label: "",
      lines: [
        { text: "A **great** paragraph", link: null, format: "text" },
        { text: "Bold line", link: null, format: "bold" },
        { text: "Numbered", link: null, format: "num", note: "Its older detail" },
        { text: "x".repeat(120), link: null, format: "num" },
      ],
    },
  ],
});
await page.getByText("A great paragraph").waitFor({ timeout: 10000 }).catch(() => {});
await shot(page, "older-content");
check(
  "11a. Older lines show as picks: plain headings, the old detail as a subheading, and the over-limit one says how far over",
  (await page.getByText("A great paragraph").isVisible()) && (await page.getByText("Its older detail").isVisible()) && (await page.getByText("heading 120/80 · 40 over").isVisible()),
);
await page.getByText("Bold line").click();
await page.getByRole("textbox", { name: "Item heading" }).press("End");
await page.keyboard.type("!");
await until(page, old, (ls) => ls[1]?.text === "Bold line!");
const conv = lines(old);
check(
  "11b. Once edited, they save as bulleted (or numbered) picks with ids, nothing cut",
  conv.map((l) => l.format).join() === "bullet,bullet,num,num" && conv[0].text === "A great paragraph" && conv[2].note === "Its older detail" && conv[3].text.length === 120 && conv.every((l) => UUID.test(l.id)),
  JSON.stringify(conv.map((l) => [l.format, l.text.slice(0, 20)])),
);

// 12. A new pick whose heading names a website keeps its heading and link through save, refresh and another save.
await page.goto(APP + "/new");
await page.getByLabel("Title").fill(`Ramen ${RUN}`);
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Skip" }).click();
await page.getByRole("textbox", { name: "Item heading" }).fill("Ramen at fuunji.jp");
await page.getByRole("textbox", { name: "Item heading" }).press("Enter");
await page.getByRole("textbox", { name: "Item heading" }).fill("Tsuta, see tsuta.jp");
await page.getByRole("button", { name: "Link", exact: true }).click();
await page.getByLabel("Link", { exact: true }).fill("https://example.com/tsuta-menu");
await page.getByRole("button", { name: "Add", exact: true }).click();
const ramen = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
const asTyped = (ls) => ls.length === 2 && ls[0].text === "Ramen at fuunji.jp" && !ls[0].link && ls[1].text === "Tsuta, see tsuta.jp" && ls[1].link === "https://example.com/tsuta-menu";
await until(page, ramen, asTyped);
await page.reload();
await page.getByText("Ramen at fuunji.jp").waitFor({ timeout: 10000 }).catch(() => {});
const shown = (await page.getByText("Ramen at fuunji.jp").isVisible()) && (await page.getByText("Tsuta, see tsuta.jp").isVisible()) && (await page.getByText("example.com").isVisible());
await page.getByLabel("Title").fill(`Ramen ${RUN}!`);
await page.getByLabel("Title").blur();
await until(page, ramen, () => sql(`select content->>'title' from public.drafts where id = '${ramen}'`) === `Ramen ${RUN}!`);
const draft12 = asTyped(lines(ramen)) && (await noNotes());
await page.getByRole("button", { name: "Finalize" }).click();
await readyToPublish(page);
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
await page.goto(APP + `/s/${ramen}`);
await page.getByText("Ramen at fuunji.jp").waitFor({ timeout: 10000 }).catch(() => {});
check(
  "12. New headings with a domain keep their heading and link through save, refresh, another save and publishing, with nothing to fix",
  shown && draft12 && (await page.getByText("Ramen at fuunji.jp", { exact: true }).isVisible()) && (await page.getByText("Tsuta, see tsuta.jp", { exact: true }).isVisible()) && !(await page.getByRole("link", { name: "fuunji.jp" }).isVisible()),
  JSON.stringify(lines(ramen).map((l) => [l.text, l.link])),
);

// 13. Older lines with web addresses in their text: the first two (with their names) become the links; a third
//     stays in the heading and is listed for the owner, through save and refresh, until they remove it.
await seed(page, uid, {
  title: "Two older links",
  sections: [{ label: "", lines: [{ text: "Menus: fuunji.jp and tsuta.jp/menu", link: null, format: "num", linkNames: { "https://fuunji.jp": "Fuunji menu" } }] }],
});
await page.getByText("Fuunji menu").waitFor({ timeout: 10000 }).catch(() => {});
check(
  "13. A legacy line with two addresses opens with both as links (the first keeps its name) and nothing to fix",
  (await page.getByText("Fuunji menu").isVisible()) && (await page.getByText("tsuta.jp", { exact: true }).isVisible()) && (await page.getByText("Menus: and", { exact: true }).isVisible()) && (await noNotes()),
);
const twoUrls = await seed(page, uid, {
  title: "Older links",
  sections: [{ label: "", lines: [{ text: "Menus: fuunji.jp, ichiran.com and tsuta.jp/menu", link: null, format: "num", linkNames: { "https://fuunji.jp": "Fuunji menu" } }] }],
});
const leftover = "Still has a web address from an older version (tsuta.jp). Make it a link or remove it (up to 2 links per item).";
await page.getByText(leftover).waitFor({ timeout: 10000 }).catch(() => {});
const before13 = (await page.getByText("Fuunji menu").isVisible()) && (await page.getByText("ichiran.com", { exact: true }).isVisible()) && (await page.getByText("Menus:, and tsuta.jp/menu").isVisible()) && (await page.getByText(leftover).isVisible());
await page.getByLabel("Title").fill("Older links!");
await page.getByLabel("Title").blur();
await until(page, twoUrls, (ls) => ls[0]?.link === "https://fuunji.jp");
const saved13 = lines(twoUrls)[0];
await page.reload();
await page.getByText(leftover).waitFor({ timeout: 10000 }).catch(() => {});
check(
  "13a. A legacy line with three addresses: the first two become links (the first keeps its name), the third stays in the heading and is listed, after save and refresh",
  before13 &&
    JSON.stringify(saved13?.links) === '[{"url":"https://fuunji.jp","name":"Fuunji menu"},{"url":"https://ichiran.com"}]' &&
    saved13?.text === "Menus:, and tsuta.jp/menu" &&
    (saved13?.legacyUrls ?? []).join() === "https://tsuta.jp/menu" &&
    (await page.getByText(leftover).isVisible()),
  JSON.stringify(saved13),
);
await page.getByText("Menus:, and tsuta.jp/menu").click();
await page.getByRole("textbox", { name: "Item heading" }).fill("Menus");
await until(page, twoUrls, (ls) => ls[0]?.text === "Menus");
check("13b. Once the owner removes it, it's no longer listed", !(await page.getByText(leftover).isVisible()) && !lines(twoUrls)[0]?.legacyUrls);

// 14. Delete a pick, edit another, then Undo: only the deleted pick comes back, in its place, and the edit stays.
const three = await seed(page, uid, {
  title: "Undo",
  sections: [{ label: "", lines: ["A", "B", "C"].map((t) => ({ id: sql("select gen_random_uuid()"), text: t, link: null, format: "num" })) }],
});
const ids14 = lines(three).map((l) => l.id);
await page.getByText("C", { exact: true }).waitFor({ timeout: 10000 });
await page.getByRole("button", { name: "Edit", exact: true }).click();
await page.getByRole("menuitem", { name: "Delete" }).click();
await page.getByRole("button", { name: "Delete item" }).nth(1).click();
await page.getByRole("button", { name: "Done", exact: true }).click();
await page.getByText("C", { exact: true }).click();
await page.getByRole("textbox", { name: "Item heading" }).fill("C edited");
await page.getByRole("button", { name: "Undo" }).click();
await until(page, three, (ls) => ls.length === 3 && ls[2].text === "C edited");
const after14 = lines(three);
check(
  "14a. Delete → edit another pick → Undo: the deleted pick is back in its place with its id, and the edit is kept",
  after14.map((l) => l.text).join() === "A,B,C edited" && after14.map((l) => l.id).join() === ids14.join(),
  after14.map((l) => l.text).join(),
);

// 14b. The same for a removed section title.
const headed = await seed(page, uid, {
  title: "Undo title",
  sections: [
    { label: "", lines: [{ id: sql("select gen_random_uuid()"), text: "First", link: null, format: "num" }] },
    { label: "Area 2", lines: [{ id: sql("select gen_random_uuid()"), text: "Second", link: null, format: "num" }] },
  ],
});
await page.getByText("Second", { exact: true }).waitFor({ timeout: 10000 });
await page.getByRole("button", { name: "Edit", exact: true }).click();
await page.getByRole("menuitem", { name: "Delete" }).click();
await page.getByRole("button", { name: "Remove heading" }).click();
await page.getByRole("button", { name: "Done", exact: true }).click();
await page.getByText("First", { exact: true }).click();
await page.getByRole("textbox", { name: "Item heading" }).fill("First edited");
await page.getByRole("button", { name: "Undo" }).click();
const secsOf = () => JSON.parse(sql(`select content->'sections' from public.drafts where id = '${headed}'`) || "[]").map((x) => `${x.label}:${x.lines.map((l) => l.text).join("+")}`).join(" | ");
for (let i = 0; i < 60 && secsOf() !== ":First edited | Area 2:Second"; i++) await page.waitForTimeout(250);
check("14b. Remove a section title → edit a pick → Undo: the title is back over its pick, and the edit is kept", secsOf() === ":First edited | Area 2:Second", secsOf());

// 15. A full web address written into a pick's text becomes one of its links: once something follows it, or when
//     leaving the text. A plain name like "fuunji.jp" stays text (check 12). Past 2 links it stays in the text and
//     the editor says why.
const typed = await seed(page, uid, { title: "Typed links", sections: [{ label: "", lines: [{ id: sql("select gen_random_uuid()"), text: "Noodles", link: null, format: "num" }] }] });
await page.getByText("Noodles", { exact: true }).click();
const h15 = page.getByRole("textbox", { name: "Item heading" });
await h15.press("End");
await page.keyboard.type(" menu https://fuunji.jp/menu and more");
const midway = (await h15.inputValue()) === "Noodles menu and more" && (await page.getByRole("button", { name: "Edit link fuunji.jp" }).isVisible());
await page.getByRole("textbox", { name: "Item subheading" }).click();
await page.keyboard.type("Map www.example.com/map");
await page.getByRole("button", { name: "Done", exact: true }).first().click();
await until(page, typed, (ls) => (ls[0]?.links ?? []).length === 2 && ls[0].note === "Map");
const t15 = lines(typed)[0];
check(
  "15a. Writing https://… then more text, and www.… at the end of the subheading, turns both into links and leaves the rest of the text",
  midway && t15.text === "Noodles menu and more" && t15.note === "Map" && (t15.links ?? []).map((k) => k.url).join() === "https://fuunji.jp/menu,https://www.example.com/map",
  JSON.stringify(t15),
);
await page.reload();
await page.getByText("Noodles menu and more").click();
await page.getByRole("textbox", { name: "Item heading" }).press("End");
await page.keyboard.type(" https://third.example.com ");
const told = await page.getByText("A pick can have up to 2 links. Remove one to add another.").isVisible();
await page.getByRole("button", { name: "Done", exact: true }).first().click();
await until(page, typed, (ls) => ls[0]?.text.includes("third"));
const t15b = lines(typed)[0];
check(
  "15b. After a refresh the links are still there; a third written address stays in the text and the editor says why",
  told && t15b.text.trim() === "Noodles menu and more https://third.example.com" && (t15b.links ?? []).length === 2,
  JSON.stringify(t15b),
);

// 16. A written address ending in a bracket that belongs to it keeps it; a sentence's period after it, or a bracket
//     opened before it, stays in the text. The exact address survives save, refresh and publishing.
const WIKI = "https://example.com/wiki/It_(novel)";
await page.goto(APP + "/new");
await page.getByLabel("Title").fill(`Books ${RUN}`);
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Skip" }).click();
await page.getByRole("textbox", { name: "Item heading" }).click();
await page.keyboard.type(`Read ${WIKI}. Great book`);
await page.getByRole("textbox", { name: "Item subheading" }).click();
await page.keyboard.type("(see https://example.com/notes)");
await page.getByRole("button", { name: "Done", exact: true }).first().click();
const books = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
const want16 = (l) => l?.text === "Read. Great book" && l?.note === "(see)" && (l?.links ?? []).map((k) => k.url).join() === `${WIKI},https://example.com/notes` && l?.link === WIKI;
await until(page, books, (ls) => want16(ls[0]));
const saved16 = lines(books)[0];
await page.reload();
await page.getByText("Read. Great book").waitFor({ timeout: 10000 }).catch(() => {});
const pills16 = await page.getByRole("button", { name: "example.com", exact: true }).count();
await page.getByLabel("Title").fill(`Books ${RUN}!`);
await page.getByLabel("Title").blur();
await until(page, books, () => sql(`select content->>'title' from public.drafts where id = '${books}'`) === `Books ${RUN}!`);
const refreshed16 = lines(books)[0];
await page.getByRole("button", { name: "Finalize" }).click();
await readyToPublish(page);
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const pub16 = JSON.parse(sql(`select sections from public.stacks where id = '${books}'`) || "[]").flatMap((x) => x.lines)[0];
await page.goto(APP + `/s/${books}`);
await page.getByText("Read. Great book").waitFor({ timeout: 10000 }).catch(() => {});
await shot(page, "written-link");
const anchors = await page.locator("a[href^='https://example.com']").evaluateAll((as) =>
  as.map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim(), color: getComputedStyle(a).color })),
);
const blue = (c) => {
  // The browser reports the colour as lab(L a b) (blue: b well below 0), oklch(L C h) or rgb(r, g, b).
  const lab = c.match(/^lab\(([-\d.]+) ([-\d.]+) ([-\d.]+)/);
  if (lab) return Number(lab[3]) < -20;
  const ok = c.match(/^oklch\(([\d.]+%?) ([\d.]+) ([\d.]+)/);
  if (ok) return Number(ok[3]) > 200 && Number(ok[3]) < 290;
  const rgb = c.match(/^rgb\((\d+), (\d+), (\d+)/);
  return !!rgb && Number(rgb[3]) > Number(rgb[1]) + 40;
};
check(
  "16a. Written as text, https://example.com/wiki/It_(novel) becomes a link with its closing bracket; the period stays in the text, and a bracket around another address stays outside it",
  want16(saved16),
  JSON.stringify(saved16),
);
check("16b. After a refresh (and another save) the destinations are unchanged and both show as link buttons", want16(refreshed16) && pills16 === 2, `${pills16} buttons`);
check(
  "16c. Published: the exact destinations, shown as blue link buttons; the period is outside the link",
  want16(pub16) &&
    anchors.map((a) => a.href).join() === `${WIKI},https://example.com/notes` &&
    anchors.every((a) => blue(a.color) && !a.href.endsWith(".")) &&
    (await page.getByText("Read. Great book", { exact: true }).isVisible()),
  JSON.stringify(anchors),
);

// 17. After publishing a draft that was reopened from its own address (a refresh), "Your Stack is live" stays up,
//     the address stays the Stack's, and coming back to the page (a reload) opens the Stack, not "Nothing here".
await page.goto(APP + "/new");
await page.getByLabel("Title").fill(`Stays ${RUN}`);
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Skip" }).click();
await page.getByRole("textbox", { name: "Item heading" }).fill("Stays up");
await page.getByRole("button", { name: "Done", exact: true }).first().click();
const stays = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
await until(page, stays, (ls) => ls[0]?.text === "Stays up");
await page.reload();
await page.getByText("Stays up").waitFor({ timeout: 10000 });
await page.getByRole("button", { name: "Finalize" }).click();
await readyToPublish(page);
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
await page.waitForTimeout(4000);
const live17 = (await page.getByText("Your Stack is live").isVisible()) && new URL(page.url()).pathname === `/s/${stays}`;
await page.reload();
await page.getByText("Stays up").waitFor({ timeout: 10000 }).catch(() => {});
check(
  "17. After publishing, Your Stack is live stays up at the Stack's address, and a reload opens the Stack (not Nothing here)",
  live17 && (await page.getByText("Stays up").isVisible()) && !(await page.getByText("Nothing here").isVisible()),
  page.url(),
);

// 18. The create flow's small details (2d): the item count by the step, the heading placeholder, Shift+Enter,
//     a note on a pick that needs a heading, and the published screen's three buttons.
await page.goto(APP + "/new");
await page.getByLabel("Title").fill(`Details ${RUN}`);
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Skip" }).click();
const h18 = page.getByRole("textbox", { name: "Item heading" });
const placeholder18 = await h18.getAttribute("placeholder");
// No contact autofill: every field on the page says autocomplete="off".
const autofill18 = await page.locator("main input:not([type=checkbox]):not([type=radio]), main textarea").evaluateAll((els) => els.filter((e) => e.getAttribute("autocomplete") !== "off").map((e) => e.getAttribute("aria-label") || e.id));
const empty18 = !(await page.getByText(/3\/4 · Build · /).isVisible());
await h18.fill("First pick");
await h18.press("Shift+Enter");
await page.waitForTimeout(300);
const one18 = (await page.getByRole("textbox", { name: "Item heading" }).count()) === 1 && (await h18.inputValue()) === "First pick";
await page.getByRole("button", { name: "Done", exact: true }).first().click();
check(
  "18a. The step shows the item count once there's an item, the heading says it's required (without the word \"name\", which makes iPhones offer contacts), autofill is off, and Shift+Enter adds nothing",
  empty18 && placeholder18 === "Item (required)" && autofill18.length === 0 && one18 && (await page.getByText("3/4 · Build · 1 item").isVisible()),
  `${placeholder18} · autofill on: ${autofill18.join()} · ${one18}`,
);
await page.getByRole("button", { name: "Add item" }).click();
await page.getByRole("textbox", { name: "Item subheading" }).fill("Only a reason");
await page.getByRole("button", { name: "Done", exact: true }).first().click();
check("18b. A pick with only a subheading says it needs a heading, with no warning box", (await page.getByText("Needs a heading.").isVisible()) && !(await page.getByText("Fix these before publishing").isVisible()));
await page.getByText("Only a reason").click();
await page.getByRole("textbox", { name: "Item heading" }).fill("Second pick");
await page.getByRole("button", { name: "Done", exact: true }).first().click();
check("18c. Once it has a heading, the note goes", !(await page.getByText("Needs a heading.").isVisible()) && (await page.getByText("3/4 · Build · 2 items").isVisible()));
await page.getByRole("button", { name: "Finalize" }).click();
await readyToPublish(page);
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
await shot(page, "published");
check(
  "18d. The published screen offers Share your Stack, Start another stack and Done",
  (await page.getByRole("button", { name: "Share your Stack" }).isVisible()) && (await page.getByRole("button", { name: "Start another stack" }).isVisible()) && (await page.getByRole("button", { name: "Done", exact: true }).isVisible()),
);
await page.getByRole("button", { name: "Done", exact: true }).click();
await page.waitForURL(/\/profile/, { timeout: 10000 }).catch(() => {});
await page.getByText(`Details ${RUN}`).first().waitFor({ timeout: 10000 }).catch(() => {});
const text18 = await page.locator("main").innerText().catch(() => "");
const [at18, before18] = [text18.indexOf(`Details ${RUN}`), text18.indexOf(`Stays ${RUN}`)];
check("18e. Done goes to Profile › Stacks, with the new Stack before the earlier ones", new URL(page.url()).pathname === "/profile" && at18 >= 0 && before18 > at18, `${page.url()} · ${at18} ${before18}`);

// 19. "Your own" takes focus when tapped: the field itself, or its "Your own" label. A tag typed with the keyboard
//     is saved, and the pick's heading is unchanged.
await page.goto(APP + "/new");
await page.getByLabel("Title").fill(`Own tag ${RUN}`);
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Skip" }).click();
await page.getByRole("textbox", { name: "Item heading" }).fill("Heading stays");
const own19 = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
await until(page, own19, (ls) => ls[0]?.text === "Heading stays");
await page.getByRole("button", { name: "Tags", exact: true }).click();
const tray19 = page.getByRole("menu", { name: "Tags" });
const focused = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.getAttribute("aria-label") || "");
await tray19.getByRole("textbox", { name: "Your own" }).tap();
const afterFieldTap = await focused();
await page.keyboard.type("Rooftop");
await page.keyboard.press("Enter");
await until(page, own19, (ls) => (ls[0]?.tags ?? []).join() === "Rooftop");
const saved19 = lines(own19)[0];
check(
  "19a. Tapping the Your own field focuses it, and a tag typed with the keyboard saves without changing the heading",
  afterFieldTap === "own-tag" && (saved19?.tags ?? []).join() === "Rooftop" && saved19?.text === "Heading stays" && (await page.getByRole("textbox", { name: "Item heading" }).inputValue()) === "Heading stays",
  `${afterFieldTap} · ${JSON.stringify(saved19)}`,
);
await page.getByRole("textbox", { name: "Item heading" }).focus();
await tray19.locator("label[for='own-tag']").tap();
const afterLabelTap = await focused();
await page.keyboard.type("Late");
await page.keyboard.press("Enter");
await until(page, own19, (ls) => (ls[0]?.tags ?? []).length === 2);
const saved19b = lines(own19)[0];
check(
  "19b. Tapping the Your own label focuses the field too; the next typed tag saves and the heading is unchanged",
  afterLabelTap === "own-tag" && (saved19b?.tags ?? []).join() === "Rooftop,Late" && saved19b?.text === "Heading stays",
  `${afterLabelTap} · ${JSON.stringify(saved19b)}`,
);
await page.getByRole("textbox", { name: "Item heading" }).focus();
await tray19.getByRole("menuitemcheckbox", { name: "Brunch", exact: true }).click();
check("19c. A suggested tag still keeps the heading focused", (await focused()) === "Item heading");

await browser.close();
cleanup();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\n${results.length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
