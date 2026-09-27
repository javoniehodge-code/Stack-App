import type { SupabaseClient } from "@supabase/supabase-js";
import type { Author, FeedItem, MyRepost, Profile, Stack, StackRow } from "./types";

// Shared by server pages and client components; pass whichever client applies.

// `*` so newer columns (e.g. description) come through once their migration
// runs, without breaking reads before it does.
const STACK_COLUMNS = "*,author:profiles!author_id(id,handle,name)";
// `*` picks up parent_id once the comment_replies migration has run.
const COMMENTS = "comments(*,author:profiles!author_id(handle))";
export const STACK_SELECT = STACK_COLUMNS;
export const STACK_WITH_COMMENTS = `${STACK_COLUMNS},${COMMENTS}`;

export const PROFILE_SELECT = "id,handle,name,bio,socials,pinned_stack_id,pin_note,featured_link_label,featured_link_url";
const PROFILE_BASICS = "id,handle,name,bio";
const PROFILE_DEFAULTS = { socials: {}, pinned_stack_id: null, pin_note: "", featured_link_label: null, featured_link_url: null };

/**
 * One profile by id or handle. Falls back to the basic columns when the
 * profile_featured migration hasn't been applied yet, so sign-in keeps working.
 */
export async function fetchProfile(sb: SupabaseClient, column: "id" | "handle", value: string) {
  const full = await sb.from("profiles").select(PROFILE_SELECT).eq(column, value).maybeSingle();
  if (!full.error) return full.data as Profile | null;
  const basic = await sb.from("profiles").select(PROFILE_BASICS).eq(column, value).maybeSingle();
  return basic.data ? ({ ...PROFILE_DEFAULTS, ...basic.data } as Profile) : null;
}

export const PAGE_SIZE = 12;

function orderComments(rows: StackRow[]) {
  for (const r of rows) r.comments?.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return rows;
}

/** Adds the viewer's liked/saved flags to stack rows. */
export async function withViewerState(sb: SupabaseClient, viewerId: string | null, rows: StackRow[]): Promise<Stack[]> {
  orderComments(rows);
  if (!viewerId || rows.length === 0) return rows.map((r) => ({ ...r, liked: false, saved: false, reposted: false }));
  const ids = rows.map((r) => r.id);
  const [likes, saves, reposts] = await Promise.all([
    sb.from("likes").select("stack_id").eq("user_id", viewerId).in("stack_id", ids),
    sb.from("saves").select("stack_id").eq("user_id", viewerId).in("stack_id", ids),
    // "*" so this still works before the reposts migration adds the note column.
    sb.from("reposts").select("*").eq("user_id", viewerId).in("stack_id", ids),
  ]);
  const liked = new Set((likes.data ?? []).map((r) => r.stack_id as string));
  const saved = new Set((saves.data ?? []).map((r) => r.stack_id as string));
  const reposted = new Map((reposts.data ?? []).map((r) => [r.stack_id as string, (r.note as string | undefined) ?? ""]));
  return rows.map((r) => ({ ...r, liked: liked.has(r.id), saved: saved.has(r.id), reposted: reposted.has(r.id), repost_note: reposted.get(r.id) ?? "" }));
}

export async function fetchFeed(sb: SupabaseClient, viewerId: string | null, opts: { page: number; following: boolean }): Promise<FeedItem[]> {
  if (opts.following && viewerId) {
    const items = await fetchFollowingFeed(sb, viewerId, opts.page);
    if (items) return items;
  }
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

type FeedRow = { stack_id: string; activity_at: string; reposter_id: string | null; note: string };

/**
 * Stacks and reposts from people the viewer follows, one entry per stack at its
 * latest activity. Null before the reposts migration adds following_feed.
 */
async function fetchFollowingFeed(sb: SupabaseClient, viewerId: string, page: number): Promise<FeedItem[] | null> {
  const { data, error } = await sb.rpc("following_feed", { p_offset: page * PAGE_SIZE, p_limit: PAGE_SIZE });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw error;
  }
  const rows = (data ?? []) as FeedRow[];
  if (rows.length === 0) return [];
  const reposterIds = [...new Set(rows.flatMap((r) => (r.reposter_id ? [r.reposter_id] : [])))];
  const [stacks, people] = await Promise.all([
    sb.from("stacks").select(STACK_WITH_COMMENTS).in("id", rows.map((r) => r.stack_id)).eq("status", "published"),
    reposterIds.length ? sb.from("profiles").select("id,handle,name").in("id", reposterIds) : Promise.resolve({ data: [] as Author[], error: null }),
  ]);
  if (stacks.error) throw stacks.error;
  const withState = await withViewerState(sb, viewerId, (stacks.data ?? []) as unknown as StackRow[]);
  const byId = new Map(withState.map((s) => [s.id, s]));
  const who = new Map(((people.data ?? []) as Author[]).map((p) => [p.id, p]));
  return rows.flatMap((r) => {
    const st = byId.get(r.stack_id);
    if (!st) return [];
    const by = r.reposter_id ? who.get(r.reposter_id) : undefined;
    return [by ? { ...st, repost: { by, note: r.note ?? "" } } : st];
  });
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
  return fetchProfile(sb, "handle", handle.toLowerCase());
}

export async function fetchFollowCounts(sb: SupabaseClient, userId: string) {
  const [followers, following] = await Promise.all([
    sb.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", userId),
    sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
  ]);
  return { followers: followers.count ?? 0, following: following.count ?? 0 };
}

export type FollowPerson = { id: string; handle: string; name: string; bio: string };

/** Who follows `userId` ("followers") or whom they follow ("following"), newest first. */
export async function fetchFollowList(sb: SupabaseClient, userId: string, kind: "followers" | "following") {
  const [match, person] =
    kind === "followers" ? ["followee_id", "profiles!follows_follower_id_fkey"] : ["follower_id", "profiles!follows_followee_id_fkey"];
  const { data } = await sb
    .from("follows")
    .select(`created_at, person:${person}(id,handle,name,bio)`)
    .eq(match, userId)
    .order("created_at", { ascending: false })
    .limit(500);
  return ((data ?? []) as unknown as { person: FollowPerson | null }[]).map((r) => r.person).filter((x): x is FollowPerson => !!x);
}

export async function fetchAuthorStacks(sb: SupabaseClient, viewerId: string | null, authorId: string) {
  const query = () => sb.from("stacks").select(STACK_SELECT).eq("author_id", authorId).eq("status", "published");
  const ordered = await query()
    .order("profile_position", { ascending: true, nullsFirst: true })
    .order("published_at", { ascending: false });
  // Before the profile_featured migration there is no profile_position column.
  const { data } = ordered.error ? await query().order("published_at", { ascending: false }) : ordered;
  return withViewerState(sb, viewerId, (data ?? []) as unknown as StackRow[]);
}

async function repostRows(sb: SupabaseClient, userId: string) {
  // "*" so this still works before the reposts migration adds the note column.
  const { data } = await sb.from("reposts").select(`*, stack:stacks(${STACK_SELECT})`).eq("user_id", userId).order("created_at", { ascending: false });
  return ((data ?? []) as unknown as { note?: string; stack: StackRow | null }[]).filter((r): r is { note?: string; stack: StackRow } => !!r.stack);
}

export async function fetchReposts(sb: SupabaseClient, viewerId: string | null, userId: string) {
  const rows = await repostRows(sb, userId);
  return withViewerState(sb, viewerId, rows.map((r) => r.stack));
}

/** Your own reposts, newest first, with the notes you added. */
export async function fetchMyReposts(sb: SupabaseClient, viewerId: string): Promise<MyRepost[]> {
  const rows = await repostRows(sb, viewerId);
  const stacks = await withViewerState(sb, viewerId, rows.map((r) => r.stack));
  return stacks.map((stack, i) => ({ stack, note: rows[i].note ?? "" }));
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
