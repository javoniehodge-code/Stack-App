import type { SupabaseClient } from "@supabase/supabase-js";

export type NotificationType = "comment" | "like" | "save" | "fork";

export type Notification = {
  id: string;
  type: NotificationType;
  created_at: string;
  read_at: string | null;
  stack_id: string | null;
  comment_id: string | null;
  fork_id: string | null;
  metadata: { stack_title?: string };
  /** Null when the person, stack, comment or fork has since been deleted. */
  actor: { handle: string; name: string } | null;
  stack: { id: string; title: string } | null;
  fork: { id: string; title: string } | null;
  comment: { id: string; body: string } | null;
};

export type Cursor = { created_at: string; id: string };

export const NOTIFICATIONS_PAGE = 30;

const SELECT =
  "id,type,created_at,read_at,stack_id,comment_id,fork_id,metadata," +
  "actor:profiles!notifications_actor_id_fkey(handle,name)," +
  "stack:stacks!notifications_stack_id_fkey(id,title)," +
  "fork:stacks!notifications_fork_id_fkey(id,title)," +
  "comment:comments!notifications_comment_id_fkey(id,body)";

/** Before the notifications migration runs the table doesn't exist; treat that as "no notifications". */
const missingTable = (code?: string) => code === "42P01" || code === "PGRST205";

/** One page, newest first. `before` is the last row of the previous page. */
export async function fetchNotifications(sb: SupabaseClient, opts: { type: NotificationType | null; before: Cursor | null }) {
  let q = sb.from("notifications").select(SELECT);
  if (opts.type) q = q.eq("type", opts.type);
  if (opts.before) {
    const at = `"${opts.before.created_at}"`;
    q = q.or(`created_at.lt.${at},and(created_at.eq.${at},id.lt.${opts.before.id})`);
  }
  const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(NOTIFICATIONS_PAGE);
  if (error) {
    if (missingTable(error.code)) return [];
    throw error;
  }
  return (data ?? []) as unknown as Notification[];
}

export async function fetchUnreadCount(sb: SupabaseClient) {
  const { count, error } = await sb.from("notifications").select("id", { count: "exact", head: true }).is("read_at", null);
  return error ? 0 : (count ?? 0);
}

/** Marks the given notifications read, or every unread one when `ids` is omitted. */
export async function markNotificationsRead(sb: SupabaseClient, ids?: string[]) {
  let q = sb.from("notifications").update({ read_at: new Date().toISOString() }).is("read_at", null);
  if (ids) q = q.in("id", ids);
  const { error } = await q;
  notifyChanged();
  return !error;
}

// The tab badge listens for this so it refreshes after reads elsewhere in the app.
const EVENT = "stack:notifications-changed";
export const notifyChanged = () => typeof window !== "undefined" && window.dispatchEvent(new Event(EVENT));
export const onNotificationsChanged = (fn: () => void) => {
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
};

/** Where tapping a notification goes, or null when that content is gone. */
export function notificationHref(n: Notification) {
  if (n.type === "fork") return n.fork ? `/s/${n.fork.id}` : null;
  if (!n.stack) return null;
  if (n.type === "comment") return `/s/${n.stack.id}#comment-${n.comment?.id ?? "deleted"}`;
  return `/s/${n.stack.id}`;
}
