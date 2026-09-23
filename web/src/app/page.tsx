import FeedScreen from "./FeedScreen";
import { fetchFeed } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";

export default async function FeedPage() {
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  const stacks = await fetchFeed(sb, viewerId, { page: 0, following: false });
  return <FeedScreen initial={stacks} />;
}
