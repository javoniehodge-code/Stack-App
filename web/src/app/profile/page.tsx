import type { Metadata } from "next";
import { fetchAuthorStacks, fetchDrafts, fetchFollowCounts, fetchSaved } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";
import ProfileScreen, { type ProfileTab } from "./ProfileScreen";

export const metadata: Metadata = { title: "Profile" };

const TABS: ProfileTab[] = ["mine", "saved", "forked", "drafts"];

export default async function ProfilePage({ searchParams }: PageProps<"/profile">) {
  const { tab } = await searchParams;
  const initialTab = TABS.includes(tab as ProfileTab) ? (tab as ProfileTab) : "mine";
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  if (!viewerId) return <ProfileScreen data={null} initialTab={initialTab} />;
  const [mine, saved, drafts, counts] = await Promise.all([
    fetchAuthorStacks(sb, viewerId, viewerId),
    fetchSaved(sb, viewerId),
    fetchDrafts(sb, viewerId),
    fetchFollowCounts(sb, viewerId),
  ]);
  return <ProfileScreen key={viewerId} data={{ mine, saved, drafts, counts }} initialTab={initialTab} />;
}
