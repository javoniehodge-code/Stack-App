// End-to-end checks for the publish checks (Task 3; spec, Flow 1 Publish): Finalize's red "Fix N things before
// publishing" box, Publish looking off with the reason under it, the city's own toast and highlight, the "Couldn't
// publish" sheet with Try again and Keep editing, the slug fixed at first publish, and the database refusing what the
// app would block. Runs only against the disposable test environment (web/e2e/README.md), after the same
// read-only target checks as the other runners (test-target.mjs). It writes only to the account it creates
// (checks.<run>.*@stack.test) and removes it at the end, with its drafts and stacks.
//
//   APP_URL API_URL MAILPIT_URL ANON_KEY TEST_DB TEST_ENV_TOKEN [SHOTS=<dir>]  node web/e2e/publish-checks.e2e.mjs
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


const toastText = async () => (await page.locator("[role=status], [class*=toast]").allInnerTexts().catch(() => [])).join(" | ");
const boxText = async () => (await page.locator("[class*=fixBox]").innerText().catch(() => "")).replace(/\s+/g, " ").trim();
const publishBtn = () => page.getByRole("button", { name: "Publish", exact: true });
const why = async () => (await page.locator("#publish-why").innerText().catch(() => "")).trim();
const stackCount = () => Number(sql(`select count(*) from public.stacks where author_id = '${uid}'`));

// A draft with a description over the limit and a titled section with no items. It's a place Stack (tacos) with no
// city and no category, which is fine (agreed Nov 27: only a title, one pick and the limits are needed).
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
const want1 = ["Fix 2 things before publishing:", "Description is 12 over 160 characters.", "“Roma Norte” has no items. Add one or remove the section."].join(" ");
check("1. Finalize's red box lists each problem, in order, with Fix 2 things before publishing:; no category or city is asked for", box1 === want1, box1);
check(
  "2. Publish looks off, with the reason under it",
  (await publishBtn().getAttribute("aria-disabled")) === "true" && (await why()) === "Fix 2 things on this page to publish." &&
    (await publishBtn().getAttribute("aria-describedby")) === "publish-why",
  await why(),
);
await publishBtn().click({ force: true });
await page.waitForTimeout(400);
const t3 = await toastText();
check("3. Tapping it anyway publishes nothing and says the first problem (+1 more)", t3.includes("Description is 12 over 160 characters. (+1 more)") && stackCount() === 0, t3);

// 4. Fixing them: back to Build to remove the empty section's heading, and once more to shorten the description.
await page.getByRole("button", { name: "Back", exact: true }).click();
await page.getByRole("textbox", { name: "Section title" }).click();
await page.getByRole("button", { name: "Remove heading" }).click();
await page.getByRole("button", { name: "Done", exact: true }).last().click().catch(() => {});
await untilDraft(id, (c) => !(c.sections ?? []).some((s) => s.label === "Roma Norte"));
await page.getByRole("button", { name: "Back", exact: true }).click();
await page.getByLabel("Description").fill("x".repeat(150));
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Finalize" }).click();
await page.getByLabel("City").waitFor({ timeout: 10000 }).catch(() => {});
await shot(page, "checks-city");
const city = page.getByLabel("City");
check(
  "4. With those fixed, nothing is left to fix, though it's a place Stack with no city and no category: no box, Publish looks on, and the city says (optional)",
  !(await page.locator("[class*=fixBox]").count()) && !(await why()) && (await publishBtn().getAttribute("aria-disabled")) !== "true" &&
    (await city.getAttribute("placeholder")) === "City (optional), e.g. Mexico City" && (await city.getAttribute("aria-required")) === null &&
    (await page.getByText("Looks like a place stack. Adding the city helps people find it.").isVisible()) &&
    !(await page.getByText("Add a city to publish.").count()) &&
    (await page.getByText("Optional. Pick up to 2 to help people find your Stack in Explore and search.").isVisible()),
);
// 4b. The city's 80-character limit is still listed.
await city.fill("M".repeat(85));
await untilDraft(id, (c) => (c.location ?? "").length === 85);
const box4c = await boxText();
check(
  "4b. A city over 80 characters is listed: City is 5 over 80 characters., and Publish stays off",
  box4c === "Fix this before publishing: City is 5 over 80 characters." && (await publishBtn().getAttribute("aria-disabled")) === "true" && (await why()) === "Fix 1 thing on this page to publish.",
  `${box4c} / ${await why()}`,
);
await city.fill("Mexico City");
await untilDraft(id, (c) => c.location === "Mexico City");
check("5. With the city shortened, the box and the reason go, and Publish looks on", !(await page.locator("[class*=fixBox]").count()) && !(await why()) && (await publishBtn().getAttribute("aria-disabled")) !== "true");

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

// 6. The publish doesn't arrive (the connection drops on the way), and the status check says it's still a draft:
//    no sheet, a toast, and editing goes on with everything kept.
const STACK_CHECK = /\/rest\/v1\/rpc\/publish_status/;
await page.route("**/rest/v1/rpc/publish_draft*", (r) => r.abort("internetdisconnected"));
await publishBtn().click({ force: true });
await page.getByText("Your stack is still a draft").waitFor({ timeout: 10000 }).catch(() => {});
const t6 = await toastText();
check(
  "6. Not published and confirmed a draft: no sheet, the toast Couldn't publish. Your stack is still a draft. Check your connection and try again., the draft kept and editable",
  !(await sheet.count()) && t6.includes("Couldn't publish. Your stack is still a draft. Check your connection and try again.") && stackCount() === 0 &&
    sql(`select count(*) from public.drafts where id = '${id}'`) === "1" && (await page.getByLabel("City").isEditable()),
  t6,
);

// 6b. Not published, and the status check fails too: Publish status unknown, with only Check again (editing stays
//     closed). A failed Check again says so; one that gets through and finds a draft goes back to editing.
// (The app's database client retries a failed read a few times, so the check stays blocked until it's lifted.)
await page.route(STACK_CHECK, (r) => r.abort("internetdisconnected"));
await publishBtn().click({ force: true });
await sheet.waitFor({ timeout: 30000 }).catch(() => {});
await shot(page, "checks-unknown");
const unknown6 = await sheetNow();
const onlyCheck = (await sheet.getByRole("button").allInnerTexts()).join() === "Check again";
await page.mouse.click(195, 120);
const stays = (await sheet.count()) === 1;
await page.getByRole("button", { name: "Check again" }).click();
await page.getByText("Still couldn't check. Try again in a moment.").waitFor({ timeout: 30000 }).catch(() => {});
const again6 = await page.getByText("Still couldn't check. Try again in a moment.").isVisible();
await page.unroute(STACK_CHECK);
await page.getByRole("button", { name: "Check again" }).click();
await sheet.waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
const resumed = !(await sheet.count()) && (await page.getByLabel("City").isEditable()) && stackCount() === 0;
check(
  "6b. Unknown: Publish status unknown … check again., only Check again, tapping outside doesn't close it; a failed check says Still couldn't check.; a check finding a draft goes back to editing",
  unknown6 === "Publish status unknown Your connection dropped before we heard back, so we can't tell yet whether your stack was published. It won't be published twice. Check your connection, then check again. Check again" &&
    onlyCheck && stays && again6 && resumed,
  `${unknown6} / only ${onlyCheck} / stays ${stays} / again ${again6} / resumed ${resumed}`,
);

// 7. Back online: Publish works, with the slug.
await page.unroute("**/rest/v1/rpc/publish_draft*");
await publishBtn().click({ force: true });
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const slug1 = sql(`select slug from public.stacks where id = '${id}'`);
const row7 = sql(`select slug || '|' || location || '|' || cardinality(categories) from public.stacks where id = '${id}'`);
check("7. Publishing again works, with no category: the slug late-night-tacos-in-cdmx, the city, and no categories", (await page.getByText("Your Stack is live").isVisible()) && slug1 === "late-night-tacos-in-cdmx" && row7 === "late-night-tacos-in-cdmx|Mexico City|0", row7);

// 7b. The server commits the publish, but its reply and the status check right after are both lost: Publish status
//     unknown, with the Stack already live. Check again finds it live and opens the published Stack; one Stack only.
await page.goto(APP + "/new");
await page.getByLabel("Title").fill("Rooftop bars");
await page.getByRole("button", { name: "Next" }).click();
await page.getByRole("button", { name: "Skip" }).click();
await page.getByRole("textbox", { name: "Item heading" }).fill("Terraza Cha Cha Chá");
await page.getByRole("button", { name: "Done", exact: true }).last().click();
const id7 = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
await page.getByRole("button", { name: "Finalize" }).click();
await readyToPublish(page);
await page.route("**/rest/v1/rpc/publish_draft*", async (r) => (await r.fetch(), r.abort("connectionreset")), { times: 1 });
await page.route(STACK_CHECK, (r) => r.abort("internetdisconnected"));
await publishBtn().click({ force: true });
await sheet.waitFor({ timeout: 30000 }).catch(() => {});
const unknown7 = (await sheetNow()).startsWith("Publish status unknown");
const committed = sql(`select count(*) from public.stacks where id = '${id7}' and status = 'published'`);
await page.unroute(STACK_CHECK);
await page.getByRole("button", { name: "Check again" }).click();
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const live7 = (await page.getByText("Your Stack is live").isVisible()) && new URL(page.url()).pathname === `/s/${id7}`;
check(
  "7b. Committed, with the reply and the first check lost: Publish status unknown; Check again opens the published Stack (Your Stack is live, its address); exactly one Stack, the draft gone",
  unknown7 && committed === "1" && live7 && sql(`select count(*) from public.stacks where author_id = '${uid}' and title = 'Rooftop bars'`) === "1" &&
    sql(`select count(*) from public.drafts where id = '${id7}'`) === "0",
  `unknown ${unknown7} / committed ${committed} / live ${live7} / ${page.url()}`,
);

// 7c. A slow publish: the server is still working on it when its reply is lost, and commits only after the status
//     check has started. The check waits for it and finds it live: the app opens the published Stack, never goes
//     back to draft editing, and there's one Stack.
async function newDraft(title, item) {
  await page.goto(APP + "/new");
  await page.getByLabel("Title").fill(title);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("textbox", { name: "Item heading" }).fill(item);
  await page.getByRole("button", { name: "Done", exact: true }).last().click();
  const d = await page.waitForURL(/\/drafts\//).then(() => draftIdOf(page));
  await page.getByRole("button", { name: "Finalize" }).click();
  await readyToPublish(page);
  return d;
}
/** Hands the browser's publish to `onSent` (which may send it on from here first), then tells the browser its
 *  connection dropped. */
const sendOnAndDrop = (onSent) => async (route) => {
  const q = route.request();
  await onSent({ url: q.url(), headers: q.headers(), body: q.postData() });
  await route.abort("connectionreset");
};
const replay = (req) => fetch(req.url, { method: "POST", headers: req.headers, body: req.body }).then(async (r) => ({ status: r.status, text: await r.text() }));
/** A database session holding a lock until release(): while it holds stacks in share mode, a publish can't insert. */
function holdStacks() {
  const p = spawn("psql", ["-X", "-At", "-q", "-v", "ON_ERROR_STOP=1", DB], { stdio: ["pipe", "pipe", "pipe"] });
  const held = new Promise((ok) => p.stdout.on("data", (b) => String(b).includes("held") && ok()));
  p.stdin.write("begin;\nlock table public.stacks in share mode;\nselect 'held';\n");
  return { held, release: () => new Promise((ok) => (p.on("exit", ok), p.stdin.end("commit;\n"))) };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waiting = (fn) => sql(`select count(*) from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%${fn}%' and query not like '%pg_stat_activity%'`);
async function until(ok, ms = 15000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (await ok()) return true;
  return false;
}

const id7c = await newDraft("Late bakeries", "Pastelería Ideal");
const lock = holdStacks();
await lock.held;
let slow;
let publishHeld = false;
// The publish reaches the server first and is held at its insert; only then does the browser lose its connection.
await page.route(
  "**/rest/v1/rpc/publish_draft*",
  sendOnAndDrop(async (req) => {
    slow = replay(req);
    publishHeld = await until(() => waiting("publish_draft") === "1");
  }),
  { times: 1 },
);
const toasts7c = [];
await page.exposeFunction("noteToast7c", (t) => toasts7c.push(t));
await page.evaluate(() => new MutationObserver(() => document.querySelectorAll("[role=status]").forEach((n) => n.textContent && window.noteToast7c(n.textContent))).observe(document.body, { subtree: true, childList: true, characterData: true }));
await publishBtn().click({ force: true });
// The app's status check has started and is waiting for the held publish.
const checkWaits = await until(() => waiting("publish_status") === "1");
const notYet = sql(`select count(*) from public.stacks where id = '${id7c}'`) === "0" && !(await page.getByText("Your Stack is live").isVisible());
await lock.release();
const slowReply = await slow;
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
const live7c = (await page.getByText("Your Stack is live").isVisible()) && new URL(page.url()).pathname === `/s/${id7c}`;
await page.waitForTimeout(2500);
const noDraftAgain = sql(`select count(*) from public.drafts where id = '${id7c}'`) === "0";
check(
  "7c. A slow publish that commits after the status check started: the check waits, the app opens the live Stack, never says it's still a draft or reopens editing (no draft comes back), and there's exactly one Stack",
  publishHeld && checkWaits && notYet && slowReply.status === 200 && live7c && noDraftAgain && !toasts7c.some((t) => t.includes("still a draft")) &&
    !(await sheet.count()) && sql(`select count(*) from public.stacks where author_id = '${uid}' and title = 'Late bakeries'`) === "1",
  `held ${publishHeld} / check waits ${checkWaits} / not yet ${notYet} / reply ${slowReply.status} / live ${live7c} / no draft ${noDraftAgain} / toasts ${JSON.stringify(toasts7c)}`,
);

// 7d. A publish that arrives only after the status check answered "still a draft": the server refuses it, so the
//     draft the app went back to editing stays a draft. Publishing again works.
const id7d = await newDraft("Night markets", "Mercado de Coyoacán");
let late;
await page.route("**/rest/v1/rpc/publish_draft*", sendOnAndDrop((req) => (late = req)), { times: 1 });
await publishBtn().click({ force: true });
await page.getByText("Your stack is still a draft").waitFor({ timeout: 15000 }).catch(() => {});
const draftSaid = await page.getByText("Your stack is still a draft").isVisible();
const lateReply = late ? await replay(late) : { status: 0, text: "not sent" };
const stillDraft = sql(`select count(*) from public.stacks where id = '${id7d}'`) === "0" && sql(`select count(*) from public.drafts where id = '${id7d}'`) === "1";
await publishBtn().click({ force: true });
await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
check(
  "7d. A publish arriving after the check said still a draft is refused (this publish was stopped), the draft stays; publishing again works",
  draftSaid && lateReply.status >= 400 && lateReply.text.includes("this publish was stopped") && stillDraft && (await page.getByText("Your Stack is live").isVisible()) &&
    sql(`select count(*) from public.stacks where id = '${id7d}'`) === "1",
  `${draftSaid} / ${lateReply.status} ${lateReply.text.slice(0, 80)} / ${stillDraft}`,
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
const uuidLine = /^[0-9a-f-]{36}$/m;
check(
  "8. The database publishes with no category and a place Stack with no city; it refuses no items and a titled section with no items; a fine one publishes with the next free slug",
  uuidLine.test(r8.cat) && uuidLine.test(r8.city) && r8.empty.includes("add at least one item") && r8.section.includes("a section has no items") && uuidLine.test(r8.ok),
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
await page.getByText("Your stack is still a draft").waitFor({ timeout: 10000 }).catch(() => {});
const failed10 = (await toastText()).includes("Your stack is still a draft");
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
  publish: asUser(`select public.save_stack(null, 'Old publish', '${legacyLines}'::jsonb, null, 'published') as sid \\gset\nselect status || '|' || slug from public.stacks where id = :'sid'`),
  fromDraft: asUser(`select public.save_stack(public.save_stack(null, 'Old draft', '${legacyLines}'::jsonb, null, 'draft'), 'Old draft', '${legacyLines}'::jsonb, null, 'published') as sid \\gset\nselect status || '|' || slug from public.stacks where id = :'sid'`),
  empty: asUser(`select public.save_stack(null, 'Nothing', '[]'::jsonb, null, 'published')`),
  untitled: asUser(`select public.save_stack(null, '', '${legacyLines}'::jsonb, null, 'published')`),
};
check(
  "11. save_stack still saves drafts (no slug); publishing through it gets the same checks: with a title and a pick it publishes with a slug, new or from its draft; no picks or no title is refused",
  l11.draft === "draft|-" && l11.publish === "published|old-publish" && l11.fromDraft === "published|old-draft" && l11.empty.includes("add at least one item") &&
    l11.untitled.includes("add a title"),
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
