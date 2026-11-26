// End-to-end checks for the Finalize step (Task 2c): the theme suggested from the title and picked by hand, "Is this
// about a place?" with its city, who can see it, up to 2 categories, reordering, the Preview, and publishing all of
// them onto the Stack. Runs only against the disposable test environment (web/e2e/README.md), after the same
// read-only target checks as the other runners (test-target.mjs). It writes only to the account it creates
// (finalize.<run>.*@stack.test) and removes it at the end, with its drafts and stacks.
//
//   APP_URL API_URL MAILPIT_URL ANON_KEY TEST_DB TEST_ENV_TOKEN [SHOTS=<dir>]  node web/e2e/finalize.e2e.mjs
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
if (sql("select to_regproc('public.theme_emojis') is not null") !== "t") refuse("the finalize migration isn't applied to the test database");
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
  const email = `finalize.${RUN}.a@stack.test`;
  created.push(email);
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  const after = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(await latestCode(email, after));
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await page.getByLabel("Display name").fill("Finalize Tester");
  await page.getByLabel("Username").fill(`f${RUN}`.slice(0, 30));
  await page.getByText("✓ Available").waitFor();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  return sql(`select id from auth.users where email = '${email}'`);
}

const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
const draftIdOf = (page) => (new URL(page.url()).pathname.match(/^\/drafts\/([0-9a-f-]{36})$/) || [])[1];
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await signUp(page);

const content = (id) => JSON.parse(sql(`select content from public.drafts where id = '${id}'`) || "{}");
async function untilDraft(id, ok) {
  for (let i = 0; i < 60; i++) {
    if (ok(content(id))) return true;
    await page.waitForTimeout(250);
  }
  return false;
}
const stackRow = (id) =>
  JSON.parse(sql(`select row_to_json(x) from (select theme_emoji, theme_color, is_place, location, categories, visibility, sections from public.stacks where id = '${id}') x`) || "null");
const C3 = "oklch(84% 0.09 260)";

// A draft with three picks, taken to Finalize.
await page.goto(APP + "/new");
await page.getByLabel("Title").fill("Late-night tacos in CDMX");
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Skip" }).click();
for (const [i, t] of ["Orinoco", "El Huequito", "Los Cocuyos"].entries()) {
  if (i) await page.getByRole("textbox", { name: "Item heading" }).press("Enter");
  await page.getByRole("textbox", { name: "Item heading" }).fill(t);
}
await page.getByRole("button", { name: "Done", exact: true }).first().click();
const id = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
await page.getByRole("button", { name: "Finalize" }).click();

// 1. The theme is suggested from the title, and so is the place question's answer.
await page.getByText("Suggested from your title. Tap to change.").waitFor({ timeout: 10000 }).catch(() => {});
await shot(page, "finalize-arrange");
check(
  "1. The theme is suggested from the title (🌮), and Is this about a place? starts at Yes with the city field",
  (await page.getByRole("button", { name: "Theme emoji 🌮" }).getAttribute("aria-pressed")) === "true" &&
    (await page.getByText("Suggested from your title. Tap to change.").isVisible()) &&
    (await page.getByRole("radio", { name: "Yes" }).getAttribute("aria-checked")) === "true" &&
    (await page.getByLabel("City").isVisible()) &&
    (await page.getByText("A city is required for place stacks.").isVisible()),
);

// 2. Picking a theme: the hint changes, and the draft keeps it through a refresh (and reopens at Finalize).
await page.getByRole("button", { name: "Theme emoji 📖" }).click();
await page.getByRole("button", { name: "Theme colour 3" }).click();
await untilDraft(id, (c) => c.theme?.emoji === "📖" && c.theme?.color === C3);
const picked = await page.getByText("You picked this theme.").isVisible();
await page.reload();
await page.getByRole("button", { name: "Theme emoji 📖" }).waitFor({ timeout: 10000 }).catch(() => {});
check(
  "2. A picked emoji and colour say You picked this theme., save to the draft, and come back after a refresh at Finalize",
  picked &&
    (await page.getByRole("button", { name: "Theme emoji 📖" }).getAttribute("aria-pressed")) === "true" &&
    (await page.getByRole("button", { name: "Theme colour 3" }).getAttribute("aria-pressed")) === "true" &&
    sql(`select step from public.drafts where id = '${id}'`) === "review",
);

// 3. The place question: No hides the city; Yes brings it back, and the city is kept.
await page.getByRole("radio", { name: "No" }).click();
const noShown = (await page.getByText("Not about a place. No city needed.").isVisible()) && !(await page.getByLabel("City").isVisible());
await page.getByRole("radio", { name: "Yes" }).click();
await page.getByLabel("City").fill("Mexico\nCity");
await untilDraft(id, (c) => c.isPlace === true && c.location === "Mexico City");
check("3. No says no city is needed and hides the field; Yes brings it back, and the city saves (line breaks become spaces)", noShown && content(id).location === "Mexico City");

// 4. Categories: up to 2; a third is off and says why; tapping one removes it.
await page.getByRole("button", { name: "Food & Drink" }).click();
await page.getByRole("button", { name: "Travel & Places" }).click();
const learning = page.getByRole("button", { name: "Learning", exact: true });
await learning.click({ force: true });
await untilDraft(id, (c) => (c.categories ?? []).length === 2);
const full = (await learning.getAttribute("aria-disabled")) === "true" && (await page.getByText("You picked 2. Tap one to remove it, then pick another.").isVisible());
check("4a. Two categories save; a third is off and the card says why", full && content(id).categories.join() === "Food & Drink,Travel & Places");
await page.getByRole("button", { name: "Travel & Places" }).click();
await untilDraft(id, (c) => (c.categories ?? []).length === 1);
await page.getByRole("button", { name: "Travel & Places" }).click();
await untilDraft(id, (c) => (c.categories ?? []).length === 2);
check("4b. Tapping a picked category removes it, and it can be picked again", content(id).categories.join() === "Food & Drink,Travel & Places");

// 5. Order: move a pick up from Finalize.
await page.getByRole("button", { name: "Move Los Cocuyos up" }).click();
await untilDraft(id, (c) => c.sections?.[0]?.lines?.[1]?.text === "Los Cocuyos");
await page.getByText("Move sections and picks up or down.").scrollIntoViewIfNeeded();
await page.mouse.wheel(0, -260);
await page.waitForTimeout(300);
await shot(page, "finalize-cats-order");
check("5. Order moves a pick up, and the draft keeps the new order", content(id).sections[0].lines.map((l) => l.text).join() === "Orinoco,Los Cocuyos,El Huequito");

// 6. Who can see this stack.
await page.getByRole("button", { name: /^Unlisted/ }).click();
await untilDraft(id, (c) => c.visibility === "unlisted");
check("6. Privacy saves the choice", content(id).visibility === "unlisted");

// 7. Preview, as in the design: full screen in the theme colour with Edit and "Preview · Unlisted", then the card
//    with the slim band ("📖 3 picks", "just now"), the title and the picks in their new order.
await page.getByRole("button", { name: /Preview your Stack/ }).click();
await page.getByText("3 picks").waitFor({ timeout: 5000 }).catch(() => {});
await shot(page, "finalize-preview");
const screenBg = await page.locator("[class*=pmScreen]").evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "");
const bandH = await page.locator("[class*=pmBand]").evaluate((el) => el.getBoundingClientRect().height).catch(() => 0);
check(
  "7. Preview matches the design: theme background, Edit and Preview · Unlisted, a 52px band with 📖 3 picks and just now, and the picks in order",
  !!screenBg && screenBg !== "rgba(0, 0, 0, 0)" &&
    (await page.getByRole("button", { name: "Edit", exact: true }).isVisible()) &&
    (await page.getByText("👀 Preview · Unlisted").isVisible()) &&
    Math.round(bandH) === 52 &&
    (await page.locator("[class*=pmPicks]").innerText()).replace(/\s+/g, " ").trim() === "📖 3 picks" &&
    (await page.getByText("just now").isVisible()) &&
    (await page.locator("[class*=pmHead]").allInnerTexts()).join() === "Orinoco,Los Cocuyos,El Huequito" &&
    !(await page.getByText("Saved just now").isVisible()),
  `${screenBg} · band ${bandH}px`,
);
await page.getByRole("button", { name: "Edit", exact: true }).click();

// 8. Publishing keeps every choice on the Stack.
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const r8 = stackRow(id);
check(
  "8. The published Stack has the theme, the place and city, the categories, the visibility and the order",
  r8?.theme_emoji === "📖" && r8.theme_color === C3 && r8.is_place === true && r8.location === "Mexico City" && r8.categories.join() === "Food & Drink,Travel & Places" && r8.visibility === "unlisted" &&
    r8.sections[0].lines.map((l) => l.text).join() === "Orinoco,Los Cocuyos,El Huequito",
  JSON.stringify({ ...r8, sections: undefined }),
);

// 9. Untouched choices: the suggested theme is what's published; a Stack that isn't about a place keeps no city.
await page.goto(APP + "/new");
await page.getByLabel("Title").fill("Books I loved");
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Skip" }).click();
await page.getByRole("textbox", { name: "Item heading" }).fill("The Dispossessed");
await page.getByRole("button", { name: "Done", exact: true }).first().click();
const id9 = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
await page.getByRole("button", { name: "Finalize" }).click();
const noAtFirst = (await page.getByRole("radio", { name: "No" }).getAttribute("aria-checked")) === "true";
await page.getByRole("radio", { name: "Yes" }).click();
await page.getByLabel("City").fill("Oakland");
await page.getByRole("radio", { name: "No" }).click();
await untilDraft(id9, (c) => c.isPlace === false);
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const r9 = stackRow(id9);
check(
  "9. A title with no place starts at No; the suggested theme (📖) is published; answered No, the typed city isn't kept",
  noAtFirst && r9?.theme_emoji === "📖" && ["oklch(86% 0.13 85)", "oklch(84% 0.12 40)", "oklch(84% 0.09 260)", "oklch(85% 0.1 160)", "oklch(85% 0.1 340)", "oklch(88% 0.12 110)"].includes(r9.theme_color) && r9.is_place === false && r9.location === "" && r9.categories.length === 0,
  JSON.stringify({ ...r9, sections: undefined }),
);

await browser.close();
cleanup();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\n${results.length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
