import type { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, Stack, StackRow } from "./types";

// Shared by server pages and client components; pass whichever client applies.

const STACK_COLUMNS =
  "id,title,sections,style,status,forked_from_id,line_count,likes_count,saves_count,forks_count,comments_count,created_at,published_at,author:profiles!author_id(id,handle,name)";
const COMMENTS = "comments(id,body,created_at,author:profiles!author_id(handle))";
export const STACK_SELECT = STACK_COLUMNS;
export const STACK_WITH_COMMENTS = `${STACK_COLUMNS},${COMMENTS}`;

export const PROFILE_SELECT = "id,handle,name,bio,socials,pinned_stack_id,pin_note,featured_link_label,featured_link_url";

export const PAGE_SIZE = 12;

function orderComments(rows: StackRow[]) {
  for (const r of rows) r.comments?.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return rows;
}

/** Adds the viewer's liked/saved flags to stack rows. */
export async function withViewerState(sb: SupabaseClient, viewerId: string | null, rows: StackRow[]): Promise<Stack[]> {
  orderComments(rows);
  if (!viewerId || rows.length === 0) return rows.map((r) => ({ ...r, liked: false, saved: false }));
  const ids = rows.map((r) => r.id);
  const [likes, saves] = await Promise.all([
    sb.from("likes").select("stack_id").eq("user_id", viewerId).in("stack_id", ids),
    sb.from("saves").select("stack_id").eq("user_id", viewerId).in("stack_id", ids),
  ]);
  const liked = new Set((likes.data ?? []).map((r) => r.stack_id as string));
  const saved = new Set((saves.data ?? []).map((r) => r.stack_id as string));
  return rows.map((r) => ({ ...r, liked: liked.has(r.id), saved: saved.has(r.id) }));
}

export async function fetchFeed(sb: SupabaseClient, viewerId: string | null, opts: { page: number; following: boolean }) {
  let q = sb.from("stacks").select(STACK_WITH_COMMENTS).eq("status", "published");
  if (opts.following) {
    if (!viewerId) return [];
    const { data: f } = await sb.from("follows").select("followee_id").eq("follower_id", viewerId);
    const ids = (f ?? []).map((r) => r.followee_id as string);
    if (ids.length === 0) return [];
    q = q.in("author_id", ids);
  }
  const from = opts.page * PAGE_SIZE;
  const { data, error } = await q.order("published_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return withViewerState(sb, viewerId, (data ?? []) as unknown as StackRow[]);
}

export async function fetchStack(sb: SupabaseClient, viewerId: string | null, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await sb.from("stacks").select(STACK_WITH_COMMENTS).eq("id", id).eq("status", "published").maybeSingle();
  if (!data) return null;
  const [s] = await withViewerState(sb, viewerId, [data as unknown as StackRow]);
  return s;
}

export async function fetchFollowing(sb: SupabaseClient, viewerId: string | null) {
  if (!viewerId) return [] as string[];
  const { data } = await sb.from("follows").select("followee_id").eq("follower_id", viewerId);
  return (data ?? []).map((r) => r.followee_id as string);
}

export async function fetchProfileByHandle(sb: SupabaseClient, handle: string) {
  const { data } = await sb.from("profiles").select(PROFILE_SELECT).eq("handle", handle.toLowerCase()).maybeSingle();
  return data as Profile | null;
}

export async function fetchFollowCounts(sb: SupabaseClient, userId: string) {
  const [followers, following] = await Promise.all([
    sb.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", userId),
    sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
  ]);
  return { followers: followers.count ?? 0, following: following.count ?? 0 };
}

export async function fetchAuthorStacks(sb: SupabaseClient, viewerId: string | null, authorId: string) {
  const { data } = await sb
    .from("stacks")
    .select(STACK_SELECT)
    .eq("author_id", authorId)
    .eq("status", "published")
    .order("profile_position", { ascending: true, nullsFirst: true })
    .order("published_at", { ascending: false });
  return withViewerState(sb, viewerId, (data ?? []) as unknown as StackRow[]);
}

export async function fetchReposts(sb: SupabaseClient, viewerId: string | null, userId: string) {
  const { data } = await sb
    .from("reposts")
    .select(`created_at, stack:stacks(${STACK_SELECT})`)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const rows = (data ?? []).map((r) => (r as unknown as { stack: StackRow | null }).stack).filter((s): s is StackRow => !!s);
  return withViewerState(sb, viewerId, rows);
}

export async function fetchSaved(sb: SupabaseClient, viewerId: string) {
  const { data } = await sb
    .from("saves")
    .select(`created_at, stack:stacks(${STACK_SELECT})`)
    .eq("user_id", viewerId)
    .order("created_at", { ascending: false });
  const rows = (data ?? []).map((r) => (r as unknown as { stack: StackRow | null }).stack).filter((s): s is StackRow => !!s);
  return withViewerState(sb, viewerId, rows);
}

export async function fetchDrafts(sb: SupabaseClient, viewerId: string) {
  const { data } = await sb
    .from("stacks")
    .select(STACK_SELECT)
    .eq("author_id", viewerId)
    .eq("status", "draft")
    .order("updated_at", { ascending: false });
  return (data ?? []) as unknown as StackRow[];
}

export async function searchStacks(sb: SupabaseClient, viewerId: string | null, q: string) {
  const { data, error } = await sb.rpc("search_stacks", { q }).select(STACK_SELECT);
  if (error) throw error;
  return withViewerState(sb, viewerId, (data ?? []) as unknown as StackRow[]);
}

export async function fetchCategoriesFor(sb: SupabaseClient, ids: string[], cats: string[]) {
  if (ids.length === 0) return {} as Record<string, string>;
  const { data } = await sb.rpc("stack_categories", { ids, cats });
  const out: Record<string, string> = {};
  for (const r of (data ?? []) as { stack_id: string; category: string }[]) out[r.stack_id] = r.category;
  return out;
}
