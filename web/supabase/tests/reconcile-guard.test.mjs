// Proves that reconcile_email_keys.test.sql refuses invalid targets before its first write, both through the runner
// (run-db-test.mjs, which uses the shared guard in web/e2e/test-target.mjs) and when run with plain psql.
//
// For each bad target it expects: a "refusing to run" message, a non-zero exit, and no write. "No write" is shown
// three ways:
//   - runner: its statement log has only read-only statements (no W line, so the test file never ran);
//   - plain psql: every statement psql echoed (-e) belongs to the target check, which runs read-only;
//   - the whole Postgres server assigned no new transaction id (a write needs one; read-only work doesn't), and the
//     marked database's accounts, keys, collisions, tokens and marker are unchanged.
// Then the real target passes the runner's --verify-only, still without writing.
//
//   TEST_DB="host=/tmp port=55433 dbname=stack_test_x user=postgres" TEST_ENV_TOKEN=<marker token> \
//     [UNMARKED_DB=stack_test_y] node web/supabase/tests/reconcile-guard.test.mjs
// Keep other writers to the server (the test app, Auth) idle while it runs, or the transaction-id check can fail.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { connParts } from "../../e2e/test-target.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const runner = join(here, "run-db-test.mjs");
const testFile = join(here, "reconcile_email_keys.test.sql");
const DB = process.env.TEST_DB, TOKEN = process.env.TEST_ENV_TOKEN;
if (!DB || !TOKEN) throw new Error("set TEST_DB and TEST_ENV_TOKEN");
const { host, port, user } = connParts(DB);
const socket = `host=${host} port=${port} user=${user}`;
const unmarked = process.env.UNMARKED_DB || "stack_test_r3";
const RO = { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" };

const readRO = (q) => execFileSync("psql", ["-X", "-At", DB, "-c", q], { encoding: "utf8", env: RO }).trim();
const nextXid = () => readRO("select pg_snapshot_xmax(pg_current_snapshot())");
const snapshot = () =>
  readRO(`select json_build_object(
    'users', (select count(*) || '/' || coalesce(max(updated_at)::text, '') from auth.users),
    'keys', (select count(*) || '/' || md5(coalesce(string_agg(email_key || user_id, ',' order by email_key), '')) from private.account_email_keys),
    'collisions', (select count(*) || '/' || md5(coalesce(string_agg(email_key || user_id, ',' order by email_key, user_id), '')) from private.email_key_collisions),
    'tokens', (select md5(coalesce(string_agg(name || encode(token_sha256, 'hex'), ',' order by name), '')) from private.server_tokens),
    'marker', (select count(*) || '/' || max(created_at)::text from stack_test_env.marker))`);

const runnerCases = [
  ["remote database host", { TEST_DB: "host=db.example.invalid port=5432 dbname=stack_test_x user=postgres" }],
  ["host address forcing a network connection", { TEST_DB: `${DB} hostaddr=203.0.113.5` }],
  ["TCP connection to the real test database", { TEST_DB: `host=127.0.0.1 port=${port} dbname=${connParts(DB).dbname} user=${user}` }],
  ["local database that isn't a stack_test_* database", { TEST_DB: `${socket} dbname=postgres` }],
  ["stack_test_* database that doesn't exist", { TEST_DB: `${socket} dbname=stack_test_missing` }],
  ["stack_test_* database without the test marker", { TEST_DB: `${socket} dbname=${unmarked}` }],
  ["wrong TEST_ENV_TOKEN", { TEST_ENV_TOKEN: "not-the-token" }],
  ["no TEST_ENV_TOKEN", { TEST_ENV_TOKEN: "" }],
];
// Plain psql: [name, connection string, extra psql arguments]
const psqlCases = [
  ["no token given", DB, []],
  ["wrong token", DB, ["-v", "test_env_token=not-the-token"]],
  ["wrong token, with ON_ERROR_STOP turned off by the caller", DB, ["-v", "ON_ERROR_STOP=0", "-v", "test_env_token=not-the-token"]],
  ["TCP connection to the real test database, right token", `host=127.0.0.1 port=${port} dbname=${connParts(DB).dbname} user=${user}`, ["-v", `test_env_token=${TOKEN}`]],
  ["stack_test_* database without the test marker, right token", `${socket} dbname=${unmarked}`, ["-v", `test_env_token=${TOKEN}`]],
  ["local database that isn't a stack_test_* database, right token", `${socket} dbname=postgres`, ["-v", `test_env_token=${TOKEN}`]],
];

let failures = 0;
const report = (ok, name, detail) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};
const dir = mkdtempSync(join(tmpdir(), "reconcile-guard-"));
const before = snapshot();
const xidBefore = nextXid();

runnerCases.forEach(([name, over], i) => {
  const log = join(dir, `runner-${i}.log`);
  const env = { ...process.env, TEST_DB: DB, TEST_ENV_TOKEN: TOKEN, ...over, E2E_SQL_LOG: log, PGCONNECT_TIMEOUT: "5" };
  const r = spawnSync("node", [runner, testFile], { env, encoding: "utf8", timeout: 60000 });
  const lines = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
  const writes = lines.filter((l) => !l.startsWith("R "));
  const ok = r.status === 2 && /refusing to run/.test(r.stderr) && writes.length === 0 && !/target verified/.test(r.stdout);
  report(ok, `runner refuses: ${name}`, `${r.stderr.trim().split("\n").pop()} (${lines.length} read-only statements, ${writes.length} writes)`);
});

// Statements the target check sends, as psql echoes them; anything else means the file got past it.
const guardStatement = /^(begin transaction read only;|commit;|select current_database\(\) ~|select count\(\*\) = 1 and bool_and\(token|do \$\$ begin raise exception 'refusing to run)/;
psqlCases.forEach(([name, conn, args]) => {
  const r = spawnSync("psql", ["-X", "-q", "-e", conn, ...args, "-f", testFile], { encoding: "utf8", timeout: 60000 });
  const sent = r.stdout.split("\n").filter((l) => /^(begin|commit|select|do |delete|insert|update|alter|create|drop|lock|with|set|reset)\b/i.test(l));
  const outside = sent.filter((l) => !guardStatement.test(l));
  const ok = r.status !== 0 && /refusing to run/.test(r.stderr) && outside.length === 0;
  report(ok, `plain psql refuses: ${name}`, `${(r.stderr.match(/refusing to run[^\n]*/) || [r.stderr.trim()])[0]} (exit ${r.status}, ${sent.length} statements sent, ${outside.length} outside the check)`);
});

{
  const log = join(dir, "valid.log");
  const r = spawnSync("node", [runner, testFile, "--verify-only"], { env: { ...process.env, TEST_DB: DB, TEST_ENV_TOKEN: TOKEN, E2E_SQL_LOG: log }, encoding: "utf8" });
  const lines = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter(Boolean) : [];
  report(r.status === 0 && /target verified/.test(r.stdout) && lines.every((l) => l.startsWith("R ")), "runner accepts the real test database with --verify-only, without writing", r.stdout.trim());
}

const xidAfter = nextXid();
report(xidBefore === xidAfter, "no transaction id was assigned anywhere on the server (nothing wrote)", `next id ${xidBefore} → ${xidAfter}`);
const after = snapshot();
report(before === after, "the marked test database is unchanged", before === after ? "" : `${before} → ${after}`);
console.log(failures ? `\n${failures} guard checks failed` : "\nall reconcile guard checks passed");
process.exit(failures ? 1 : 0);
