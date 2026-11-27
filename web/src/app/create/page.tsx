import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { editDraftToDraft, fetchEditDraft, fetchEditTarget } from "@/lib/drafts";
import { createClient, getViewerId } from "@/lib/supabase/server";
import CreateScreen from "./CreateScreen";

export const metadata: Metadata = { title: "Edit Stack" };

/**
 * ?edit=<id> edits one of your published stacks. Unsaved edits live in a draft that points at the stack
 * (edit_of); opening the stack again reopens them. A new stack is /new and a draft is /drafts/<id>; older
 * /create and /create?draft=<id> links go there.
 */
export default async function CreatePage({ searchParams }: PageProps<"/create">) {
  const { draft, edit } = await searchParams;
  if (typeof draft === "string") redirect(`/drafts/${encodeURIComponent(draft)}`);
  if (typeof edit !== "string") redirect("/new");
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  const found = viewerId ? await fetchEditTarget(sb, viewerId, edit) : null;
  if (!viewerId || !found) redirect("/new");
  // Pick up edits saved earlier, if any; otherwise start from the stack as it is.
  const pending = await fetchEditDraft(sb, viewerId, found.target.stackId);
  const initial = pending ? editDraftToDraft(pending, found.live) : found.live;
  const target = pending?.base_version ? { ...found.target, baseVersion: pending.base_version } : found.target;
  return <CreateScreen key={`edit-${target.stackId}`} initial={initial} start="build" edit={target} />;
}
