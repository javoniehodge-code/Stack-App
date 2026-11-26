// Rollout check for Task 2a: a draft saved by the OLD app after the drafts migration (but before the new app is
// deployed) can be found, opened, edited and published in the NEW app. Two phases against the same disposable test
// database, which must already have 20261128000000_drafts applied:
//
//   old  (APP_URL serving the previous app build): sign up, start a stack, let it autosave. The old app saves its
//        draft in public.stacks (status 'draft'), as live would between the migration and the deployment.
//   new  (APP_URL serving this branch's build): sign in again; the draft shows in Profile › Drafts, opens with its
//        content, saves edits and publishes as one stack with the same id. Then removes the test account.
//
//   APP_URL MAILPIT_URL TEST_DB TEST_ENV_TOKEN STATE_FILE  node web/e2e/legacy-draft.e2e.mjs old|new
// Same target checks as the other runners (test-target.mjs); writes only to the account it creates.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { verifyTestDatabase } from "./test-target.mjs";

const refuse = (why) => {
  console.error(`refusing to run: ${why}`);
  process.exit(2);
};
const env = (k) => process.env[k] || refuse(`set ${k}`);
const APP = env("APP_URL"), MAIL = env("MAILPIT_URL"), DB = env("TEST_DB"), TOKEN = env("TEST_ENV_TOKEN"), STATE = env("STATE_FILE");
const phase = process.argv[2];
if (phase !== "old" && phase !== "new") refuse("say which phase: old or new");
const psql = (q, readOnly = true) =>
  execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", DB, "-c", q], {
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: readOnly ? "-c default_transaction_read_only=on" : "" },
  }).trim();
const sql = (q) => psql(q);
for (const u of [APP, MAIL]) if (!["localhost", "127.0.0.1"].includes(new URL(u).hostname)) refuse(`${u} isn't local`);
verifyTestDatabase({ conn: DB, token: TOKEN, read: sql, refuse });
if (sql("select to_regclass('public.drafts') is not null") !== "t") refuse("the drafts migration isn't applied to the test database");

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
async function emailCode(page, email) {
  for (;;) {
    const age = Number(sql(`select coalesce(extract(epoch from now() - greatest(confirmation_sent_at, recovery_sent_at))::int, 999) from auth.users where email = '${email}'`) || 999);
    if (age > 31) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await page.goto(APP + "/profile");
  await page.getByRole("button", { name: "Sign in / Create account" }).click();
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("Email address").fill(email);
  const after = Date.now() - 1000;
  await page.getByRole("button", { name: "Send code" }).click();
  await page.getByLabel("6-digit code").fill(await latestCode(email, after));
}

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

if (phase === "old") {
  const run = Date.now().toString(36);
  const email = `legacy.${run}@stack.test`;
  writeFileSync(STATE, JSON.stringify({ email, run }));
  await emailCode(page, email);
  await page.getByRole("heading", { name: "Make it yours" }).waitFor();
  await page.getByLabel("Display name").fill("Legacy Tester");
  await page.getByLabel("Username").fill(`legacy${run}`.slice(0, 30));
  await page.getByText("✓ Available").waitFor();
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.goto(APP + "/create");
  await page.getByLabel("Title").fill(`Old-app draft ${run}`);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Skip" }).click();
  await page.getByRole("textbox", { name: "Item heading" }).first().click();
  await page.keyboard.type("Saved by the old app");
  await page.getByText("Saved just now").waitFor({ timeout: 15000 });
  const uid = sql(`select id from auth.users where email = '${email}'`);
  const row = sql(`select id || '|' || status || '|' || title from public.stacks where author_id = '${uid}'`);
  check("old-1. The old app saved its draft in public.stacks (status draft), after the migration", row.endsWith(`|draft|Old-app draft ${run}`), row);
  check("old-2. Nothing for it in the drafts table yet", sql(`select count(*) from public.drafts where owner_id = '${uid}'`) === "0");
  writeFileSync(STATE, JSON.stringify({ email, run, uid, id: row.split("|")[0] }));
} else {
  const { email, run, uid, id } = JSON.parse(readFileSync(STATE, "utf8"));
  // Two more old-style drafts for this account, made directly (it's this run's own account):
  //  - one with tags;
  //  - one whose recovery was interrupted after the copy, and the copy was then edited in the new app.
  const tagged = sql("select gen_random_uuid()");
  const interrupted = sql("select gen_random_uuid()");
  const pick = `'[{"label":"","lines":[{"text":"A pick","link":null,"format":"num"}]}]'`;
  psql(
    `insert into public.stacks (id, author_id, title, sections, status) values
       ('${tagged}', '${uid}', 'Tagged legacy ${run}', ${pick}, 'draft'),
       ('${interrupted}', '${uid}', 'Interrupted legacy original ${run}', ${pick}, 'draft');
     insert into public.stack_tags (stack_id, tag) values ('${tagged}', 'Late night'), ('${tagged}', 'Cash only'), ('${interrupted}', 'Old tag');
     insert into public.drafts (id, owner_id, content, step) values
       ('${interrupted}', '${uid}', '{"v":1,"title":"Edited after the first copy ${run}","tags":["New tag"],"sections":${pick.slice(1, -1)}}', 'review');`,
    false,
  );
  await emailCode(page, email);
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.goto(APP + "/profile?tab=drafts");
  await page.getByText(`Old-app draft ${run}`).waitFor({ timeout: 10000 }).catch(() => {});
  check("new-1. The new app lists the old-app draft in Profile › Drafts", await page.getByText(`Old-app draft ${run}`).isVisible());
  check(
    "new-2. It moved to the drafts table with the same id and contents, and left public.stacks",
    sql(`select (content->>'title') || '|' || (content->'sections'->0->'lines'->0->>'text') from public.drafts where id = '${id}' and owner_id = '${uid}'`) === `Old-app draft ${run}|Saved by the old app` &&
      sql(`select count(*) from public.stacks where id = '${id}'`) === "0",
  );
  const tagRow = sql(`select (content->>'title') || '|' || (select string_agg(t, ',' order by t) from jsonb_array_elements_text(content->'tags') t) from public.drafts where id = '${tagged}'`);
  check(
    "new-6. A draft with tags moved with both tags, and its original is gone",
    tagRow === `Tagged legacy ${run}|Cash only,Late night` && sql(`select count(*) from public.stacks where id = '${tagged}'`) === "0",
    tagRow,
  );
  const intRow = sql(`select (content->>'title') || '|' || step || '|' || (content->'tags'->>0) from public.drafts where id = '${interrupted}'`);
  check(
    "new-7. An interrupted recovery: the copy's newer edits (title, step, tags) are kept, and the original is gone",
    intRow === `Edited after the first copy ${run}|review|New tag` && sql(`select count(*) from public.stacks where id = '${interrupted}'`) === "0",
    intRow,
  );
  check("new-8. Profile › Drafts lists all three", (await page.getByText(`Tagged legacy ${run}`).isVisible()) && (await page.getByText(`Edited after the first copy ${run}`).isVisible()));
  await page.getByText(`Old-app draft ${run}`).click();
  await page.waitForURL(new RegExp(`/drafts/${id}$`));
  await page.getByText("Saved by the old app").waitFor();
  check("new-3. It opens at /drafts/<same id> with its title and item", (await page.getByLabel("Title").inputValue()) === `Old-app draft ${run}`);
  await page.getByText("Saved by the old app").click();
  await page.keyboard.press("End");
  await page.keyboard.type(", edited in the new app");
  for (let i = 0; i < 40 && !sql(`select content->'sections'->0->'lines'->0->>'text' from public.drafts where id = '${id}'`).endsWith("new app"); i++) await page.waitForTimeout(250);
  check("new-4. Edits to it save to the same draft", sql(`select content->'sections'->0->'lines'->0->>'text' from public.drafts where id = '${id}'`) === "Saved by the old app, edited in the new app");
  // The footer shows once no field is being typed in.
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Finalize" }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.getByText("Your Stack is live").waitFor({ timeout: 15000 }).catch(() => {});
  check(
    "new-5. It publishes as one stack with the same id, and its draft is gone (the other two stay)",
    sql(`select count(*) from public.stacks where author_id = '${uid}' and status = 'published'`) === "1" &&
      sql(`select count(*) from public.stacks where id = '${id}' and status = 'published'`) === "1" &&
      sql(`select count(*) from public.drafts where id = '${id}'`) === "0" &&
      sql(`select count(*) from public.drafts where owner_id = '${uid}'`) === "2",
  );
  psql(`delete from auth.users where id = '${uid}'`, false);
  console.log("removed the test account");
}

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(failed ? `\n${failed} of ${results.length} checks failed` : `\n${results.length}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
