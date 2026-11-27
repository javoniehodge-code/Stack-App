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
const TODAY = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
/** The band holds only the picks pill, against its right edge. */
const bandRight = (page) =>
  page.locator("[class*=pmBand]").evaluate((band) => {
    const pill = band.querySelector("[class*=pmPicks]");
    const b = band.getBoundingClientRect(), p = pill.getBoundingClientRect();
    return b.right - p.right < 24 && p.left - b.left > b.width / 2 && band.innerText.replace(/\s+/g, " ").trim().endsWith("picks");
  }).catch(() => false);
/** The small row after the last pick. */
const metaText = async (page) => {
  await page.locator("[class*=pmMeta]").scrollIntoViewIfNeeded().catch(() => {});
  return (await page.locator("[class*=pmMeta]").innerText().catch(() => "")).trim();
};

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
    (await page.getByText("Looks like a place stack. Adding the city helps people find it.").isVisible()),
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
await page.getByText("Move sections (with their picks) and picks up or down.").scrollIntoViewIfNeeded();
await page.mouse.wheel(0, -260);
await page.waitForTimeout(300);
await shot(page, "finalize-cats-order");
check("5. Order moves a pick up, and the draft keeps the new order", content(id).sections[0].lines.map((l) => l.text).join() === "Orinoco,Los Cocuyos,El Huequito");

// 6. Who can see this stack.
await page.getByRole("button", { name: /^Unlisted/ }).click();
await untilDraft(id, (c) => c.visibility === "unlisted");
check("6. Privacy saves the choice", content(id).visibility === "unlisted");

// 7. Preview, as in the design: full screen in the theme colour with Edit and "Preview · Unlisted", then the card
//    with the slim band (only "📖 3 picks", on the right), the title, the picks in their new order, and at the very
//    bottom the city and date (agreed Nov 26).
await page.getByRole("button", { name: /Preview your Stack/ }).click();
await page.getByText("3 picks").waitFor({ timeout: 5000 }).catch(() => {});
await shot(page, "finalize-preview");
const screenBg = await page.locator("[class*=pmScreen]").evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "");
const bandH = await page.locator("[class*=pmBand]").evaluate((el) => el.getBoundingClientRect().height).catch(() => 0);
check(
  "7. Preview: theme background, Edit and Preview · Unlisted, a 52px band with only 📖 3 picks on the right, the picks in order, and 📍 Mexico City · Published today · Food & Drink, Travel & Places at the bottom",
  !!screenBg && screenBg !== "rgba(0, 0, 0, 0)" &&
    (await page.getByRole("button", { name: "Edit", exact: true }).isVisible()) &&
    (await page.getByText("👀 Preview · Unlisted").isVisible()) &&
    Math.round(bandH) === 52 &&
    (await page.locator("[class*=pmPicks]").innerText()).replace(/\s+/g, " ").trim() === "📖 3 picks" &&
    (await bandRight(page)) &&
    (await metaText(page)) === `📍 Mexico City · Published ${TODAY} · Food & Drink, Travel & Places` &&
    (await page.locator("[class*=pmHead]").allInnerTexts()).join() === "Orinoco,Los Cocuyos,El Huequito" &&
    !(await page.getByText("Saved just now").isVisible()),
  `${screenBg} · band ${bandH}px`,
);
await page.getByRole("button", { name: "Edit", exact: true }).click();

// 8. Publishing keeps every choice on the Stack.
await readyToPublish(page);
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const r8 = stackRow(id);
check(
  "8. The published Stack has the theme, the place and city, the categories, the visibility and the order",
  r8?.theme_emoji === "📖" && r8.theme_color === C3 && r8.is_place === true && r8.location === "Mexico City" && r8.categories.join() === "Food & Drink,Travel & Places" && r8.visibility === "unlisted" &&
    r8.sections[0].lines.map((l) => l.text).join() === "Orinoco,Los Cocuyos,El Huequito",
  JSON.stringify({ ...r8, sections: undefined }),
);
await page.goto(APP + `/s/${id}`);
await page.getByText("3 picks").waitFor({ timeout: 10000 }).catch(() => {});
await shot(page, "stack-page-top");
const pageBg = await page.locator("[class*=pmScreen]").evaluate((el) => getComputedStyle(el).backgroundColor).catch(() => "");
const wall = await page.locator("[class*=pmWallLong]").evaluate((el) => [el.textContent.slice(0, 4), el.getAttribute("aria-hidden")].join("|")).catch(() => "");
const pill8 = (await page.locator("[class*=pmPicks]").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
const right8 = await bandRight(page);
const meta8 = await metaText(page);
await shot(page, "stack-page-bottom");
check(
  "8b. The Stack page is in its theme: the colour with the 📖 wallpaper (hidden from screen readers), only 📖 3 picks in the band on the right, and 📍 Mexico City · Published today · Food & Drink, Travel & Places after the last pick",
  !!pageBg && pageBg !== "rgba(0, 0, 0, 0)" && wall === "📖📖|true" && pill8 === "📖 3 picks" && right8 && meta8 === `📍 Mexico City · Published ${TODAY} · Food & Drink, Travel & Places` && !(await page.getByText("stack.", { exact: true }).isVisible()),
  `${pageBg} · ${wall} · ${pill8} · ${right8} · ${meta8}`,
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
await readyToPublish(page);
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const r9 = stackRow(id9);
check(
  "9. A title with no place starts at No; the suggested theme (📖) is published; answered No, the typed city isn't kept",
  noAtFirst && r9?.theme_emoji === "📖" && ["oklch(86% 0.13 85)", "oklch(84% 0.12 40)", "oklch(84% 0.09 260)", "oklch(85% 0.1 160)", "oklch(85% 0.1 340)", "oklch(88% 0.12 110)"].includes(r9.theme_color) && r9.is_place === false && r9.location === "" && r9.categories.join() === "Food & Drink",
  JSON.stringify({ ...r9, sections: undefined }),
);
await page.goto(APP + `/s/${id9}`);
await page.locator("[class*=pmPicks]").waitFor({ timeout: 10000 }).catch(() => {});
const meta9 = await metaText(page);
check("9b. A Stack that isn't about a place shows the date and its category at the bottom, no city", meta9 === `Published ${TODAY} · Food & Drink`, meta9);

// 10. Order with two populated sections: a section's arrow moves the whole section, its title and its picks. The new
//     order survives a refresh and publishing.
await page.goto(APP + "/new");
await page.getByLabel("Title").fill("Two areas");
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Skip" }).click();
await page.getByRole("button", { name: "Section", exact: true }).click();
await page.getByRole("textbox", { name: "Section title" }).fill("Roma Norte");
await page.getByRole("textbox", { name: "Section title" }).press("Enter");
await page.getByRole("textbox", { name: "Item heading" }).fill("Licorería Limantour");
await page.getByRole("textbox", { name: "Item heading" }).press("Enter");
await page.getByRole("textbox", { name: "Item heading" }).fill("Baltra");
await page.getByRole("button", { name: "Section", exact: true }).click();
await page.getByRole("textbox", { name: "Section title" }).last().fill("Condesa");
await page.getByRole("textbox", { name: "Section title" }).last().press("Enter");
await page.getByRole("textbox", { name: "Item heading" }).fill("Departamento");
await page.getByRole("button", { name: "Done", exact: true }).first().click();
const id10 = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
const shape = (secs) => (secs ?? []).filter((x) => x.label || x.lines?.length).map((x) => `${x.label}:${x.lines.map((l) => l.text).join("+")}`).join(" | ");
await untilDraft(id10, (c) => shape(c.sections) === "Roma Norte:Licorería Limantour+Baltra | Condesa:Departamento");
const before10 = shape(content(id10).sections);
await page.getByRole("button", { name: "Finalize" }).click();
await page.getByRole("button", { name: "Move section Condesa up" }).click();
await untilDraft(id10, (c) => shape(c.sections) === "Condesa:Departamento | Roma Norte:Licorería Limantour+Baltra");
const moved = shape(content(id10).sections);
await page.reload();
await page.getByRole("button", { name: "Move section Condesa up" }).waitFor({ timeout: 10000 }).catch(() => {});
const rows = (await page.locator("[class*=orderText]").allInnerTexts()).join(",");
check(
  "10a. With two populated sections, Condesa's up arrow moves the section with its pick above Roma Norte and its two picks; a refresh keeps the order",
  before10 === "Roma Norte:Licorería Limantour+Baltra | Condesa:Departamento" && moved === "Condesa:Departamento | Roma Norte:Licorería Limantour+Baltra" && rows === "Condesa,Departamento,Roma Norte,Licorería Limantour,Baltra" &&
    (await page.getByRole("button", { name: "Move section Condesa up" }).isDisabled()),
  `${moved} · rows: ${rows}`,
);
await page.getByRole("radio", { name: "No" }).click();
await readyToPublish(page);
await page.getByRole("button", { name: "Publish", exact: true }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const pub10 = shape(stackRow(id10)?.sections);
check("10b. Publishing keeps the new section order, each with its picks", pub10 === "Condesa:Departamento | Roma Norte:Licorería Limantour+Baltra", pub10);

// 11. Editing a published Stack follows the same steps as creating (agreed Nov 27): the picks, then Finalize, which
//     starts from the Stack's choices and has Back, Save & exit, and Save & share.
const updatedOf = (sid) => sql(`select updated_at from public.stacks where id = '${sid}'`);
const before11 = updatedOf(id);
await page.goto(APP + `/create?edit=${id}`);
await page.getByRole("button", { name: "Finalize" }).waitFor({ timeout: 10000 }).catch(() => {});
const buildFooter = (await page.locator("footer").last().getByRole("button").allInnerTexts()).map((t) => t.trim()).join(",");
await page.getByRole("button", { name: "Finalize" }).click();
await page.getByRole("button", { name: "Theme emoji 📖" }).waitFor({ timeout: 10000 }).catch(() => {});
await shot(page, "edit-finalize");
const startsFrom =
  (await page.getByRole("button", { name: "Theme emoji 📖" }).getAttribute("aria-pressed")) === "true" &&
  (await page.getByRole("button", { name: "Theme colour 3" }).getAttribute("aria-pressed")) === "true" &&
  (await page.getByRole("radio", { name: "Yes" }).getAttribute("aria-checked")) === "true" &&
  (await page.getByLabel("City").inputValue()) === "Mexico City" &&
  (await page.getByRole("button", { name: "Food & Drink" }).getAttribute("aria-pressed")) === "true" &&
  (await page.getByRole("button", { name: "Travel & Places" }).getAttribute("aria-pressed")) === "true";
const actions =
  (await page.getByRole("button", { name: "Back", exact: true }).isVisible()) &&
  (await page.getByRole("button", { name: "Save & exit" }).isVisible()) &&
  (await page.getByRole("button", { name: "Save & share" }).isVisible()) &&
  !(await page.getByRole("button", { name: "Publish", exact: true }).count()) &&
  // Who can see it stays in the Stack's ⋯ menu.
  !(await page.getByText("Privacy", { exact: true }).count());
check(
  "11a. Editing: the picks screen has only Finalize; Finalize starts from the Stack's theme, place, city and categories, has no Privacy, with Back, Save & exit and Save & share",
  buildFooter === "Finalize" && startsFrom && actions,
  `footer: ${buildFooter} / starts from ${startsFrom} / actions ${actions}`,
);

// 11b. Changing only the Finalize choices saves them, and the Stack stays "Published" (no Updated date).
await page.getByRole("button", { name: "Theme emoji 🌮" }).click();
await page.getByRole("button", { name: "Travel & Places" }).click();
await page.getByLabel("City").fill("Oaxaca");
await page.getByRole("button", { name: "Save & exit" }).click();
// Save & exit goes back to where the editor was opened from (agreed Nov 27); the Stack page is checked directly.
await page.getByText("Changes published").waitFor({ timeout: 15000 }).catch(() => {});
await page.goto(APP + `/s/${id}`);
await page.locator("[class*=pmPicks]").waitFor({ timeout: 10000 }).catch(() => {});
const r11 = stackRow(id);
const meta11 = await metaText(page);
check(
  "11b. Saving only Finalize choices: the theme, city and categories change, the edit date doesn't, and the row says 📍 Oaxaca · Published today · Food & Drink",
  r11?.theme_emoji === "🌮" && r11.theme_color === C3 && r11.location === "Oaxaca" && r11.categories.join() === "Food & Drink" && updatedOf(id) === before11 &&
    meta11 === `📍 Oaxaca · Published ${TODAY} · Food & Drink` && sql(`select count(*) from public.drafts where edit_of = '${id}'`) === "0",
  `${JSON.stringify({ ...r11, sections: undefined })} / ${meta11}`,
);

// 11c. A change to the picks, saved from Finalize, does move it: Updated today.
await page.goto(APP + `/create?edit=${id}`);
await page.getByText("Orinoco").click();
await page.getByRole("textbox", { name: "Item heading" }).first().fill("Orinoco (Roma)");
await page.getByRole("button", { name: "Done", exact: true }).last().click();
await page.getByRole("button", { name: "Finalize" }).click();
await page.getByRole("button", { name: "Save & exit" }).click();
// Save & exit goes back to where the editor was opened from (agreed Nov 27); the Stack page is checked directly.
await page.getByText("Changes published").waitFor({ timeout: 15000 }).catch(() => {});
await page.goto(APP + `/s/${id}`);
await page.locator("[class*=pmPicks]").waitFor({ timeout: 10000 }).catch(() => {});
const meta11c = await metaText(page);
check(
  "11c. A pick change saved from Finalize moves the edit date: 📍 Oaxaca · Updated today · Food & Drink",
  updatedOf(id) !== before11 && meta11c === `📍 Oaxaca · Updated ${TODAY} · Food & Drink` && stackRow(id)?.sections[0].lines[0].text === "Orinoco (Roma)",
  meta11c,
);

// 12. An edits draft saved before editing had Finalize (Nov 26: content v 1, with placeholder choices: no theme, no
//     place answer, no categories). Reopened, it keeps its pick edits and takes the published Stack's theme, place
//     answer, city and categories; saving it keeps them.
const editDraft = () => JSON.parse(sql(`select coalesce(json_agg(json_build_object('v', content->'v', 'categories', content->'categories')), '[]') from public.drafts where edit_of = '${id}'`))[0] ?? null;
psql(
  `insert into public.drafts (id, owner_id, content, step, edit_of, base_version)
   select gen_random_uuid(), s.author_id,
          jsonb_build_object('v', 1, 'title', s.title, 'description', s.description,
                             'sections', jsonb_set(s.sections, '{0,lines,0,text}', '"Orinoco (old draft)"'),
                             'tags', '[]'::jsonb, 'style', s.style, 'visibility', s.visibility, 'location', s.location,
                             'theme', null, 'isPlace', null, 'categories', '[]'::jsonb),
          'build', s.id, s.updated_at
     from public.stacks s where s.id = '${id}'`,
  false,
);
await page.goto(APP + `/create?edit=${id}`);
await page.getByText("Orinoco (old draft)").waitFor({ timeout: 10000 }).catch(() => {});
const keptPick = await page.getByText("Orinoco (old draft)").isVisible();
await page.getByRole("button", { name: "Finalize" }).click();
await page.getByRole("button", { name: "Theme emoji 🌮" }).waitFor({ timeout: 10000 }).catch(() => {});
const inherited =
  (await page.getByRole("button", { name: "Theme emoji 🌮" }).getAttribute("aria-pressed")) === "true" &&
  (await page.getByRole("button", { name: "Theme colour 3" }).getAttribute("aria-pressed")) === "true" &&
  (await page.getByText("You picked this theme.").isVisible()) &&
  (await page.getByRole("radio", { name: "Yes" }).getAttribute("aria-checked")) === "true" &&
  (await page.getByLabel("City").inputValue()) === "Oaxaca" &&
  (await page.getByRole("button", { name: "Food & Drink" }).getAttribute("aria-pressed")) === "true";
await page.getByRole("button", { name: "Save & exit" }).click();
// Save & exit goes back to where the editor was opened from (agreed Nov 27); the Stack page is checked directly.
await page.getByText("Changes published").waitFor({ timeout: 15000 }).catch(() => {});
await page.goto(APP + `/s/${id}`);
const r12 = stackRow(id);
check(
  "12a. An old edits draft (v 1, no theme or categories) reopens with its pick edit and the Stack's 🌮 theme, place answer, city Oaxaca and Food & Drink; saving keeps them",
  keptPick && inherited && r12?.sections[0].lines[0].text === "Orinoco (old draft)" && r12.theme_emoji === "🌮" && r12.theme_color === C3 && r12.is_place === true &&
    r12.location === "Oaxaca" && r12.categories.join() === "Food & Drink" && editDraft() === null,
  `kept ${keptPick} / inherited ${inherited} / ${JSON.stringify({ ...r12, sections: undefined })}`,
);

// 12b. In the new editor, clearing the categories on purpose is kept: the edits draft saves it (v 2), a refresh
//      still shows none, and saving publishes none.
await page.goto(APP + `/create?edit=${id}`);
await page.getByRole("button", { name: "Finalize" }).click();
await page.getByRole("button", { name: "Food & Drink" }).click();
let saved12 = false;
for (let i = 0; i < 60 && !saved12; i++, await page.waitForTimeout(250)) {
  const d = editDraft();
  saved12 = !!d && d.v === 2 && Array.isArray(d.categories) && d.categories.length === 0;
}
await page.reload();
await page.getByRole("button", { name: "Finalize" }).waitFor({ timeout: 10000 }).catch(() => {});
await page.getByRole("button", { name: "Finalize" }).click();
await page.getByRole("button", { name: "Food & Drink" }).waitFor({ timeout: 10000 }).catch(() => {});
const noneAfterRefresh =
  (await page.getByRole("button", { name: "Food & Drink" }).getAttribute("aria-pressed")) === "false" &&
  !(await page.locator("button[class*=catChip][aria-pressed=true]").count()) &&
  (await page.getByRole("button", { name: "Theme emoji 🌮" }).getAttribute("aria-pressed")) === "true";
await page.getByRole("button", { name: "Save & exit" }).click();
// Save & exit goes back to where the editor was opened from (agreed Nov 27); the Stack page is checked directly.
await page.getByText("Changes published").waitFor({ timeout: 15000 }).catch(() => {});
await page.goto(APP + `/s/${id}`);
await page.locator("[class*=pmPicks]").waitFor({ timeout: 10000 }).catch(() => {});
const meta12 = await metaText(page);
check(
  "12b. Clearing the categories in the new editor is saved to the edits draft (v 2), survives a refresh, and is published: no categories, and the row shows none",
  saved12 && noneAfterRefresh && stackRow(id)?.categories.length === 0 && stackRow(id)?.theme_emoji === "🌮" && !meta12.includes("Food") && meta12.startsWith("📍 Oaxaca · "),
  `saved ${saved12} / after refresh ${noneAfterRefresh} / ${meta12}`,
);

// 13. Save & exit goes back to where you were before the Stack (agreed Nov 27): Profile › the Stack › ⋯ › Edit stack
//     › Finalize › Save & exit lands on the profile, with the change saved.
await page.goto(APP + "/profile");
await page.getByText("Late-night tacos in CDMX").first().click();
await page.waitForURL(new RegExp(`/s/${id}$`), { timeout: 15000 }).catch(() => {});
await page.getByRole("button", { name: "Edit, visibility and delete" }).click();
await page.getByRole("button", { name: "Edit stack" }).click();
await page.waitForURL(/\/create\?edit=/, { timeout: 15000 }).catch(() => {});
await page.getByRole("button", { name: "Finalize" }).click();
await page.getByRole("button", { name: "Theme emoji 🎨" }).click();
await page.getByRole("button", { name: "Save & exit" }).click();
await page.waitForURL(/\/profile$/, { timeout: 15000 }).catch(() => {});
check(
  "13. Save & exit from Profile › the Stack › Edit lands back on the profile, and the change is saved",
  new URL(page.url()).pathname === "/profile" && stackRow(id)?.theme_emoji === "🎨" && (await page.getByText("Changes published").isVisible().catch(() => false)),
  page.url(),
);

// 14. iPhone fit: the narrowest iPhone (320 wide) with Safari's toolbar showing (460 tall). The Stack page and
//     Finalize › Preview fit without zooming out: nothing wider than the screen, Follow inside the card, the bottom
//     bar fully on screen, the picks scroll inside the card, and the tag filter stays pinned while they do.
const phone = await browser.newContext({ storageState: await ctx.storageState(), viewport: { width: 320, height: 460 }, deviceScaleFactor: SHOTS ? 2 : 1, isMobile: true, hasTouch: true });
const iphone = await phone.newPage();
const fit = (pg) =>
  pg.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const card = document.querySelector("[class*=pmCard]")?.getBoundingClientRect();
    const inCard = (sel) => {
      const b = document.querySelector(sel)?.getBoundingClientRect();
      return !b || !card || (b.left >= card.left - 0.5 && b.right <= card.right + 0.5);
    };
    const bar = document.querySelector("[class*=pmBar]")?.getBoundingClientRect();
    return {
      wide: document.documentElement.scrollWidth > vw || [...document.querySelectorAll("body *")].some((el) => el.getBoundingClientRect().right > vw + 0.5 && getComputedStyle(el).visibility !== "hidden"),
      follow: inCard("[class*=pmFollow], [class*=follow]"),
      card: !!card && card.left >= 0 && card.right <= vw,
      bar: !bar || bar.bottom <= innerHeight,
      scale: visualViewport.scale,
    };
  });
// The test's own Stack gets tags on its picks (as the database owner), so the tag filter shows; a visitor's view
// (Follow shows) is the fixture account's Stack.
psql(`update public.stacks set sections = jsonb_set(jsonb_set(sections, '{0,lines,0,tags}', '["Late night", "$$"]'), '{0,lines,1,tags}', '["Late night"]') where id = '${id}'`, false);
const other = sql("select id from public.stacks where status = 'published' and visibility = 'public' and author_id <> '" + sql(`select author_id from public.stacks where id = '${id}'`) + "' order by line_count desc limit 1");
const pages14 = [`/s/${id}`, ...(other ? [`/s/${other}`] : [])];
let ok14 = true;
const notes14 = [];
for (const path of pages14) {
  await iphone.goto(APP + path);
  await iphone.locator("[class*=pmPicks]").waitFor({ timeout: 10000 }).catch(() => {});
  const f = await fit(iphone);
  const body = iphone.locator("[class*=pmBody]");
  const scrolls = await body.evaluate((el) => {
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight;
    return el.scrollHeight > el.clientHeight && el.scrollTop > before;
  });
  await iphone.waitForTimeout(200);
  const pinned = await iphone.evaluate(() => {
    const flt = document.querySelector("[class*=pmFilter]"), body = document.querySelector("[class*=pmBody]");
    if (!flt) return "no filter";
    const fb = flt.getBoundingClientRect(), bb = body.getBoundingClientRect();
    return Math.abs(fb.top - bb.top) < 1.5 && [...flt.querySelectorAll("button")].every((c) => c.getBoundingClientRect().top >= bb.top - 0.5);
  });
  // The own Stack has tags, so its filter must be there and pinned.
  const own = path === `/s/${id}`;
  // The own Stack is long enough to scroll on this screen; the fixture's short one isn't.
  const ok = !f.wide && f.follow && f.card && f.bar && f.scale === 1 && (own ? scrolls && pinned === true : pinned !== false);
  ok14 &&= ok;
  notes14.push(`${path.slice(0, 10)}: ${JSON.stringify({ ...f, scrolls, pinned })}`);
  await shot(iphone, `iphone-320-${own ? "own" : "visitor"}`);
}
await iphone.goto(APP + `/create?edit=${id}`);
await iphone.getByRole("button", { name: "Finalize" }).click();
await iphone.getByRole("button", { name: /Preview your Stack/ }).click();
await iphone.locator("[class*=pmPicks]").waitFor({ timeout: 10000 }).catch(() => {});
const fp = await fit(iphone);
const saveShown = await iphone.getByRole("button", { name: "Save & exit" }).evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight).catch(() => false);
await shot(iphone, "iphone-320-preview");
check(
  "14. On a 320-wide iPhone with Safari's toolbar showing, the Stack page (own and a visitor's) and Finalize › Preview fit at default zoom: nothing wider than the screen, Follow inside the card, the bottom bar and Save & exit on screen, the picks scroll and the tag filter stays pinned",
  ok14 && !fp.wide && fp.follow && fp.card && fp.scale === 1 && saveShown,
  `${notes14.join(" | ")} | preview ${JSON.stringify(fp)} save ${saveShown}`,
);
await phone.close();

await browser.close();
cleanup();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\n${results.length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
