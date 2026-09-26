import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchFollowList, fetchFollowing, fetchProfileByHandle } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";
import FollowListScreen from "./FollowListScreen";

const clean = (h: string) => decodeURIComponent(h).replace(/^@/, "");
const isKind = (x: string): x is "followers" | "following" => x === "followers" || x === "following";

export async function generateMetadata({ params }: PageProps<"/u/[handle]/[list]">): Promise<Metadata> {
  const { handle, list } = await params;
  return { title: `${list === "following" ? "Following" : "Followers"} · @${clean(handle)}` };
}

export default async function FollowListPage({ params }: PageProps<"/u/[handle]/[list]">) {
  const { handle, list } = await params;
  if (!isKind(list)) notFound();
  const sb = await createClient();
  const profile = await fetchProfileByHandle(sb, clean(handle));
  if (!profile) notFound();
  const viewerId = await getViewerId(sb);
  const [people, following] = await Promise.all([fetchFollowList(sb, profile.id, list), fetchFollowing(sb, viewerId)]);
  return <FollowListScreen key={`${profile.id}-${list}`} profile={profile} kind={list} people={people} following={following} />;
}
