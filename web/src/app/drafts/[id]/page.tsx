import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { blankDraft, fetchDraft, recordToDraft } from "@/lib/drafts";
import { createClient, getViewerId } from "@/lib/supabase/server";
import CreateScreen from "../../create/CreateScreen";

export const metadata: Metadata = { title: "Draft" };

/** One of your drafts, reopened at the step it reached. Edits to a published stack open as that stack's edit. */
export default async function DraftPage({ params }: PageProps<"/drafts/[id]">) {
  const { id } = await params;
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  // Signed out: the editor's own sign-in prompt.
  if (!viewerId) return <CreateScreen key="signed-out" initial={blankDraft()} start="title" />;
  const draft = await fetchDraft(sb, viewerId, id);
  if (!draft) notFound();
  if (draft.edit_of) redirect(`/create?edit=${draft.edit_of}`);
  return <CreateScreen key={`draft-${draft.id}`} initial={recordToDraft(draft)} start={draft.step} />;
}
