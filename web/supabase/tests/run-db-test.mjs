// Runs a database test file that writes and commits (such as reconcile_email_keys.test.sql) against a disposable
// test database, after the shared test-target guard (web/e2e/test-target.mjs) has verified it, read-only. Any
// failure exits with code 2 before the file runs. The file also checks the target itself before its first write
// (a target check at the top of the file), so running it with plain psql is refused too unless the target is right.
//
//   TEST_DB="host=/tmp port=55433 dbname=stack_test_x user=postgres" TEST_ENV_TOKEN=<marker token> \
//     node web/supabase/tests/run-db-test.mjs web/supabase/tests/reconcile_email_keys.test.sql [--verify-only]
//
// E2E_SQL_LOG=<file> logs every statement this runner sends, marked R (read-only) or W (the test file itself).
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { verifyTestDatabase } from "../../e2e/test-target.mjs";

const refuse = (why) => {
  console.error(`refusing to run: ${why}`);
  process.exit(2);
};
const DB = process.env.TEST_DB || refuse("set TEST_DB");
const TOKEN = process.env.TEST_ENV_TOKEN || refuse("set TEST_ENV_TOKEN");
const file = process.argv.slice(2).find((a) => !a.startsWith("--")) || refuse("name the test file to run");
const LOG = process.env.E2E_SQL_LOG;

const read = (q) => {
  if (LOG) appendFileSync(LOG, `R ${q}\n`);
  return execFileSync("psql", ["-X", "-At", "-v", "ON_ERROR_STOP=1", DB, "-c", q], {
    encoding: "utf8",
    env: { ...process.env, PGOPTIONS: "-c default_transaction_read_only=on" },
  }).trim();
};

verifyTestDatabase({ conn: DB, token: TOKEN, read, refuse });
console.log(`target verified: database ${read("select current_database()")}`);
if (process.argv.includes("--verify-only")) process.exit(0);

if (LOG) appendFileSync(LOG, `W -f ${file}\n`);
const r = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", "-v", `test_env_token=${TOKEN}`, DB, "-f", file], { stdio: "inherit" });
process.exit(r.status ?? 1);
