// The database half of the test-target guard, shared by every runner that writes to a test database
// (sign-in.e2e.mjs, supabase/tests/run-db-test.mjs). It only reads, through the `read` function it is given,
// which must run each statement in a read-only transaction. It refuses (through `refuse`, which must not return)
// unless all of these hold:
//   - the connection string names a single local Unix socket (host=/…), with no hostaddr;
//   - it names a disposable database called stack_test_*, and that is the database actually connected to;
//   - the database carries exactly one test marker (stack_test_env.marker, made by e2e/fixtures.sql), whose
//     token equals the one the caller was given.
// Returns the marker row.

/** Splits a libpq key=value connection string into its parts. */
export const connParts = (conn) =>
  Object.fromEntries([...conn.matchAll(/(\w+)=('[^']*'|\S+)/g)].map((m) => [m[1], m[2].replace(/^'|'$/g, "")]));

export function verifyTestDatabase({ conn, token, read, refuse }) {
  const parts = connParts(conn);
  if (!parts.host?.startsWith("/") || parts.hostaddr || /[,]/.test(parts.host)) refuse("TEST_DB must be a single local Unix socket (host=/…)");
  if (!/^stack_test_[a-z0-9_]+$/.test(parts.dbname ?? "")) refuse("TEST_DB must name a disposable database called stack_test_*");
  if (!token) refuse("set TEST_ENV_TOKEN to the token in the database's test marker");
  let marker;
  try {
    if (read("select current_database()") !== parts.dbname) refuse("connected to a different database than TEST_DB names");
    if (read("select inet_server_addr() is null") !== "t") refuse("the connection isn't through a local Unix socket");
    if (read("select to_regclass('stack_test_env.marker') is not null") !== "t") refuse("the database has no test marker");
    marker = read("select json_agg(m) from stack_test_env.marker m");
  } catch (e) {
    refuse(`couldn't read the test database (${String(e.stderr || e.message).trim().split("\n")[0]})`);
  }
  const rows = JSON.parse(marker || "[]");
  if (rows.length !== 1 || rows[0].token !== token) refuse("the test marker's token doesn't match TEST_ENV_TOKEN");
  return rows[0];
}
