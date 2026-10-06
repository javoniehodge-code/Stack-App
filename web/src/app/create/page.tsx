import type { Metadata } from "next";
import { createClient, getViewerId } from "@/lib/supabase/server";
import { lineFormat } from "@/lib/format";
import type { Draft, EditTarget, Section } from "@/lib/types";
import CreateScreen from "./CreateScreen";

export const metadata: Metadata = { title: "New Stack" };

const blank = (): Draft => ({
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

// Lines saved before formats existed take the stack's style (numbered or bulleted).
const toDraftSections = (sections: Section[], style: Draft["style"]) =>
  sections.map((sec) => ({
    label: sec.label ?? "",
    lines: sec.lines.map((l) => ({ text: l.text, link: l.link ?? "", note: l.note ?? "", format: lineFormat(l, style), bold: l.bold !== false })),
  }));

type Row = { id: string; title: string; description?: string; sections: Section[]; style: Draft["style"]; forked_from_id: string | null; visibility?: Draft["visibility"]; location?: string };

function toDraft(d: Row, id: string | null, tags: string[]): Draft {
  const sections = toDraftSections(d.sections, d.style);
  return {
    id,
    title: d.title,
    description: d.description ?? "",
    sections: sections.length ? sections : blank().sections,
    tags,
    style: d.style,
    forkedFromId: d.forked_from_id,
    visibility: d.visibility ?? "public",
    location: d.location ?? "",
  };
}

/**
 * /create starts a new stack, ?draft=id reopens a draft, and ?edit=id edits one of your published stacks.
 * Unsaved edits to a published stack live in a draft that points at it (edit_of); opening either reopens the edits.
 */
export default async function CreatePage({ searchParams }: PageProps<"/create">) {
  const { draft, edit } = await searchParams;
  const sb = await createClient();
  let initial = blank();
  let target: EditTarget | null = null;
  const viewerId = typeof draft === "string" || typeof edit === "string" ? await getViewerId(sb) : null;

  if (viewerId && typeof draft === "string") {
    const [{ data: d }, { data: tags }] = await Promise.all([
      sb.from("stacks").select("*").eq("id", draft).eq("author_id", viewerId).eq("status", "draft").maybeSingle(),
      sb.from("stack_tags").select("tag").eq("stack_id", draft),
    ]);
    if (d) initial = toDraft(d, d.id, (tags ?? []).map((t) => t.tag as string));
    if (d?.edit_of) target = await editTarget(sb, viewerId, d.edit_of);
  } else if (viewerId && typeof edit === "string" && /^[0-9a-f-]{36}$/i.test(edit)) {
    target = await editTarget(sb, viewerId, edit);
    if (target) {
      // Pick up edits saved earlier, if any; otherwise start from the stack as it is.
      const [{ data: pending }, { data: live }, { data: tags }] = await Promise.all([
        sb.from("stacks").select("*").eq("edit_of", edit).eq("author_id", viewerId).maybeSingle(),
        sb.from("stacks").select("*").eq("id", edit).maybeSingle(),
        sb.from("stack_tags").select("tag").eq("stack_id", edit),
      ]);
      const tagList = (tags ?? []).map((t) => t.tag as string);
      if (pending) initial = toDraft(pending, pending.id, tagList);
      else if (live) initial = toDraft(live, null, tagList);
    }
  }

  const key = target ? `edit-${target.stackId}` : typeof draft === "string" ? `draft-${draft}` : "new";
  // Saved drafts and edits open on the Build step; a new stack starts at the title.
  const start = initial.id || target ? "build" : "title";
  return <CreateScreen key={key} initial={initial} start={start} edit={target} />;
}

/** One of your published stacks, for editing. */
async function editTarget(sb: Awaited<ReturnType<typeof createClient>>, viewerId: string, id: string): Promise<EditTarget | null> {
  const { data } = await sb.from("stacks").select("*").eq("id", id).eq("author_id", viewerId).eq("status", "published").maybeSingle();
  if (!data) return null;
  const live = toDraft(data, null, []);
  return { stackId: data.id, visibility: data.visibility ?? "public", sharedAt: data.shared_at ?? null, live: { title: live.title, description: live.description, sections: live.sections } };
}
