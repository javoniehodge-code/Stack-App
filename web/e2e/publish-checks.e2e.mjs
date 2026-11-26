// End-to-end checks for the publish checks (Task 3; spec, Flow 1 Publish): Finalize's red "Fix N things before
// publishing" box, Publish looking off with the reason under it, the city's own toast and highlight, the "Couldn't
// publish" sheet with Try again and Keep editing, the slug fixed at first publish, and the database refusing what the
// app would block. Runs only against the disposable test environment (web/e2e/README.md), after the same
// read-only target checks as the other runners (test-target.mjs). It writes only to the account it creates
// (checks.<run>.*@stack.test) and removes it at the end, with its drafts and stacks.
//
//   APP_URL API_URL MAILPIT_URL ANON_KEY TEST_DB TEST_ENV_TOKEN [SHOTS=<dir>]  node web/e2e/publish-checks.e2e.mjs
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
if (sql("select to_regproc('public.stack_slug') is not null") !== "t") refuse("the publish checks migration isn't applied to the test database");
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

/** Task 3: publishing needs a category, and a city for a place Stack. Picks Food & Drink when none is picked, and answers
 *  No to the place question when the city is empty, so the checks below publish as before. */
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
  const email = `checks.${RUN}.a@stack.test`;
  created.push(email);
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  const after = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(await latestCode(email, after));
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await page.getByLabel("Display name").fill("Checks Tester");
  await page.getByLabel("Username").fill(`c${RUN}`.slice(0, 30));
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
const uid = await signUp(page);

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


const toastText = async () => (await page.locator("[role=status], [class*=toast]").allInnerTexts().catch(() => [])).join(" | ");
const boxText = async () => (await page.locator("[class*=fixBox]").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
const publishBtn = () => page.getByRole("button", { name: "Publish", exact: true });
const why = async () => (await page.locator("#publish-why").innerText().catch(() => "")).trim();
const stackCount = () => Number(sql(`select count(*) from public.stacks where author_id = '${uid}'`));

// A draft with every kind of problem: a description over the limit, a titled section with no items, no category, and
// a place Stack (tacos) with no city.
await page.goto(APP + "/new");
await page.getByLabel("Title").fill("Late-night tacos in CDMX");
await page.getByRole("button", { name: "Next" }).click();
await page.getByLabel("Description").fill("x".repeat(172));
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("textbox", { name: "Item heading" }).fill("Orinoco");
await page.getByRole("button", { name: "Section", exact: true }).click();
await page.getByRole("textbox", { name: "Section title" }).fill("Roma Norte");
await page.getByRole("textbox", { name: "Section title" }).press("Enter");
// Return on the section's new, empty pick leaves it, so the section stays without items.
await page.getByRole("textbox", { name: "Item heading" }).last().press("Enter");
const id = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
await untilDraft(id, (c) => (c.sections ?? []).some((s) => s.label === "Roma Norte"));
await page.getByRole("button", { name: "Finalize" }).click();
await page.locator("[class*=fixBox]").waitFor({ timeout: 10000 }).catch(() => {});
await page.locator("[class*=fixBox]").scrollIntoViewIfNeeded().catch(() => {});
await shot(page, "checks-box");
const box1 = await boxText();
const want1 = [
  "Fix 4 things before publishing:",
  "Description is 12 over 160 characters.",
  "“Roma Norte” has no items. Add one or remove the section.",
  "Pick at least 1 category.",
  "Add a city, or answer No to the place question.",
].join(" ");
check("1. Finalize's red box lists each problem, in order, with Fix 4 things before publishing:", box1 === want1, box1);
check(
  "2. Publish looks off, with the reason under it",
  (await publishBtn().getAttribute("aria-disabled")) === "true" && (await why()) === "Fix 4 things on this page to publish." &&
    (await publishBtn().getAttribute("aria-describedby")) === "publish-why",
  await why(),
);
await publishBtn().click({ force: true });
await page.waitForTimeout(400);
const t3 = await toastText();
check("3. Tapping it anyway publishes nothing and says the first problem (+3 more)", t3.includes("Description is 12 over 160 characters. (+3 more)") && stackCount() === 0, t3);

// 4. Fixing them one by one shrinks the box; with only the city left, it has its own reason, toast and highlight.
await page.getByRole("button", { name: "Food & Drink" }).click();
await untilDraft(id, (c) => (c.categories ?? []).length === 1);
const box4a = await boxText();
// Back to Build: remove the empty section's heading; back once more to the description and shorten it.
await page.getByRole("button", { name: "Back", exact: true }).click();
await page.getByRole("textbox", { name: "Section title" }).click();
await page.getByRole("button", { name: "Remove heading" }).click();
await page.getByRole("button", { name: "Done", exact: true }).last().click().catch(() => {});
await untilDraft(id, (c) => !(c.sections ?? []).some((s) => s.label === "Roma Norte"));
await page.getByRole("button", { name: "Back", exact: true }).click();
await page.getByLabel("Description").fill("x".repeat(150));
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Finalize" }).click();
await page.locator("[class*=fixBox]").waitFor({ timeout: 10000 }).catch(() => {});
const box4b = await boxText();
const why4 = await why();
await publishBtn().click({ force: true });
await page.waitForTimeout(400);
const t4 = await toastText();
const city = page.locator("label[class*=fzCity]");
const flagged = (await city.getAttribute("data-flag")) !== null;
const focused = await page.getByLabel("City").evaluate((el) => el === document.activeElement);
await shot(page, "checks-city");
check(
  "4. Fixing problems shrinks the box; with only the city left: Fix this before publishing:, Add a city to publish. under Publish, and tapping it toasts Add a city to publish this place stack. and highlights the city",
  box4a.startsWith("Fix 3 things before publishing:") && !box4a.includes("category") &&
    box4b === "Fix this before publishing: Add a city, or answer No to the place question." && why4 === "Add a city to publish." &&
    t4.includes("Add a city to publish this place stack.") && flagged && focused && stackCount() === 0,
  `${box4a} / ${box4b} / ${why4} / ${t4} / flag ${flagged} focus ${focused}`,
);
// 4b. The city's 80-character limit is in the list too.
await page.getByLabel("City").fill("M".repeat(85));
await untilDraft(id, (c) => (c.location ?? "").length === 85);
const box4c = await boxText();
check(
  "4b. A city over 80 characters is listed: City is 5 over 80 characters., and Publish stays off",
  box4c === "Fix this before publishing: City is 5 over 80 characters." && (await publishBtn().getAttribute("aria-disabled")) === "true" && (await why()) === "Fix 1 thing on this page to publish.",
  `${box4c} / ${await why()}`,
);
await page.getByLabel("City").fill("Mexico City");
await untilDraft(id, (c) => c.location === "Mexico City");
check(
  "5. With nothing left to fix, the box, the reason and the highlight go, and Publish looks on",
  !(await page.locator("[class*=fixBox]").count()) && !(await why()) && (await publishBtn().getAttribute("aria-disabled")) !== "true" && (await city.getAttribute("data-flag")) === null,
);

const sheet = page.getByRole("alertdialog");
const sheetNow = async () => (await sheet.innerText().catch(() => "")).replace(/\s+/g, " ").trim();

// 5b. The draft can't be saved on the way to publishing: nothing was sent to publish, and the sheet says so (not
//     "safe as a draft"); the save status says Not saved.
await page.route("**/rest/v1/drafts*", (r) => (r.request().method() === "POST" ? r.abort("internetdisconnected") : r.fallback()), { times: 1 });
await publishBtn().click({ force: true });
await sheet.waitFor({ timeout: 10000 }).catch(() => {});
const saveFail = await sheetNow();
const pill = (await page.getByText("Not saved").isVisible().catch(() => false));
check(
  "5b. A draft save that fails while publishing: Your latest changes couldn't be saved, so nothing was published., Not saved in the status, and no Stack",
  saveFail === "Couldn't publish Your latest changes couldn't be saved, so nothing was published. They're still here. Check your connection and try again. Try again Keep editing" &&
    pill && stackCount() === 0,
  `${saveFail} / pill ${pill}`,
);
await page.getByRole("button", { name: "Keep editing" }).click();

// 6. The publish itself fails (the connection drops before it arrives): the sheet, nothing published, the draft
//    kept. Keep editing closes it.
await page.route("**/rest/v1/rpc/publish_draft*", (r) => r.abort("internetdisconnected"));
await publishBtn().click({ force: true });
await sheet.waitFor({ timeout: 10000 }).catch(() => {});
await shot(page, "checks-failed");
const sheetText = await sheetNow();
check(
  "6. An unconfirmed publish opens Couldn't publish. Your stack is safe as a draft. … won't publish it twice. with Try again and Keep editing, and keeps the draft",
  sheetText === "Couldn't publish Your stack is safe as a draft. Check your connection and try again. If it went through, trying again won't publish it twice. Try again Keep editing" && stackCount() === 0 &&
    sql(`select count(*) from public.drafts where id = '${id}'`) === "1",
  sheetText,
);
await page.getByRole("button", { name: "Keep editing" }).click();
const closed = !(await sheet.count()) && (await page.getByLabel("City").inputValue()) === "Mexico City";
await publishBtn().click({ force: true });
await sheet.waitFor({ timeout: 10000 }).catch(() => {});
await page.unroute("**/rest/v1/rpc/publish_draft*");
await page.getByRole("button", { name: "Try again" }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const slug1 = sql(`select slug from public.stacks where id = '${id}'`);
check(
  "7. Keep editing closes it with everything kept; Try again publishes, with the slug late-night-tacos-in-cdmx",
  closed && (await page.getByText("Your Stack is live").isVisible()) && slug1 === "late-night-tacos-in-cdmx",
  slug1,
);

// 8. The database refuses what the app blocks, and gives each Stack its own slug (as this account, then rolled back).
const asUser = (q) => {
  try {
    // Through stdin, so every statement's result prints (-c would show only the last); -q drops BEGIN, SET and so on.
    return execFileSync("psql", ["-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", DB], {
      encoding: "utf8",
      input: `begin;\nset local role authenticated;\nselect set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', true) is not null as ok \\g /dev/null\n${q};\nrollback;\n`,
    }).trim();
  } catch (e) {
    return String(e.stderr || e.message);
  }
};
const tryPublish = (title, sections, { cats = "array['Food & Drink']", place = "false", city = "null" } = {}) => {
  const d = "gen_random_uuid()";
  return asUser(
    `with d as (insert into public.drafts (id, owner_id, content) values (${d}, '${uid}', '{}'::jsonb) returning id) ` +
      `select public.publish_draft((select id from d), '${title}', '${sections}'::jsonb, null, 'numbered', null, 'public', ${city}, null, null, ${place}, ${cats})`,
  );
};
const one = '[{"label":null,"lines":[{"text":"Orinoco","format":"num"}]}]';
const r8 = {
  cat: tryPublish("No category", one, { cats: "array[]::text[]" }),
  city: tryPublish("Tacos", one, { place: "true" }),
  empty: tryPublish("Nothing", '[{"label":null,"lines":[]}]'),
  section: tryPublish("Empty section", '[{"label":null,"lines":[{"text":"Orinoco","format":"num"}]},{"label":"Roma Norte","lines":[]}]'),
  ok: tryPublish("Late-night tacos in CDMX", one),
};
check(
  "8. The database refuses no category, a place Stack with no city, no items and a titled section with no items; a fine one publishes with the next free slug",
  r8.cat.includes("pick at least 1 category") && r8.city.includes("add a city to publish this place stack") && r8.empty.includes("add at least one item") &&
    r8.section.includes("a section has no items") && /^[0-9a-f-]{36}$/m.test(r8.ok),
  JSON.stringify(r8),
);
const slugs = asUser("select public.stack_slug('Late-night tacos in CDMX') || ' ' || public.stack_slug('Café São Paulo: ¡Más!') || ' ' || public.stack_slug('🌮🌮') || ' ' || public.stack_slug('  Top 10 — Ramen  ')");
const second = asUser(
  `with d as (insert into public.drafts (id, owner_id, content) values ('00000000-0000-4000-8000-000000000001', '${uid}', '{}'::jsonb) returning id) ` +
    `select public.publish_draft((select id from d), 'Late-night tacos in CDMX', '${one}'::jsonb, null, 'numbered', null, 'public', null, null, null, false, array['Food & Drink']); ` +
    `select slug from public.stacks where id = '00000000-0000-4000-8000-000000000001'`,
);
check(
  "9. Slugs: lowercase with accents removed and words joined by dashes, stack when nothing is left, and -2 when the same person already has it",
  slugs.split("\n").pop() === "late-night-tacos-in-cdmx cafe-sao-paulo-mas stack top-10-ramen" && second.split("\n").pop() === "late-night-tacos-in-cdmx-2",
  `${slugs} / ${second}`,
);

// 10. A title typed in the Name your Stack sheet is kept when the publish fails, and after a refresh.
await page.goto(APP + "/new");
await page.getByRole("button", { name: "Skip" }).click();
await page.getByRole("button", { name: "Skip" }).click();
await page.getByRole("textbox", { name: "Item heading" }).fill("Café de Tacuba");
await page.getByRole("button", { name: "Done", exact: true }).last().click();
const id10 = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
await page.getByRole("button", { name: "Finalize" }).click();
await readyToPublish(page);
await page.route("**/rest/v1/rpc/publish_draft*", (r) => r.abort("internetdisconnected"));
await publishBtn().click({ force: true });
await page.getByLabel("Title").fill("Quiet cafés");
await page.getByRole("dialog").getByRole("button", { name: "Publish", exact: true }).click();
await sheet.waitFor({ timeout: 10000 }).catch(() => {});
const failed10 = (await sheetNow()).startsWith("Couldn't publish Your stack is safe as a draft.");
const saved10 = await untilDraft(id10, (c) => c.title === "Quiet cafés");
await page.unroute("**/rest/v1/rpc/publish_draft*");
await page.reload();
await page.getByRole("button", { name: "Publish", exact: true }).waitFor({ timeout: 10000 }).catch(() => {});
await readyToPublish(page);
await publishBtn().click({ force: true });
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const r10 = sql(`select title || '|' || slug from public.stacks where id = '${id10}'`);
check(
  "10. A title typed in Name your Stack is saved to the draft when the publish fails, is still there after a refresh (Publish doesn't ask again), and is published with its slug",
  failed10 && saved10 && r10 === "Quiet cafés|quiet-cafes",
  `${failed10} / ${saved10} / ${r10}`,
);

// 11. The older save_stack: drafts still save; publishing through it gets the same checks (it has no categories, so
//     it's refused), both new and from one of its drafts. Rolled back.
const legacyLines = '[{"label":null,"lines":[{"text":"Orinoco","format":"num"}]}]';
const l11 = {
  // Saved, then read in a statement of its own (a statement doesn't see its own function's writes).
  draft: asUser(`select public.save_stack(null, 'Old draft', '${legacyLines}'::jsonb, null, 'draft') as sid \\gset\nselect status || '|' || coalesce(slug, '-') from public.stacks where id = :'sid'`),
  publish: asUser(`select public.save_stack(null, 'Old publish', '${legacyLines}'::jsonb, null, 'published')`),
  fromDraft: asUser(`select public.save_stack(public.save_stack(null, 'Old draft', '${legacyLines}'::jsonb, null, 'draft'), 'Old draft', '${legacyLines}'::jsonb, null, 'published')`),
  empty: asUser(`select public.save_stack(null, 'Nothing', '[]'::jsonb, null, 'published')`),
};
check(
  "11. save_stack still saves drafts (no slug), but publishing through it, new or from its draft, is refused by the publish checks",
  l11.draft === "draft|-" && l11.publish.includes("pick at least 1 category") && l11.fromDraft.includes("pick at least 1 category") && l11.empty.includes("pick at least 1 category"),
  JSON.stringify(l11),
);

// 12. Whatever way a Stack becomes published, it gets a slug, and keeps it; one can't be published without one.
//     (As the database owner, the only one who can write to stacks directly; rolled back.)
const owner = (q) => {
  try {
    return execFileSync("psql", ["-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", DB], { encoding: "utf8", input: `begin;\n${q};\nrollback;\n` }).trim();
  } catch (e) {
    return String(e.stderr || e.message);
  }
};
const own = {
  set: owner(`insert into public.stacks (id, author_id, title, status, sections) values ('00000000-0000-4000-8000-0000000000aa', '${uid}', 'Quiet cafés', 'published', '${legacyLines}'::jsonb) returning slug`),
  kept: owner(`update public.stacks set slug = 'changed', title = 'Renamed' where id = '${id}' returning slug`),
  none: owner(`alter table public.stacks disable trigger stacks_set_slug; insert into public.stacks (author_id, title, status, sections) values ('${uid}', 'No slug', 'published', '${legacyLines}'::jsonb)`),
  city: tryPublish("Long city", one, { place: "true", city: `'${"M".repeat(81)}'` }),
};
check(
  "12. A Stack published any way gets the next free slug (quiet-cafes-2) and keeps it through a rename; none is published without one; publish_draft refuses a city over 80",
  own.set === "quiet-cafes-2" && own.kept === "late-night-tacos-in-cdmx" && own.none.includes("stacks_published_slug") && own.city.includes("locations are limited to 80 characters"),
  JSON.stringify(own),
);

await browser.close();
cleanup();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\n${results.length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
