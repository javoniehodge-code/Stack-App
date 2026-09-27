import type { SupabaseClient } from "@supabase/supabase-js";

export type BlockedAccount = { id: string; handle: string; name: string };

/** Before the blocks migration runs the table and my_blocks() don't exist. */
const missing = (code?: string) => code === "42P01" || code === "PGRST205" || code === "PGRST202" || code === "42883";

/** Returns an error message, or null when it worked. */
export async function blockUser(sb: SupabaseClient, userId: string) {
  const { error } = await sb.from("blocks").insert({ blocked_id: userId });
  if (!error || error.code === "23505") return null;
  return missing(error.code) ? "Blocking isn't available yet." : "Couldn't block this account. Try again.";
}

export async function unblockUser(sb: SupabaseClient, userId: string) {
  const { error } = await sb.from("blocks").delete().eq("blocked_id", userId);
  return error ? "Couldn't unblock. Try again." : null;
}

/** People you've blocked, newest first. Their profiles are hidden from you, so this goes through my_blocks(). */
export async function fetchMyBlocks(sb: SupabaseClient): Promise<BlockedAccount[]> {
  const { data, error } = await sb.rpc("my_blocks");
  if (error) return [];
  return (data ?? []) as BlockedAccount[];
}
