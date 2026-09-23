import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { fetchAuthorStacks, fetchFollowCounts, fetchFollowing, fetchProfileByHandle, fetchReposts } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";
import UserScreen from "./UserScreen";

const clean = (h: string) => decodeURIComponent(h).replace(/^@/, "");

export async function generateMetadata({ params }: PageProps<"/u/[handle]">): Promise<Metadata> {
  const { handle } = await params;
  const profile = await fetchProfileByHandle(await createClient(), clean(handle));
  if (!profile) return { title: "Profile not found" };
  return { title: `${profile.name} (@${profile.handle})`, description: profile.bio || `Stacks by @${profile.handle}` };
}

export default async function UserPage({ params }: PageProps<"/u/[handle]">) {
  const { handle } = await params;
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  const profile = await fetchProfileByHandle(sb, clean(handle));
  if (!profile) notFound();
  if (profile.id === viewerId) redirect("/profile");
  const [stacks, reposts, counts, following] = await Promise.all([
    fetchAuthorStacks(sb, viewerId, profile.id),
    fetchReposts(sb, viewerId, profile.id),
    fetchFollowCounts(sb, profile.id),
    fetchFollowing(sb, viewerId),
  ]);
  return <UserScreen profile={profile} stacks={stacks} reposts={reposts} counts={counts} following={following.includes(profile.id)} />;
}
