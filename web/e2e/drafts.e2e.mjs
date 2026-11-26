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
  else await page.getByRole("textbox", { name: /^(Item|Paragraph)$/ }).first().click();
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
  await page.getByText("Couldn't save").waitFor({ timeout: 10000 }).catch(() => {});
  check("1e. A lost reply shows Couldn't save", await page.getByText("Couldn't save").isVisible());
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

  // 2d. A draft that's over a limit (here 18 items of 353 characters, over the 6,000-character total) still
  //     autosaves; limits wait for publishing. Today's editor stops typing at the total, so the draft is seeded
  //     directly (it's this run's own account), then opened and edited in the browser.
  const overId = sql("select gen_random_uuid()");
  const longSections = JSON.stringify([{ label: "", lines: Array.from({ length: 18 }, (_, i) => ({ text: `${i} ` + "x".repeat(350), link: null, format: "num" })) }]);
  psql(`insert into public.drafts (id, owner_id, content, step) values ('${overId}', '${uid2}', '${JSON.stringify({ v: 1, title: "Too long", sections: JSON.parse(longSections) }).replace(/'/g, "''")}', 'build')`, false);
  await page.goto(APP + `/drafts/${overId}`);
  const banner = page.getByRole("alert").filter({ hasText: "over a size limit" });
  await banner.waitFor({ timeout: 10000 }).catch(() => {});
  // (Today's editor refuses additions while over the total, so the edit shortens the title.)
  await page.getByLabel("Title").fill("Long");
  await page.getByLabel("Title").blur();
  const rowOf = () => sql(`select (content->>'title') || '|' || jsonb_array_length(content->'sections'->0->'lines') from public.drafts where id = '${overId}'`);
  for (let i = 0; i < 40 && !rowOf().startsWith("Long|"); i++) await page.waitForTimeout(250);
  const row = rowOf();
  check(
    "2d. An over-limit draft shows the limit, says it's saved, and its edits save with every item kept",
    (await banner.isVisible()) && (await banner.innerText()).includes("Your draft is saved") && row === "Long|18",
    row,
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
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForTimeout(1500);
  const afterLost = stacksOf(uid);
  check("3a. The first publish reached the server (its reply was lost)", afterLost === "1", `stacks ${afterLost}`);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
  check("3b. Publishing again shows the published screen", await page.getByText("Your Stack is live").isVisible());
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
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(new RegExp(`/s/${draftId}`), { timeout: 15000 }).catch(() => {});
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
