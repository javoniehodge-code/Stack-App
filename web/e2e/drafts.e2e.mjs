// End-to-end checks for drafts (Task 2a): autosave to the owner-only drafts table, the draft's own address,
// retries that can't duplicate, over-limit drafts, leaving the editor, publishing once, and edits to a published
// stack. Runs only against the disposable test environment (web/e2e/README.md), after the same read-only target
// checks as the sign-in test (shared guard in test-target.mjs). It writes only to the accounts it creates
// (drafts.<run>.*@stack.test), and removes them at the end, with their drafts and stacks.
//
//   APP_URL API_URL MAILPIT_URL ANON_KEY TEST_DB TEST_ENV_TOKEN  node web/e2e/drafts.e2e.mjs
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { verifyTestDatabase } from "./test-target.mjs";

const refuse = (why) => {
  console.error(`refusing to run: ${why}`);
  process.exit(2);
};
const env = (k) => process.env[k] || refuse(`set ${k}`);
const APP = env("APP_URL"), API = env("API_URL"), MAIL = env("MAILPIT_URL"), DB = env("TEST_DB"), TOKEN = env("TEST_ENV_TOKEN");
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
  results.push({ name, ok: !!ok });
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

/** A new account (email code, then name and username), signed in on `page`. Returns its user id. */
async function signUp(page, label) {
  const email = `drafts.${RUN}.${label}@stack.test`;
  created.push(email);
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  const after = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(await latestCode(email, after));
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await page.getByLabel("Display name").fill(`Drafts ${label}`);
  await page.getByLabel("Username").fill(`d${RUN}${label}`.slice(0, 30));
  await page.getByText("✓ Available").waitFor();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  return sql(`select id from auth.users where email = '${email}'`);
}

const draftsOf = (uid) => sql(`select count(*) from public.drafts where owner_id = '${uid}'`);
const stacksOf = (uid) => sql(`select count(*) from public.stacks where author_id = '${uid}'`);
const saved = (page) => page.getByText("Saved just now").waitFor({ timeout: 10000 });
/** Types at the end of the editor's first item (the Build step); `existing` is text already in it, if any. */
async function typeItem(page, text, existing) {
  if (existing) await page.getByText(existing).first().click();
  else await page.getByRole("textbox", { name: "Item heading" }).first().click();
  await page.keyboard.press("End");
  await page.keyboard.type(text);
}
/** Lets the next matching request reach the server, then drops its reply, as on a flaky connection. */
async function loseNextReply(page, pattern) {
  await page.route(
    pattern,
    async (route) => {
      await route.fetch();
      await route.abort("connectionreset");
    },
    { times: 1 },
  );
}

/** Whether leaving the page now would ask first (the editor's beforeunload handler cancels the event). */
const warns = (page) => page.evaluate(() => {
  const e = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
});
const titleOf = (id) => sql(`select content->>'title' from public.drafts where id = '${id}'`);

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

// 1. New stack: the first change saves a draft under the app's own id, and the address becomes the draft's.
//    A refresh reopens it at the step it reached. A lost reply and a retry still leave one draft.
let uid, draftId;
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  uid = await signUp(page, "a");
  await page.goto(APP + "/new");
  await page.getByLabel("Title").fill(`Late-night tacos ${RUN}`);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await typeItem(page, "Taquería Orinoco");
  await saved(page);
  const path = new URL(page.url()).pathname;
  draftId = (path.match(/^\/drafts\/([0-9a-f-]{36})$/) || [])[1];
  check("1a. After the first save the address is /drafts/<id>", !!draftId, path);
  const row = sql(`select step || '|' || (content->>'title') || '|' || (content->'sections'->0->'lines'->0->>'text') from public.drafts where id = '${draftId}' and owner_id = '${uid}'`);
  check("1b. One draft in the drafts table, with the app's id, the step and what was typed", draftsOf(uid) === "1" && row === `build|Late-night tacos ${RUN}|Taquería Orinoco`, row);
  check("1c. Nothing in the stacks table yet", stacksOf(uid) === "0");

  await page.reload();
  await page.getByText("Taquería Orinoco").waitFor({ timeout: 10000 });
  check("1d. A refresh reopens the draft at the Build step, with its title and item", (await page.getByLabel("Title").inputValue()) === `Late-night tacos ${RUN}` && (await page.getByText("Taquería Orinoco").isVisible()));

  // The next save reaches the server but its reply is lost: the editor says so, and the retry updates the same draft.
  await loseNextReply(page, "**/rest/v1/drafts*");
  await typeItem(page, " (late)", "Taquería Orinoco");
  await page.getByRole("button", { name: "Not saved · Retry" }).waitFor({ timeout: 10000 }).catch(() => {});
  check("1e. A lost reply shows Not saved · Retry", await page.getByRole("button", { name: "Not saved · Retry" }).isVisible());
  await typeItem(page, "!", "(late)");
  await saved(page);
  const text = sql(`select content->'sections'->0->'lines'->0->>'text' from public.drafts where id = '${draftId}'`);
  check("1f. Saving again after a lost reply still leaves exactly one draft, with the latest text", draftsOf(uid) === "1" && /\(late\)!$/.test(text), text);

  await ctx.close();
}

// 2. Leaving: an empty editor leaves no draft; one with content keeps it and shows it in Profile › Drafts.
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const uid2 = await signUp(page, "b");
  await page.goto(APP + "/new");
  await page.getByRole("button", { name: /Exit|Close/ }).first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/new"));
  check("2a. Closing an empty editor leaves no draft", draftsOf(uid2) === "0");
  await page.goto(APP + "/new");
  await page.getByLabel("Title").fill("Kept draft");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await typeItem(page, "Something");
  await page.getByRole("button", { name: /Exit|Close/ }).first().click();
  await page.waitForURL(/\/profile/);
  await page.getByText("Kept draft").waitFor({ timeout: 10000 }).catch(() => {});
  check("2b. Closing with content keeps one draft and opens Profile › Drafts showing it", draftsOf(uid2) === "1" && (await page.getByText("Kept draft").isVisible()));
  await page.getByRole("button", { name: "Delete" }).first().click();
  await page.waitForTimeout(800);
  check("2c. Deleting it from Profile › Drafts removes it", draftsOf(uid2) === "0");

  // 2d. A draft that's over a limit (here 18 items, over 15, with 353-character headings, over 80) still
  //     autosaves; limits wait for publishing. The draft is seeded directly (it's this run's own account), then
  //     opened and edited in the browser.
  const overId = sql("select gen_random_uuid()");
  const longSections = JSON.stringify([{ label: "", lines: Array.from({ length: 18 }, (_, i) => ({ text: `${i} ` + "x".repeat(350), link: null, format: "num" })) }]);
  psql(`insert into public.drafts (id, owner_id, content, step) values ('${overId}', '${uid2}', '${JSON.stringify({ v: 1, title: "Too long", sections: JSON.parse(longSections) }).replace(/'/g, "''")}', 'build')`, false);
  await page.goto(APP + `/drafts/${overId}`);
  const overNote = page.getByText(/^heading 35\d\/80 · 27\d over$/).first();
  await overNote.waitFor({ timeout: 10000 }).catch(() => {});
  await page.getByLabel("Title").fill("Long");
  await page.getByLabel("Title").blur();
  const rowOf = () => sql(`select (content->>'title') || '|' || jsonb_array_length(content->'sections'->0->'lines') from public.drafts where id = '${overId}'`);
  for (let i = 0; i < 40 && !rowOf().startsWith("Long|"); i++) await page.waitForTimeout(250);
  const row = rowOf();
  check(
    "2d. An over-limit draft shows the limit on the pick, says it's saved, and its edits save with every item kept",
    (await overNote.isVisible()) && (await page.getByText("Saved just now").isVisible()) && row === "Long|18",
    row,
  );

  // 5. A slow save: while it's on its way, the status says it's saving and leaving asks first;
  //    once it lands, it says saved and leaving doesn't ask.
  const status5 = () => page.getByRole("status").first().innerText();
  await page.route(
    "**/rest/v1/drafts*",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const res = await route.fetch();
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill({ response: res });
    },
    { times: 1 },
  );
  await page.getByLabel("Title").fill("Lon");
  await page.getByLabel("Title").blur();
  await page.waitForTimeout(2200);
  check(
    "5a. Slow save in flight: status Saving…, and leaving asks first",
    (await page.getByText("Saving…").isVisible()) && (await warns(page)),
    await status5(),
  );
  await saved(page);
  check(
    "5b. Once it lands: status Saved just now, leaving doesn't ask, and the draft has the change",
    (await status5()).includes("Saved just now") && !(await warns(page)) && titleOf(overId) === "Lon",
    titleOf(overId),
  );

  // 6. A failed save: the status says "Not saved · Retry", and leaving still asks. Retry saves the change;
  //    the next save that works clears it.
  await page.route("**/rest/v1/drafts*", (route) => (route.request().method() === "POST" ? route.fulfill({ status: 500, body: "{}" }) : route.continue()), { times: 1 });
  await page.getByLabel("Title").fill("Lo");
  await page.getByLabel("Title").blur();
  const retry = page.getByRole("button", { name: "Not saved · Retry" });
  await retry.waitFor({ timeout: 10000 }).catch(() => {});
  check(
    "6a. Failed save: the status says Not saved · Retry, leaving asks, and the draft is unchanged",
    (await retry.isVisible()) && (await warns(page)) && titleOf(overId) === "Lon",
    await status5(),
  );
  await retry.click();
  for (let i = 0; i < 40 && titleOf(overId) !== "Lo"; i++) await page.waitForTimeout(250);
  await saved(page).catch(() => {});
  check("6c. Retry saves the change: Saved just now, and leaving doesn't ask", titleOf(overId) === "Lo" && !(await warns(page)) && (await status5()).includes("Saved just now"), titleOf(overId));
  await page.getByLabel("Title").fill("L");
  await page.getByLabel("Title").blur();
  for (let i = 0; i < 40 && titleOf(overId) !== "L"; i++) await page.waitForTimeout(250);
  await saved(page);
  check("6b. The next save works: saved, and leaving doesn't ask", titleOf(overId) === "L" && !(await warns(page)) && (await status5()).includes("Saved just now"));

  // 8. The first save is slow, and the next step is chosen while it's on its way. The editor still finishes
  //    saving (the step too), leaving stops asking, and a refresh reopens that step.
  await page.route(
    "**/rest/v1/drafts*",
    async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      const res = await route.fetch();
      await new Promise((r) => setTimeout(r, 4000));
      await route.fulfill({ response: res });
    },
    { times: 1 },
  );
  await page.goto(APP + "/new");
  await page.getByLabel("Title").fill(`Step test ${RUN}`);
  await page.waitForTimeout(1800); // the first autosave is now on its way, held back
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Description").waitFor();
  const stepId = () => sql(`select id || '|' || step from public.drafts where owner_id = '${uid2}' and content->>'title' = 'Step test ${RUN}'`);
  for (let i = 0; i < 40 && !stepId().endsWith("|description"); i++) await page.waitForTimeout(250);
  await page.waitForTimeout(500);
  const [sid, sstep] = stepId().split("|");
  check("8a. The draft finishes saving with the step that was chosen while the first save was slow", sstep === "description", stepId());
  check("8b. Leaving the page no longer asks", !(await warns(page)));
  await page.reload();
  await page.getByLabel("Description").waitFor({ timeout: 10000 }).catch(() => {});
  check(
    "8c. A refresh reopens the draft at that step",
    new URL(page.url()).pathname === `/drafts/${sid}` && (await page.getByLabel("Description").isVisible()) && (await page.getByRole("button", { name: /^(Next|Skip)$/ }).isVisible()),
    page.url(),
  );

  // 7. Opening a draft writes nothing. A stale copy left open (another device saved newer content after it was
  //    opened) doesn't overwrite the newer content, and leaving doesn't ask.
  const staleId = sql("select gen_random_uuid()");
  psql(`insert into public.drafts (id, owner_id, content, step) values ('${staleId}', '${uid2}', '{"v":1,"title":"Snapshot","sections":[{"label":"","lines":[{"text":"First","link":null,"format":"num"}]}]}', 'build')`, false);
  const writes = [];
  page.on("request", (r) => r.url().includes("/rest/v1/drafts") && r.method() !== "GET" && writes.push(r.method()));
  await page.goto(APP + `/drafts/${staleId}`);
  await page.getByText("First").waitFor();
  psql(`update public.drafts set content = jsonb_set(content, '{title}', '"Newer elsewhere"') where id = '${staleId}'`, false);
  const stamp = sql(`select updated_at from public.drafts where id = '${staleId}'`);
  await page.waitForTimeout(3000);
  check(
    "7. Opening a draft sends no write; a stale copy left open doesn't overwrite newer content, and leaving doesn't ask",
    writes.length === 0 && titleOf(staleId) === "Newer elsewhere" && sql(`select updated_at from public.drafts where id = '${staleId}'`) === stamp && !(await warns(page)),
    `writes: ${writes.length}, title: ${titleOf(staleId)}`,
  );
  await ctx.close();
}

// 3. Publishing (signed in as A again): a lost reply then Publish again makes exactly one stack, with the
//    draft's id, and removes the draft; the address becomes the stack's.
{
  const ctx = await browser.newContext(phone);
  const page = await ctx.newPage();
  const email = `drafts.${RUN}.a@stack.test`;
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  for (;;) {
    const age = Number(sql(`select coalesce(extract(epoch from now() - greatest(confirmation_sent_at, recovery_sent_at))::int, 999) from auth.users where email = '${email}'`));
    if (age > 31) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const after = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(await latestCode(email, after));
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.goto(APP + `/drafts/${draftId}`);
  await page.getByText("Taquería Orinoco").waitFor();
  await page.getByRole("button", { name: "Finalize" }).click();
  await loseNextReply(page, "**/rest/v1/rpc/publish_draft*");
  await readyToPublish(page);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForTimeout(1500);
  const afterLost = stacksOf(uid);
  // Task 3: when a publish's reply never comes, the app looks whether it went through. It did, so it says so, with
  // no "Couldn't publish" sheet.
  await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
  const failSheet = await page.getByRole("alertdialog").isVisible();
  check("3a. The first publish reached the server (its reply was lost); the app finds it published, with no Couldn't publish sheet", afterLost === "1" && !failSheet, `stacks ${afterLost}, sheet ${failSheet}`);
  check("3b. It shows the published screen", await page.getByText("Your Stack is live").isVisible());
  check(
    "3c. Exactly one stack, with the draft's id; the draft is gone",
    stacksOf(uid) === "1" && sql(`select count(*) from public.stacks where id = '${draftId}' and status = 'published'`) === "1" && draftsOf(uid) === "0",
    `stacks ${stacksOf(uid)}, drafts ${draftsOf(uid)}`,
  );
  check("3d. The address is now the stack's", new URL(page.url()).pathname === `/s/${draftId}`, page.url());

  // 4. Editing the published stack keeps unsaved edits in an edits draft; publishing the changes removes it.
  await page.goto(APP + `/create?edit=${draftId}`);
  await page.getByLabel("Title").fill(`Late-night tacos ${RUN}, edited`);
  await page.getByLabel("Title").blur();
  await page.getByText("Unsaved changes").waitFor({ timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const edits = sql(`select count(*) || '|' || coalesce(max(content->>'title'), '') from public.drafts where owner_id = '${uid}' and edit_of = '${draftId}'`);
  check("4a. Unsaved edits are kept in one edits draft for the stack", edits === `1|Late-night tacos ${RUN}, edited`, edits);
  await page.goto(APP + "/settings/stacks?filter=drafts");
  check("4b. Manage stacks › Drafts lists them as unsaved edits", await page.getByText("Unsaved edits to a published stack").isVisible());
  await page.goto(APP + `/create?edit=${draftId}`);
  check("4c. Reopening the edit brings the unsaved title back", (await page.getByLabel("Title").inputValue()) === `Late-night tacos ${RUN}, edited`);
  // The footer shows once no field is being typed in.
  await page.getByLabel("Title").blur();
  // Editing saves from Finalize (agreed Nov 27).
  await page.getByRole("button", { name: "Finalize" }).click();
  await page.getByRole("button", { name: "Save & exit" }).click();
  // Save & exit goes back to where the editor was opened from (agreed Nov 27); the Stack page is checked directly.
  await page.getByText("Changes published").waitFor({ timeout: 15000 }).catch(() => {});
  await page.goto(APP + `/s/${draftId}`);
  check(
    "4d. Publishing the changes updates the stack and removes the edits draft",
    sql(`select title from public.stacks where id = '${draftId}'`) === `Late-night tacos ${RUN}, edited` && draftsOf(uid) === "0",
  );
  await ctx.close();
}

await browser.close();
cleanup();
const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} of ${results.length} checks failed` : `\n${results.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
