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
});

const toDraftSections = (sections: Section[]) =>
  sections.map((sec) => ({ label: sec.label ?? "", lines: sec.lines.map((l) => ({ text: l.text, link: l.link ?? "" })) }));

export default async function CreatePage({ searchParams }: PageProps<"/create">) {
  const { fork, draft } = await searchParams;
  const sb = await createClient();
  let initial = blank();

  if (typeof fork === "string") {
    const { data } = await sb.rpc("fork_template", { p_id: fork });
    const t = data as { id: string; title: string; description?: string; sections: Section[]; tags: string[]; style: Draft["style"] } | null;
    if (t) {
      initial = { id: null, title: `${t.title} (remix)`.slice(0, 120), description: t.description ?? "", sections: toDraftSections(t.sections), tags: t.tags, style: t.style, forkedFromId: t.id };
    }
  } else if (typeof draft === "string") {
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
        };
      }
    }
  }

  const key = typeof fork === "string" ? `fork-${fork}` : typeof draft === "string" ? `draft-${draft}` : "new";
  return <CreateScreen key={key} initial={initial} />;
}
