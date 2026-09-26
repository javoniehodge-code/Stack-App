import type { SupabaseClient } from "@supabase/supabase-js";
import type { Comment } from "./types";

/** An @handle not preceded by a letter/digit (so emails don't match). Mirrors the database trigger. */
export const MENTION_RE = /(^|[^a-zA-Z0-9._])@([a-zA-Z0-9._]{2,30})/g;

/** Top-level comments in order, each followed by its replies. Replies whose parent is gone become top-level. */
export function thread(comments: Comment[]) {
  const ids = new Set(comments.map((c) => c.id));
  const replies = new Map<string, Comment[]>();
  const top: Comment[] = [];
  for (const c of comments) {
    if (c.parent_id && ids.has(c.parent_id)) replies.set(c.parent_id, [...(replies.get(c.parent_id) ?? []), c]);
    else top.push(c);
  }
  return top.flatMap((c) => [{ comment: c, isReply: false }, ...(replies.get(c.id) ?? []).map((r) => ({ comment: r, isReply: true }))]);
}

/** The top-level comment a reply to `c` should attach to (threads are one level deep). */
export const threadRoot = (c: Comment) => c.parent_id ?? c.id;

/**
 * Inserts a comment (optionally a reply) and returns it. Before the
 * comment_replies migration runs there is no parent_id column, so the reply is
 * posted as a plain comment instead.
 */
export async function postComment(sb: SupabaseClient, stackId: string, body: string, parentId: string | null) {
  const insert = (row: Record<string, unknown>) => sb.from("comments").insert(row).select("*").single();
  let res = await insert(parentId ? { stack_id: stackId, body, parent_id: parentId } : { stack_id: stackId, body });
  if (res.error?.code === "PGRST204" && parentId) res = await insert({ stack_id: stackId, body });
  if (res.error || !res.data) return null;
  return res.data as Omit<Comment, "author">;
}
