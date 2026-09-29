import type { Metadata } from "next";
import { createClient, getViewerId } from "@/lib/supabase/server";
import type { Draft, Section } from "@/lib/types";
import CreateScreen from "./CreateScreen";

export const metadata: Metadata = { title: "New Stack" };

const blank = (): Draft => ({
  id: null,
  title: "",
  description: "",
  sections: [{ label: "", lines: [{ text: "", link: "" }] }],
  tags: [],
  style: "numbered",
  forkedFromId: null,
  visibility: "public",
  location: "",
});

const toDraftSections = (sections: Section[]) =>
  sections.map((sec) => ({ label: sec.label ?? "", lines: sec.lines.map((l) => ({ text: l.text, link: l.link ?? "", note: l.note ?? "" })) }));

export default async function CreatePage({ searchParams }: PageProps<"/create">) {
  const { draft } = await searchParams;
  const sb = await createClient();
  let initial = blank();

  if (typeof draft === "string") {
    const viewerId = await getViewerId(sb);
    if (viewerId) {
      const [{ data: d }, { data: tags }] = await Promise.all([
        sb.from("stacks").select("*").eq("id", draft).eq("author_id", viewerId).eq("status", "draft").maybeSingle(),
        sb.from("stack_tags").select("tag").eq("stack_id", draft),
      ]);
      if (d) {
        const sections = toDraftSections(d.sections as Section[]);
        initial = {
          id: d.id,
          title: d.title,
          description: d.description ?? "",
          sections: sections.length ? sections : blank().sections,
          tags: (tags ?? []).map((t) => t.tag as string),
          style: d.style,
          forkedFromId: d.forked_from_id,
          visibility: d.visibility ?? "public",
          location: d.location ?? "",
        };
      }
    }
  }

  const key = typeof draft === "string" ? `draft-${draft}` : "new";
  // Saved drafts open on the Build step; a new stack starts at the title.
  const start = initial.id ? "build" : "title";
  return <CreateScreen key={key} initial={initial} start={start} />;
}
