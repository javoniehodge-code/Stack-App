import type { Metadata } from "next";
import { fetchAuthorStacks, fetchDrafts } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";
import ManageScreen from "./ManageScreen";

export const metadata: Metadata = { title: "Manage stacks" };

export default async function ManageStacksPage() {
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  if (!viewerId) return <ManageScreen data={null} />;
  const [stacks, drafts] = await Promise.all([fetchAuthorStacks(sb, viewerId, viewerId), fetchDrafts(sb, viewerId)]);
  return <ManageScreen key={viewerId} data={{ stacks, drafts }} />;
}
