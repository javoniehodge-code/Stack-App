// Checks that sign-in.e2e.mjs refuses invalid targets before writing anything. For each bad target it runs the
// runner with SQL logging on and expects: exit code 2, a "refusing to run" message, no write statement logged,
// no browser checks run, and the test database unchanged (row counts and latest timestamps, read read-only).
// A valid target with --verify-only must pass the checks, still without writing.
//
// Takes the same environment as sign-in.e2e.mjs (pointing at the real test environment):
//   APP_URL API_URL MAILPIT_URL ANON_KEY TEST_DB TEST_ENV_TOKEN EXISTING_EMAIL  node web/e2e/target-guard.test.mjs
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const runner = join(dirname(fileURLToPath(import.meta.url)), "sign-in.e2e.mjs");
const base = Object.fromEntries(["APP_URL", "API_URL", "MAILPIT_URL", "ANON_KEY", "TEST_DB", "TEST_ENV_TOKEN", "EXISTING_EMAIL"].map((k) => [k, process.env[k]]));
for (const [k, v] of Object.entries(base)) if (!v) throw new Error(`set ${k}`);
const socket = base.TEST_DB.replace(/dbname=\S+/, "");

// Everything that a write by the runner could touch, read in a read-only transaction.
const snapshot = () =>
  execFileSync(
    "psql",
    ["-X", "-At", base.TEST_DB, "-c",
      `select json_build_object(
         'users', (select count(*) || '/' || coalesce(max(updated_at)::text, '') from auth.users),
         'sessions', (select count(*) || '/' || coalesce(max(updated_at)::text, '') from auth.sessions),
         'profiles', (select count(*) from public.profiles),
         'likes', (select count(*) || '/' || coalesce(max(created_at)::text, '') from public.likes),
         'saves', (select count(*) || '/' || coalesce(max(created_at)::text, '') from public.saves),
         'marker', (select count(*) || '/' || max(created_at)::text from stack_test_env.marker))`],
    { encoding: "utf8", env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" } },
  ).trim();

const cases = [
  ["remote database host", { TEST_DB: "host=db.example.invalid port=5432 dbname=stack_test_x user=postgres" }],
  ["host address forcing a network connection", { TEST_DB: `${base.TEST_DB} hostaddr=203.0.113.5` }],
  ["local database that isn't a stack_test_* database", { TEST_DB: `${socket} dbname=postgres` }],
  ["stack_test_* database that doesn't exist", { TEST_DB: `${socket} dbname=stack_test_missing` }],
  ["stack_test_* database without the test marker", { TEST_DB: `${socket} dbname=${process.env.UNMARKED_DB || "stack_test_r3"}` }],
  ["wrong TEST_ENV_TOKEN", { TEST_ENV_TOKEN: "not-the-token" }],
  ["EXISTING_EMAIL that isn't the fixture account", { EXISTING_EMAIL: "someone.else@stack.test" }],
  ["remote API_URL", { API_URL: "https://example.invalid" }],
  ["APP_URL that isn't wired to the test API", { APP_URL: base.MAILPIT_URL }],
];

let failures = 0;
const report = (ok, name, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const dir = mkdtempSync(join(tmpdir(), "e2e-guard-"));
const before = snapshot();

cases.forEach(([name, over], i) => {
  const log = join(dir, `case-${i}.log`);
  const r = spawnSync("node", [runner], { env: { ...process.env, ...base, ...over, E2E_SQL_LOG: log }, encoding: "utf8", timeout: 60000 });
  const lines = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
  const writes = lines.filter((l) => !l.startsWith("R "));
  const ok = r.status === 2 && /refusing to run/.test(r.stderr) && writes.length === 0 && !/PASS|FAIL|target verified/.test(r.stdout);
  report(ok, `refuses: ${name}`, `${r.stderr.trim().split("\n").pop()} (${lines.length} read-only statements, ${writes.length} writes)`);
});

{
  const log = join(dir, "valid.log");
  const r = spawnSync("node", [runner, "--verify-only"], { env: { ...process.env, ...base, E2E_SQL_LOG: log }, encoding: "utf8", timeout: 60000 });
  const lines = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
  report(r.status === 0 && /target verified/.test(r.stdout) && lines.every((l) => l.startsWith("R ")), "accepts the real test environment with --verify-only, without writing", r.stdout.trim());
}

const after = snapshot();
report(before === after, "the test database is unchanged after all of the above", before === after ? "" : `${before} → ${after}`);
console.log(failures ? `\n${failures} guard checks failed` : "\nall guard checks passed");
process.exit(failures ? 1 : 0);
