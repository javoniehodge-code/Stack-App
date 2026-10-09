import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchAuthorStacks } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";
import PublicPreviewScreen from "./PublicPreviewScreen";

export const metadata: Metadata = { title: "Public profile preview" };

export default async function PublicPreviewPage() {
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  if (!viewerId) redirect("/profile");
  return <PublicPreviewScreen key={viewerId} stacks={await fetchAuthorStacks(sb, viewerId, viewerId)} />;
}
