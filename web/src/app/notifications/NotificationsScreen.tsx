"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth, useToast } from "@/components/AppProviders";
import shell from "@/components/AppShell.module.css";
import { initials, timeAgo } from "@/lib/format";
import {
  NOTIFICATIONS_PAGE,
  type Notification,
  type NotificationFilter,
  type NotificationType,
  fetchNotifications,
  fetchUnreadCount,
  markNotificationsRead,
  notificationHref,
} from "@/lib/notifications";
import { createClient } from "@/lib/supabase/client";
import p from "../profile/Profile.module.css";
import s from "./Notifications.module.css";

const FILTERS: [NotificationFilter | null, string, string][] = [
  [null, "All", ""],
  ["comment", "Comments", "comments"],
  ["like", "Likes", "likes"],
  ["fork", "Forks", "forks"],
  ["save", "Saves", "saves"],
];
const VERB: Record<NotificationType, string> = {
  like: "liked",
  comment: "commented on",
  reply: "replied to your comment on",
  mention: "mentioned you on",
  fork: "forked",
  save: "saved",
  follow: "started following you",
};
const hasComment = (t: NotificationType) => t === "comment" || t === "reply" || t === "mention";

type ListState = { items: Notification[]; done: boolean; loading: boolean; error: boolean };
const EMPTY: ListState = { items: [], done: false, loading: true, error: false };

function TypeIcon({ type }: { type: NotificationType }) {
  const ink = "var(--bg)";
  if (type === "like")
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill={ink} aria-hidden>
        <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
      </svg>
    );
  if (type === "mention")
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="3.5" />
        <path d="M15.5 12v1.5a2.5 2.5 0 0 0 5 0V12a8.5 8.5 0 1 0-3.3 6.7" />
      </svg>
    );
  if (type === "follow")
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="3" strokeLinecap="round" aria-hidden>
        <circle cx="10" cy="8" r="3.5" />
        <path d="M3.5 20c1.2-3.4 3.6-5 6.5-5s5.3 1.6 6.5 5M19 8v6M16 11h6" />
      </svg>
    );
  if (type === "save")
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill={ink} aria-hidden>
        <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
      </svg>
    );
  if (type === "fork")
    return (
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={ink} strokeWidth="3.2" strokeLinecap="round" aria-hidden>
        <circle cx="6" cy="5" r="1.6" />
        <circle cx="18" cy="5" r="1.6" />
        <circle cx="12" cy="19" r="1.6" />
        <path d="M6 7v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7M12 12v5" />
      </svg>
    );
  // comment, reply, and anything newer this screen doesn't know yet
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill={ink} aria-hidden>
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  );
}

const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();

export default function NotificationsScreen() {
  const { viewer, requireAuth } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [filter, setFilter] = useState<NotificationFilter | null>(null);
  const [list, setList] = useState<ListState>(EMPTY);
  const [unread, setUnread] = useState(0);
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState(false);
  const [reload, setReload] = useState(0);
  const request = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // First page for the current filter; read states come from the server, so switching filters keeps them.
  useEffect(() => {
    if (!viewer) return;
    const id = ++request.current;
    fetchNotifications(createClient(), { type: filter, before: null })
      .then((page) => id === request.current && setList({ items: page, done: page.length < NOTIFICATIONS_PAGE, loading: false, error: false }))
      .catch(() => id === request.current && setList((l) => ({ ...l, loading: false, error: true })));
    fetchUnreadCount(createClient()).then(setUnread);
  }, [viewer, filter, reload]);

  const loadMore = useCallback(
    async (after: Notification) => {
      const id = ++request.current;
      setList((l) => ({ ...l, loading: true, error: false }));
      try {
        const page = await fetchNotifications(createClient(), { type: filter, before: { created_at: after.created_at, id: after.id } });
        if (id === request.current) setList((l) => ({ items: [...l.items, ...page], done: page.length < NOTIFICATIONS_PAGE, loading: false, error: false }));
      } catch {
        if (id === request.current) setList((l) => ({ ...l, loading: false, error: true }));
      }
    },
    [filter],
  );

  // Next page when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || list.done || list.loading || list.error) return;
    const last = list.items[list.items.length - 1];
    if (!last) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && loadMore(last), {
      root: scrollRef.current,
      rootMargin: "0px 0px 300px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [list, loadMore]);

  if (!viewer) {
    return (
      <main className={`${shell.screen} ${p.gate}`}>
        <h1 className={p.gateTitle}>Sign in to see your notifications</h1>
        <div className={p.gateText}>Likes, saves, forks, and comments on your stacks will show up here.</div>
        <button className={p.gateButton} onClick={() => requireAuth(null, "Sign in to see likes, saves, forks, and comments on your stacks.")}>
          Sign in / Create account
        </button>
      </main>
    );
  }

  const setRead = (ids: string[] | null) => {
    const now = new Date().toISOString();
    setList((l) => ({ ...l, items: l.items.map((n) => (!n.read_at && (!ids || ids.includes(n.id)) ? { ...n, read_at: now } : n)) }));
  };

  async function open(n: Notification) {
    const href = notificationHref(n);
    if (!n.read_at) {
      setRead([n.id]);
      setUnread((u) => Math.max(0, u - 1));
      await markNotificationsRead(createClient(), [n.id]);
    }
    if (!href) {
      setGone((g) => new Set(g).add(n.id));
      return;
    }
    router.push(href);
  }

  async function markAll() {
    setMarking(true);
    const ok = await markNotificationsRead(createClient());
    setMarking(false);
    if (!ok) {
      toast("Couldn't mark notifications read. Try again.");
      return;
    }
    setRead(null);
    setUnread(0);
  }

  const groups = [
    { label: "New", items: list.items.filter((n) => !n.read_at) },
    { label: "Today", items: list.items.filter((n) => n.read_at && isToday(n.created_at)) },
    { label: "Earlier", items: list.items.filter((n) => n.read_at && !isToday(n.created_at)) },
  ].filter((g) => g.items.length);
  const filterWord = FILTERS.find(([t]) => t === filter)?.[2];

  return (
    <main className={shell.screen}>
      <header className={s.header}>
        <div className={s.bar}>
          <h1 className={s.title}>Notifications</h1>
          {unread > 0 && (
            <button className={s.markAll} onClick={markAll} disabled={marking}>
              Mark all read
            </button>
          )}
        </div>
        <div className={s.filters} role="tablist" aria-label="Filter notifications">
          {FILTERS.map(([t, label]) => {
            const on = filter === t;
            return (
              <button key={label} role="tab" aria-selected={on} className={`${s.filter} ${on ? s.filterOn : ""}`} onClick={() => {
                  if (on) return;
                  setList(EMPTY);
                  setFilter(t);
                }}>
                {label}
              </button>
            );
          })}
        </div>
      </header>

      <div ref={scrollRef} className={s.scroll}>
        {groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <h2 className={s.groupLabel}>{g.label}</h2>
            {g.items.map((n) => {
              const actor = n.actor?.name ?? "Someone";
              const title = n.stack?.title ?? n.metadata.stack_title ?? "your stack";
              return (
                <button key={n.id} className={`${s.row} ${!n.read_at ? s.rowUnread : ""}`} onClick={() => open(n)}>
                  <span className={s.avatarWrap}>
                    <span className={s.avatar}>{n.actor ? initials(n.actor.name) : "?"}</span>
                    <span className={s.typeBadge}>
                      <TypeIcon type={n.type} />
                    </span>
                  </span>
                  <span className={s.body}>
                    <span className={s.text}>
                      <span className={s.actor}>{actor}</span> {VERB[n.type] ?? "commented on"}
                      {n.type !== "follow" && (
                        <>
                          {" "}
                          <span className={s.stackTitle}>{title}</span>
                        </>
                      )}
                    </span>
                    {(hasComment(n.type) || n.comment_id) &&
                      (n.comment ? <span className={s.snippet}>“{n.comment.body}”</span> : <span className={s.snippetGone}>This comment was deleted.</span>)}
                    {gone.has(n.id) && <span className={s.goneNote}>This content is no longer available.</span>}
                    <span className={s.time}>{timeAgo(n.created_at)}</span>
                  </span>
                  <span className={s.dotCol} aria-label={!n.read_at ? "Unread" : undefined}>
                    <span className={s.dot} style={{ background: !n.read_at ? "var(--accent)" : "transparent" }} />
                  </span>
                </button>
              );
            })}
          </section>
        ))}

        {list.loading && <div className={s.status}>Loading…</div>}
        {list.error && (
          <div className={s.state}>
            <div className={s.stateTitle}>Couldn&apos;t load notifications</div>
            <button
              className={s.retry}
              onClick={() => {
                const last = list.items[list.items.length - 1];
                if (last) return loadMore(last);
                setList(EMPTY);
                setReload((r) => r + 1);
              }}
            >
              Try again
            </button>
          </div>
        )}
        {!list.loading && !list.error && list.items.length === 0 && (
          <div className={s.state}>
            {filter ? (
              <div className={s.stateText}>No {filterWord} yet.</div>
            ) : (
              <>
                <div className={s.stateTitle}>No activity yet</div>
                <div className={s.stateText}>Likes, saves, forks, and comments on your Stacks will appear here.</div>
              </>
            )}
          </div>
        )}
        {!list.done && !list.error && list.items.length > 0 && <div ref={sentinelRef} className={s.sentinel} />}
      </div>
    </main>
  );
}
