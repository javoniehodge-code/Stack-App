import FeedScreen from "./FeedScreen";
import { fetchFeed, fetchFollowing } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";

export default async function FeedPage() {
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  const [stacks, following] = await Promise.all([fetchFeed(sb, viewerId, { page: 0, following: false }), fetchFollowing(sb, viewerId)]);
  return <FeedScreen initial={stacks} following={following} />;
}
