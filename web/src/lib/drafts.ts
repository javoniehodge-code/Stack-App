import type { SupabaseClient } from "@supabase/supabase-js";
import { lineFormat } from "./format";
import { adoptLegacyDrafts } from "./legacyDrafts";
import type { Draft, EditTarget, Section, Visibility } from "./types";

// Drafts live in their own owner-only table (migration 20261128000000_drafts). Their content is loose JSON in the
// shape the editor saves: what publish_draft() and apply_stack_edit() take, so a draft can be incomplete or over
// a limit until it's published.

export type DraftStep = "title" | "description" | "build" | "review";
export const DRAFT_STEPS: DraftStep[] = ["title", "description", "build", "review"];

/** What a drafts row's `content` holds. Every field may be missing in an older or partial draft. */
export type DraftContent = {
  v?: number;
  title?: string;
  description?: string;
  sections?: Section[];
  tags?: string[];
  style?: Draft["style"];
  visibility?: Visibility;
  location?: string;
};

export type DraftRecord = {
  id: string;
  content: DraftContent;
  step: DraftStep;
  edit_of: string | null;
  base_version: string | null;
  remixed_from: string | null;
  updated_at: string;
};

/** A draft as the Drafts lists show it. */
export type DraftSummary = { id: string; title: string; lineCount: number; editOf: string | null; visibility: Visibility; updatedAt: string };

export const blankDraft = (): Draft => ({
  id: null,
  title: "",
  description: "",
  sections: [{ label: "", lines: [] }],
  tags: [],
  style: "numbered",
  forkedFromId: null,
  visibility: "public",
  location: "",
});

const asArray = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const asString = (v: unknown) => (typeof v === "string" ? v : "");
const asVisibility = (v: unknown): Visibility => (v === "unlisted" || v === "private" ? v : "public");

/** Sections as stored (a stack's or a draft's) → the editor's. Lines saved before formats take the stack's style. */
export function toDraftSections(sections: unknown, style: Draft["style"]): Draft["sections"] {
  return asArray<Section>(sections).map((sec) => ({
    label: asString(sec?.label),
    lines: asArray<Section["lines"][number]>(sec?.lines).map((l) => ({
      text: asString(l?.text),
      link: asString(l?.link),
      note: asString(l?.note),
      format: lineFormat({ format: l?.format }, style),
      linkName: asString(l?.linkName),
      linkNames: l?.linkNames && typeof l.linkNames === "object" ? l.linkNames : {},
      ...(typeof l?.id === "string" ? { id: l.id } : {}),
      tags: asArray<unknown>(l?.tags).filter((t): t is string => typeof t === "string"),
      ...(() => {
        const urls = asArray<unknown>((l as { legacyUrls?: unknown })?.legacyUrls).filter((u): u is string => typeof u === "string");
        return urls.length ? { legacyUrls: urls } : {};
      })(),
    })),
  }));
}

/** A published stack's row → the editor's starting point (for editing it). */
export function stackToDraft(
  d: { title: string; description?: string; sections: Section[]; style: Draft["style"]; forked_from_id: string | null; visibility?: Visibility; location?: string },
  tags: string[],
): Draft {
  const sections = toDraftSections(d.sections, d.style);
  return {
    id: null,
    title: d.title,
    description: d.description ?? "",
    sections: sections.length ? sections : blankDraft().sections,
    tags,
    style: d.style,
    forkedFromId: d.forked_from_id,
    visibility: d.visibility ?? "public",
    location: d.location ?? "",
  };
}

/** A drafts row → the editor's starting point. */
export function recordToDraft(r: DraftRecord): Draft {
  const c = r.content ?? {};
  const style = c.style === "bulleted" ? "bulleted" : "numbered";
  const sections = toDraftSections(c.sections, style);
  return {
    id: r.id,
    title: asString(c.title),
    description: asString(c.description),
    sections: sections.length ? sections : blankDraft().sections,
    tags: asArray<unknown>(c.tags).filter((t): t is string => typeof t === "string"),
    style,
    forkedFromId: r.remixed_from,
    visibility: asVisibility(c.visibility),
    location: asString(c.location),
  };
}

/** Lines with text or a link, as the Drafts lists count them. */
function lineCount(c: DraftContent) {
  return asArray<Section>(c.sections).reduce(
    (n, sec) => n + asArray<Section["lines"][number]>(sec?.lines).filter((l) => asString(l?.text).trim() || asString(l?.note).trim() || asString(l?.link) || asArray(l?.tags).length).length,
    0,
  );
}

export async function fetchDrafts(sb: SupabaseClient, viewerId: string): Promise<DraftSummary[]> {
  await adoptLegacyDrafts(sb, viewerId);
  const { data } = await sb
    .from("drafts")
    .select("id, content, edit_of, updated_at")
    .eq("owner_id", viewerId)
    .order("updated_at", { ascending: false });
  return (data ?? []).map((r) => {
    const c = (r.content ?? {}) as DraftContent;
    return { id: r.id, title: asString(c.title), lineCount: lineCount(c), editOf: r.edit_of, visibility: asVisibility(c.visibility), updatedAt: r.updated_at };
  });
}

export async function fetchDraft(sb: SupabaseClient, viewerId: string, id: string): Promise<DraftRecord | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  await adoptLegacyDrafts(sb, viewerId);
  const { data } = await sb
    .from("drafts")
    .select("id, content, step, edit_of, base_version, remixed_from, updated_at")
    .eq("id", id)
    .eq("owner_id", viewerId)
    .maybeSingle();
  return (data as DraftRecord | null) ?? null;
}

/** Your unsaved edits to published stack `stackId`, if any. */
export async function fetchEditDraft(sb: SupabaseClient, viewerId: string, stackId: string): Promise<DraftRecord | null> {
  await adoptLegacyDrafts(sb, viewerId);
  const { data } = await sb
    .from("drafts")
    .select("id, content, step, edit_of, base_version, remixed_from, updated_at")
    .eq("edit_of", stackId)
    .eq("owner_id", viewerId)
    .maybeSingle();
  return (data as DraftRecord | null) ?? null;
}

export const deleteDraft = (sb: SupabaseClient, id: string) => sb.from("drafts").delete().eq("id", id);

/** One of your published stacks, for editing; null if it isn't yours or isn't published. */
export async function fetchEditTarget(sb: SupabaseClient, viewerId: string, id: string): Promise<{ target: EditTarget; live: Draft } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [{ data }, { data: tags }] = await Promise.all([
    sb.from("stacks").select("*").eq("id", id).eq("author_id", viewerId).eq("status", "published").maybeSingle(),
    sb.from("stack_tags").select("tag").eq("stack_id", id),
  ]);
  if (!data) return null;
  const live = stackToDraft(data, (tags ?? []).map((t) => t.tag as string));
  return {
    target: {
      stackId: data.id,
      visibility: data.visibility ?? "public",
      sharedAt: data.shared_at ?? null,
      baseVersion: data.updated_at ?? null,
      live: { title: live.title, description: live.description, sections: live.sections },
    },
    live,
  };
}
