import type { SupabaseClient } from "@supabase/supabase-js";

// Drafts that an older app version saved in the stacks table (status 'draft'), moved into the drafts table.
// Between the drafts migration and the new app's deployment the old app still saves drafts there; this makes them
// show up and open in the new app. No imports beyond types, so the retry checks can load it on its own
// (web/e2e/legacy-adopt.test.mjs).
//
// Safe to repeat, and never loses anything:
// * A copy is only ever added, never written over. If the draft is already in the drafts table (an earlier run
//   copied it, and it may have been edited since), that copy is kept as it is.
// * The original is removed only once every part of it was read (the draft and its tags), the copy is confirmed
//   to be there, and nothing failed on the way. Otherwise it stays in the stacks table for the next try.

type LegacyRow = {
  id: string;
  title: string | null;
  description: string | null;
  sections: unknown;
  style: string | null;
  visibility: string | null;
  location: string | null;
  edit_of: string | null;
  forked_from_id: string | null;
  created_at: string;
};

export type AdoptResult = { moved: string[]; kept: string[] };

export async function adoptLegacyDrafts(sb: SupabaseClient, viewerId: string): Promise<AdoptResult> {
  const out: AdoptResult = { moved: [], kept: [] };
  const { data: rows, error } = await sb
    .from("stacks")
    .select("id, title, description, sections, style, visibility, location, edit_of, forked_from_id, created_at")
    .eq("author_id", viewerId)
    .eq("status", "draft");
  if (error || !Array.isArray(rows)) return out;
  for (const r of rows as LegacyRow[]) {
    try {
      if (await adoptOne(sb, viewerId, r)) out.moved.push(r.id);
      else out.kept.push(r.id);
    } catch {
      out.kept.push(r.id);
    }
  }
  return out;
}

/** True once the draft is safely in the drafts table and its original removed; false if anything failed. */
async function adoptOne(sb: SupabaseClient, viewerId: string, r: LegacyRow): Promise<boolean> {
  const { data: tags, error: tagsError } = await sb.from("stack_tags").select("tag").eq("stack_id", r.id);
  if (tagsError || !Array.isArray(tags)) return false;
  const content = {
    v: 1,
    title: r.title ?? "",
    description: r.description ?? "",
    sections: Array.isArray(r.sections) ? r.sections : [],
    style: r.style === "bulleted" ? "bulleted" : "numbered",
    visibility: r.visibility === "unlisted" || r.visibility === "private" ? r.visibility : "public",
    location: r.location ?? "",
    tags: tags.map((t: { tag: string }) => t.tag),
  };
  // Adds the copy only if there isn't one yet: an existing copy may have newer edits.
  const { error: copyError } = await sb
    .from("drafts")
    .upsert(
      { id: r.id, content, step: "build", edit_of: r.edit_of, remixed_from: r.forked_from_id, created_at: r.created_at },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (copyError) return false;
  const { data: copy, error: checkError } = await sb.from("drafts").select("id").eq("id", r.id).maybeSingle();
  if (checkError || !copy) return false;
  const { error: removeError } = await sb.from("stacks").delete().eq("id", r.id).eq("author_id", viewerId).eq("status", "draft");
  return !removeError;
}
