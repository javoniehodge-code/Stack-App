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

// 3. The tags tray: suggested tags, one price at a time, a typed tag, and at most 3.
await page.getByRole("button", { name: "Tags", exact: true }).click();
const tray = page.getByRole("dialog", { name: "Tags" });
await tray.getByRole("button", { name: "Late night", exact: true }).click();
await tray.getByRole("button", { name: "$", exact: true }).click();
await tray.getByRole("button", { name: "$$", exact: true }).click();
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
const brunch = tray.getByRole("button", { name: "Brunch", exact: true });
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
await tray.getByRole("button", { name: "$", exact: true }).click();
await tray.getByRole("button", { name: "Done", exact: true }).click();
await until(page, id, (ls) => (ls[0]?.tags ?? []).length === 3);

// 4. Counters: shown near a limit, explained past it; text is never cut.
const long = "Tacos al pastor, suadero and campechano at the stand by the metro, open very late on Fridays";
await heading.fill(long);
await until(page, id, (ls) => ls[0]?.text === long);
await shot(page, "heading-over");
const banner = page.getByRole("alert").filter({ hasText: "Fix these before publishing" });
check(
  "4a. A long heading isn't cut: the counter says how far over, and the banner lists it",
  (await heading.inputValue()) === long && (await page.getByText(`heading ${long.length}/80 · ${long.length - 80} over`).isVisible()) && (await banner.getByText(`Item 1 heading is ${long.length - 80} over 80 characters.`).isVisible()),
  `${long.length} characters saved`,
);
await heading.fill("Taquería Orinoco");
await until(page, id, (ls) => ls[0]?.text === "Taquería Orinoco");
check("4b. Once it fits, the banner goes and the pick keeps its id", !(await banner.isVisible()) && lines(id)[0]?.id === pickId);

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
    (await page.getByText("Outdoor seating").isVisible()) &&
    (await page.getByText("Late night").isVisible()) &&
    (await page.locator("a[href^='https://']").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).join() === "https://elhuequito.com.mx/menu,https://maps.example.com/huequito",
);

// 8. Editing the published stack keeps pick ids too.
await page.goto(APP + `/create?edit=${id}`);
await page.getByText("Trompo tacos until 3am.").click();
await page.getByRole("textbox", { name: "Item subheading" }).fill("Trompo tacos until 4am.");
await page.getByRole("button", { name: "Done", exact: true }).first().click();
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.waitForURL(new RegExp(`/s/${id}`), { timeout: 15000 }).catch(() => {});
const edited = JSON.parse(sql(`select sections from public.stacks where id = '${id}'`) || "[]").flatMap((s) => s.lines);
check("8. Publishing an edit updates the pick and keeps its id", edited[1]?.id === pickId && edited[1]?.note === "Trompo tacos until 4am.", JSON.stringify(edited[1]));

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
  "11a. Older lines show as picks: plain headings, the old detail as a subheading, and the over-limit one listed",
  (await page.getByText("A great paragraph").isVisible()) && (await page.getByText("Its older detail").isVisible()) && (await page.getByText("Item 4 heading is 40 over 80 characters.").isVisible()),
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
const draft12 = asTyped(lines(ramen)) && !(await page.getByRole("alert").filter({ hasText: "Fix these before publishing" }).isVisible());
await page.getByRole("button", { name: "Finalize" }).click();
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
  (await page.getByText("Fuunji menu").isVisible()) && (await page.getByText("tsuta.jp", { exact: true }).isVisible()) && (await page.getByText("Menus: and", { exact: true }).isVisible()) && !(await page.getByRole("alert").filter({ hasText: "Fix these before publishing" }).isVisible()),
);
const twoUrls = await seed(page, uid, {
  title: "Older links",
  sections: [{ label: "", lines: [{ text: "Menus: fuunji.jp, ichiran.com and tsuta.jp/menu", link: null, format: "num", linkNames: { "https://fuunji.jp": "Fuunji menu" } }] }],
});
const leftover = "Item 1 heading still has a web address from an older version (tsuta.jp). Make it a link or remove it (up to 2 links per item).";
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

await browser.close();
cleanup();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\n${results.length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
