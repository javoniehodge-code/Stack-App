import type { Metadata } from "next";
import { fetchAuthorStacks, fetchDrafts } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";
import ManageScreen, { type Filter } from "./ManageScreen";

const FILTERS: Filter[] = ["all", "public", "unlisted", "private", "drafts"];

export const metadata: Metadata = { title: "Manage stacks" };

export default async function ManageStacksPage({ searchParams }: PageProps<"/settings/stacks">) {
  const { filter } = await searchParams;
  const initialFilter = FILTERS.find((f) => f === filter) ?? "all";
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  if (!viewerId) return <ManageScreen data={null} />;
  const [stacks, drafts] = await Promise.all([fetchAuthorStacks(sb, viewerId, viewerId), fetchDrafts(sb, viewerId)]);
  return <ManageScreen key={`${viewerId}-${initialFilter}`} data={{ stacks, drafts }} initialFilter={initialFilter} />;
}
