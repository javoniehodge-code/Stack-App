// Retry checks for old-draft recovery (src/lib/legacyDrafts.ts), with a stand-in for the database that can fail
// at any step: listing, reading tags, copying, confirming the copy, or removing the original. No network.
//
//   node --experimental-strip-types web/e2e/legacy-adopt.test.mjs
import { adoptLegacyDrafts } from "../src/lib/legacyDrafts.ts";

const ME = "user-1";

/** An in-memory stacks / stack_tags / drafts store whose operations can be made to fail or throw. */
function fakeDb({ stacks = [], tags = [], drafts = [] } = {}, failures = {}) {
  const db = { stacks: structuredClone(stacks), stack_tags: structuredClone(tags), drafts: structuredClone(drafts) };
  const calls = [];
  const client = {
    from(table) {
      const q = { table, op: "select", filters: [], row: null, opts: null, single: false };
      const run = async () => {
        const key = `${table}.${q.op}`;
        calls.push(key);
        if (failures[key] === "throw") throw new Error(`network error on ${key}`);
        if (failures[key]) return { data: null, error: { message: "" } }; // an error with no message counts too
        const match = (r) => q.filters.every(([c, v]) => r[c] === v);
        if (q.op === "select") {
          const rows = db[table].filter(match);
          return { data: q.single ? (rows[0] ?? null) : rows, error: null };
        }
        if (q.op === "upsert") {
          const existing = db[table].find((r) => r.id === q.row.id);
          if (existing && q.opts?.ignoreDuplicates) return { data: null, error: null };
          if (existing) Object.assign(existing, q.row);
          else db[table].push({ owner_id: ME, ...structuredClone(q.row) });
          return { data: null, error: null };
        }
        if (q.op === "delete") {
          db[table] = db[table].filter((r) => !match(r));
          return { data: null, error: null };
        }
      };
      const chain = {
        select() {
          return chain;
        },
        eq(c, v) {
          q.filters.push([c, v]);
          return chain;
        },
        maybeSingle() {
          q.single = true;
          return chain;
        },
        upsert(row, opts) {
          q.op = "upsert";
          q.row = row;
          q.opts = opts;
          return chain;
        },
        delete() {
          q.op = "delete";
          return chain;
        },
        then(ok, fail) {
          return run().then(ok, fail);
        },
      };
      return chain;
    },
  };
  return { client, db, calls };
}

const legacy = (id, title) => ({
  id,
  author_id: ME,
  status: "draft",
  title,
  description: "",
  sections: [{ label: "", lines: [{ text: "A pick", link: null, format: "num" }] }],
  style: "numbered",
  visibility: "unlisted",
  location: "",
  edit_of: null,
  forked_from_id: null,
  created_at: "2026-11-26T00:00:00Z",
});

let fails = 0;
const check = (name, ok, detail = "") => {
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

// 1. A draft with tags moves with its tags, and the original goes.
{
  const f = fakeDb({ stacks: [legacy("d1", "Tagged")], tags: [{ stack_id: "d1", tag: "Late night" }, { stack_id: "d1", tag: "$" }] });
  const r = await adoptLegacyDrafts(f.client, ME);
  const copy = f.db.drafts.find((d) => d.id === "d1");
  check("1. A draft with tags moves with both tags, its contents and visibility, and the original is removed",
    r.moved.includes("d1") && copy?.content.title === "Tagged" && JSON.stringify(copy.content.tags) === '["Late night","$"]' && copy.content.visibility === "unlisted" && f.db.stacks.length === 0,
    JSON.stringify(copy?.content.tags));
}

// 2–5. A failure at any step keeps the original, and a later try (with nothing failing) finishes the move.
for (const [n, step, label] of [
  [2, "stack_tags.select", "reading its tags fails"],
  [3, "drafts.upsert", "copying it fails"],
  [4, "drafts.select", "confirming the copy fails"],
  [5, "stacks.delete", "removing the original fails"],
]) {
  for (const how of [true, "throw"]) {
    const f = fakeDb({ stacks: [legacy("d1", "Tagged")], tags: [{ stack_id: "d1", tag: "Late night" }] }, { [step]: how });
    const r = await adoptLegacyDrafts(f.client, ME);
    const kept = r.kept.includes("d1") && f.db.stacks.length === 1 && f.db.stacks[0].title === "Tagged";
    const noTaglessCopy = !f.db.drafts.some((d) => d.id === "d1" && d.content.tags.length !== 1);
    check(`${n}${how === "throw" ? "b" : "a"}. When ${label}${how === "throw" ? " (with a network error)" : ""}, the original stays, and no copy without its tags is made`, kept && noTaglessCopy, `calls: ${f.calls.join(", ")}`);
    // Retry with nothing failing: the move finishes, with the tags.
    const again = fakeDb({ stacks: f.db.stacks, tags: f.db.stack_tags, drafts: f.db.drafts });
    const r2 = await adoptLegacyDrafts(again.client, ME);
    const copy = again.db.drafts.find((d) => d.id === "d1");
    check(`${n}${how === "throw" ? "b" : "a"}. Retried: moved, with its tag, and the original removed`, r2.moved.includes("d1") && copy?.content.tags.join() === "Late night" && again.db.stacks.length === 0);
  }
}

// 6. Interrupted after the copy, then edited in the new app: a retry keeps the newer edits and removes the original.
{
  const f = fakeDb({
    stacks: [legacy("d1", "Old title")],
    tags: [{ stack_id: "d1", tag: "Late night" }],
    drafts: [{ id: "d1", owner_id: ME, content: { v: 1, title: "Newer title, edited in the new app", tags: ["Late night", "Brunch"] }, step: "review" }],
  });
  const r = await adoptLegacyDrafts(f.client, ME);
  const copy = f.db.drafts.find((d) => d.id === "d1");
  check("6. Interrupted after copying and since edited: a retry keeps the newer edits (title, tags, step) and removes the original",
    r.moved.includes("d1") && copy.content.title === "Newer title, edited in the new app" && copy.content.tags.join() === "Late night,Brunch" && copy.step === "review" && f.db.stacks.length === 0,
    JSON.stringify(copy.content));
}

// 7. Listing the old drafts fails: nothing is touched.
{
  const f = fakeDb({ stacks: [legacy("d1", "Tagged")] }, { "stacks.select": true });
  const r = await adoptLegacyDrafts(f.client, ME);
  check("7. If listing fails, nothing is copied or removed", r.moved.length === 0 && f.db.stacks.length === 1 && f.db.drafts.length === 0 && !f.calls.includes("stacks.delete"));
}

// 8. One draft failing doesn't stop the others.
{
  const f = fakeDb({ stacks: [legacy("d1", "First"), legacy("d2", "Second")], tags: [{ stack_id: "d2", tag: "New" }] });
  const real = f.client.from.bind(f.client);
  let tagReads = 0;
  f.client.from = (t) => {
    const c = real(t);
    if (t !== "stack_tags") return c;
    const then = c.then;
    c.then = (ok, fail) => (++tagReads === 1 ? Promise.resolve({ data: null, error: { message: "boom" } }).then(ok, fail) : then(ok, fail));
    return c;
  };
  const r = await adoptLegacyDrafts(f.client, ME);
  check("8. A failure on one draft keeps it, and the next draft still moves", r.kept.includes("d1") && r.moved.includes("d2") && f.db.stacks.map((s) => s.id).join() === "d1");
}

console.log(fails ? `\n${fails} recovery checks failed` : "\nall recovery checks passed");
process.exit(fails ? 1 : 0);
