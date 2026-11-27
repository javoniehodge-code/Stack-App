"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { postComment, thread, threadRoot } from "@/lib/comments";
import { flatten, fmtCount, initials, plural, stackTheme, tagInfo, timeAgo } from "@/lib/format";
import { useEngagement, useIsFollowing, useVisibility } from "@/lib/store";
import type { Comment, FeedItem, Stack } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { useStackActions } from "@/lib/useStackActions";
import { useAuth, useResume, useToast } from "./AppProviders";
import CommentBody from "./CommentBody";
import { BookmarkIcon, RepostIcon } from "./icons";
import { MentionList, useMentions } from "./Mentions";
import { RepostButton, RepostGlyph } from "./Repost";
import { ShareButton } from "./Share";
import { LineMarker, LinkPill, RichText } from "./StackView";
import { sortTags, ThemeBand, themed } from "./ThemedStack";
import { VIS, VisIcon } from "./Visibility";
import s from "./Cards.module.css";
import { stackPath } from "@/lib/links";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Props for a clickable card that opens the stack. */
function useOpen(stack: Stack) {
  const router = useRouter();
  const open = () => router.push(stackPath(stack));
  return {
    role: "link",
    tabIndex: 0,
    onClick: open,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target === e.currentTarget && e.key === "Enter") open();
    },
  } as const;
}

/** Like · save · [extra] · share. The feed's bar (`feed`) is like · save · repost · Share. */
export function ActionRow({ stack, extra, feed, shareLabel }: { stack: Stack; extra?: React.ReactNode; feed?: boolean; shareLabel?: boolean }) {
  const e = useEngagement(stack);
  const a = useStackActions();
  const likeColor = e.liked ? "var(--accent)" : "var(--muted-66)";
  const saveColor = e.saved ? "var(--accent)" : "var(--muted-66)";
  return (
    <div className={s.actions} onClick={stop}>
      <button className={s.action} style={{ color: likeColor }} onClick={() => a.toggleLike(stack.id, e)} aria-pressed={e.liked} aria-label={e.liked ? "Unlike" : "Like"}>
        <span className={s.heart}>{e.liked ? "♥" : "♡"}</span>
        {fmtCount(e.likes)}
      </button>
      <button className={s.action} style={{ color: saveColor }} onClick={() => a.toggleSave(stack.id, e)} aria-pressed={e.saved} aria-label={e.saved ? "Unsave" : "Save"}>
        <BookmarkIcon size={feed ? 16 : 13} color={saveColor} filled={e.saved} />
        {fmtCount(e.saves)}
      </button>
      {feed && <RepostButton stack={stack} className={s.action} size={16} count={fmtCount} />}
      {extra}
      <ShareButton stack={stack} className={s.copy} size={16} label={feed || shareLabel ? "Share" : undefined} />
    </div>
  );
}

/** A feed card, with "X reposted" and their note when it's in the Following feed because of a repost. */
export function FeedCard({ stack, following = false }: { stack: FeedItem; following?: boolean }) {
  const { authorHref } = useStackActions();
  const rp = stack.repost;
  if (!rp) return <FeedCardBody stack={stack} following={following} />;
  return (
    <div className={s.feedItem}>
      <Link href={authorHref(rp.by)} className={s.feedRepostLabel}>
        <RepostGlyph size={13} width={2.2} />
        {rp.by.name} reposted
      </Link>
      <FeedCardBody
        stack={stack}
        following={following}
        note={
          rp.note && (
            <div className={s.repostNote}>
              <span className={s.repostNoteAvatar}>{initials(rp.by.name)}</span>
              <span className={s.repostNoteText}>{rp.note}</span>
            </div>
          )
        }
      />
    </div>
  );
}

/** Update notes show for 7 days after the update was shared. */
const updateIsRecent = (sharedAt: string) => Date.now() - Date.parse(sharedAt) < 7 * 86_400_000;

/** The green "Updated: note" line on a stack whose author shared an update to the feed in the last 7 days. */
export function UpdateBanner({ stack, className }: { stack: Pick<Stack, "shared_at" | "update_note">; className?: string }) {
  if (!stack.shared_at || !updateIsRecent(stack.shared_at)) return null;
  const note = stack.update_note?.trim();
  return (
    <div className={`${s.updateBanner} ${className ?? ""}`}>
      <strong>Updated{note && ":"}</strong>
      {note && ` ${note}`}
    </div>
  );
}

/** How many picks a feed card shows before "See all N lines" (agreed Nov 27, as in the design). */
const FEED_MAX = 5;

/**
 * A feed card, as in the design (Party Mode): the theme band ("{emoji} N picks" and the time), the author with
 * Follow, the title, the first picks in the Stack page's style (faded, with See all, when cut off), the action bar,
 * then comments that open inline.
 */
function FeedCardBody({ stack, note, following = false }: { stack: Stack; note?: React.ReactNode; following?: boolean }) {
  const open = useOpen(stack);
  const { viewer, requireAuth } = useAuth();
  const toast = useToast();
  const a = useStackActions();
  const { authorHref } = a;
  const isFollowing = useIsFollowing(stack.author.id, following);
  const mine = viewer?.id === stack.author.id;
  const theme = stackTheme(stack);
  const lines = flatten(stack);
  const shown = lines.slice(0, FEED_MAX);
  const extra = lines.length > shown.length;
  // The body has a fixed maximum height; the fade and See all show only when it cuts lines off.
  const clipRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(lines.length > FEED_MAX);
  useEffect(() => {
    const el = clipRef.current;
    if (!el) return;
    const measure = () => setMore(extra || el.scrollHeight > el.clientHeight + 2);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [extra]);
  const [comments, setComments] = useState<Comment[]>(stack.comments ?? []);
  const [showComments, setShowComments] = useState(false);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; handle: string } | null>(null);
  const [posting, setPosting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const mentions = useMentions(draft, setDraft);
  const n = comments.length;
  const toggleLabel = showComments ? "Hide comments" : n ? `View ${plural(n, "comment")}` : "Add a comment";
  const first = comments[0];

  async function post(ev: React.FormEvent) {
    ev.preventDefault();
    const body = draft.trim();
    if (!body || posting) return;
    // Signed-out viewers get the sign-in sheet; the draft stays so they can post after.
    if (!viewer) return requireAuth(null, "Sign in to join the conversation.", `comment:${stack.id}`);
    setPosting(true);
    const data = await postComment(createClient(), stack.id, body, replyTo?.id ?? null);
    setPosting(false);
    if (!data) {
      toast("Couldn't post your comment. Try again.");
      return;
    }
    setComments((c) => [...c, { ...data, author: { handle: viewer.handle } }]);
    setDraft("");
    setReplyTo(null);
  }

  // Replies attach to the top-level comment and start with the person's @handle, so they're notified.
  const beginReply = (c: Comment) => {
    const handle = c.author?.handle;
    setReplyTo({ id: threadRoot(c), handle: handle ?? "deleted" });
    if (handle && handle !== viewer?.handle && !draft.includes(`@${handle}`)) setDraft((d) => `@${handle} ${d}`.slice(0, 500));
    inputRef.current?.focus();
  };
  const startReply = (c: Comment) => requireAuth(() => beginReply(c), "Sign in to reply.", `comment:${stack.id}:${c.id}`);

  // Back from a Google sign-in started by commenting or replying: the comments open again with what was typed,
  // and a reply is started on the same comment.
  useResume(
    `comment:${stack.id}`,
    (commentId, state) => {
      setShowComments(true);
      const typed = (state as { draft?: unknown } | null)?.draft;
      if (typeof typed === "string") setDraft(typed);
      const c = commentId ? comments.find((x) => x.id === commentId) : null;
      if (c) beginReply(c);
    },
    () => ({ draft }),
  );

  return (
    <article className={s.pmFeedCard}>
      <div {...open} className={s.pmFeedBand}>
        <ThemeBand emoji={theme.emoji} color={theme.color} count={lines.length} end={timeAgo(stack.published_at)} />
      </div>
      <div className={s.pmFeedBody}>
        <div className={s.pmAuthorRow}>
          <Link href={authorHref(stack.author)} className={s.pmAuthorLink}>
            <span className={s.pmAvatar}>{initials(stack.author.name)}</span>
            <span className={s.pmName}>{stack.author.name}</span>
            <span className={s.pmHandle}>@{stack.author.handle}</span>
          </Link>
          {!mine && <FollowButton className={s.pmFollow} following={isFollowing} onClick={() => a.toggleFollow(stack.author, isFollowing)} />}
        </div>
        {note}
        <UpdateBanner stack={stack} />
        <div {...open} className={s.feedOpen}>
          <div ref={clipRef} className={s.pmClip}>
            <div className={s.pmTitle}>{stack.title}</div>
            {stack.description && <div className={s.pmDesc}>{stack.description}</div>}
            <div style={{ height: 16 }} />
            {shown.map((l, i) => {
              // A rule under each pick, except at the end of a section and after the last one shown.
              const last = i === shown.length - 1 || !!shown[i + 1].label;
              return (
                <div key={i}>
                  {l.label && (
                    <div className={themed.pmSecHead} data-first={i === 0 || undefined}>
                      <span className={themed.pmSecBar} />
                      <div className={themed.pmSecLabel}>{l.label}</div>
                    </div>
                  )}
                  <div className={themed.pmLine} data-last={last || undefined}>
                    <LineMarker ln={l} numClass={themed.pmNum} bulletClass={themed.pmBullet} />
                    <div className={themed.pmLineBody}>
                      {l.head && <div className={l.format === "text" ? themed.pmPara : themed.pmHead}>{l.plain ? l.head : <RichText text={l.head} />}</div>}
                      {l.note && <div className={themed.pmSub}>{l.note}</div>}
                      {(l.link || l.links.length > 0) && (
                        <div className={themed.pmLinks}>
                          {l.link && <LinkPill href={l.link} label={l.linkLabel} className={themed.pmLink} />}
                          {l.links.map((u) => (
                            <LinkPill key={u.href} href={u.href} label={u.label} className={themed.pmLink} />
                          ))}
                        </div>
                      )}
                      {!!l.tags?.length && (
                        <div className={themed.pmTags}>
                          <span className={themed.pmYouSay}>{mine ? "You say" : `${stack.author.name.trim().split(/\s+/)[0] || stack.author.handle} says`}</span>
                          {sortTags(l.tags).map((tag) => (
                            <span key={tag} className={themed.pmTag} data-group={tagInfo(tag).group || "own"}>
                              {tagInfo(tag).emoji ? `${tagInfo(tag).emoji} ` : ""}
                              {tagInfo(tag).name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            {more && <div className={s.pmFade} aria-hidden />}
          </div>
          {more && (
            <div className={s.pmSeeAll}>
              See all {lines.length} lines<span className={s.viewFullArrow}>→</span>
            </div>
          )}
          <div style={{ height: 14 }} />
        </div>
      </div>
      <ActionRow stack={stack} feed />
      <div className={s.feedCommentsWrap}>
        <button className={s.commentToggle} onClick={() => setShowComments((v) => !v)} aria-expanded={showComments}>
          <span className={s.commentToggleLabel}>{toggleLabel}</span>
          <span className={s.commentPreview}>{!showComments && first ? `@${first.author?.handle ?? "deleted"}: ${first.body}` : ""}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: showComments ? "rotate(180deg)" : undefined }}>
            <path d="M12 5v14M6 13l6 6 6-6" />
          </svg>
        </button>
        {showComments && (
          <div className={s.feedComments}>
            {thread(comments).map(({ comment: c, isReply }) => (
              <div key={c.id} className={`${s.feedComment} ${isReply ? s.feedReply : ""}`}>
                <div className={s.commentInitial}>{(c.author?.handle ?? "?").charAt(0).toUpperCase()}</div>
                <div className={s.feedCommentBody}>
                  <div className={s.commentAuthor}>@{c.author?.handle ?? "deleted"}</div>
                  <div className={s.commentText}>
                    <CommentBody text={c.body} linkClass={s.mention} />
                  </div>
                  <button className={s.replyButton} onClick={() => startReply(c)}>
                    Reply
                  </button>
                </div>
              </div>
            ))}
            {replyTo && (
              <div className={s.replyingTo}>
                Replying to <span className={s.mention}>@{replyTo.handle}</span>
                <button className={s.replyingClear} onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                  ×
                </button>
              </div>
            )}
            <form className={s.commentForm} onSubmit={post}>
              <MentionList {...mentions} />
              <input
                ref={inputRef}
                className={s.commentInput}
                value={draft}
                maxLength={500}
                onChange={(e) => {
                  setDraft(e.target.value);
                  mentions.track(e.target);
                }}
                onKeyDown={(e) => mentions.onKeyDown(e)}
                onBlur={mentions.close}
                placeholder={replyTo ? "Write a reply…" : "Add a comment… (@ to tag)"}
                aria-label={replyTo ? `Reply to @${replyTo.handle}` : `Comment on ${stack.title}`}
              />
              <button type="submit" className={s.postButton} disabled={posting} style={{ opacity: draft.trim() && !posting ? 1 : 0.4 }}>
                Post
              </button>
            </form>
          </div>
        )}
      </div>
    </article>
  );
}

/** Explore's Trending cards, as in the design: a small theme band with the picks and category, the author, the
 *  title, the first 3 picks and "+ N more lines", then Like, Save and Share. */
export function TrendingCard({ stack, category }: { stack: Stack; category?: string }) {
  const open = useOpen(stack);
  const theme = stackTheme(stack);
  const lines = flatten(stack);
  return (
    <div className={s.pmTrending}>
      <div {...open} className={s.pmFeedBand}>
        <ThemeBand emoji={theme.emoji} color={theme.color} count={lines.length} end={category ?? ""} small />
      </div>
      <div {...open} className={s.pmTrendBody}>
        <div className={s.pmTrendAuthor}>
          <span className={s.pmTrendAvatar}>{initials(stack.author.name)}</span>
          <span className={s.pmTrendName}>{stack.author.name}</span>
        </div>
        <div className={s.pmTrendTitle}>{stack.title}</div>
        {lines.slice(0, 3).map((l, i) => (
          <div key={i} className={s.pmTrendLine}>
            <span className={s.pmTrendNum}>{l.num}</span>
            <span className={s.pmTrendText}>{l.text}</span>
          </div>
        ))}
        {lines.length > 3 && <div className={s.pmTrendMore}>+ {lines.length - 3} more lines</div>}
      </div>
      <div className={s.pmTrendBar}>
        <ActionRow stack={stack} shareLabel />
      </div>
    </div>
  );
}

/**
 * Square profile tile, as in the design: a strip in the Stack's theme with its emoji, the title, first 3 lines and line count. On your own profile it shows who can see the stack
 * and a pin on the pinned one; on someone else's it shows a save button, and reposts show the original author.
 */
export function GridCard({ stack, pinned = false, visitor = false, repost = false }: { stack: Stack; pinned?: boolean; visitor?: boolean; repost?: boolean }) {
  const open = useOpen(stack);
  const visibility = useVisibility(stack);
  const a = useStackActions();
  const e = useEngagement(stack);
  const lines = flatten(stack);
  const theme = stackTheme(stack);
  const visColor = visibility === "public" ? "var(--muted-66)" : "var(--warn)";
  const saveColor = e.saved ? "var(--accent)" : "var(--muted-66)";
  return (
    <div className={s.gridCard} {...open}>
      <div className={s.gridStrip} style={{ background: theme.color }} aria-hidden>
        {theme.emoji}
      </div>
      {pinned && (
        <span className={s.gridPin} title="Pinned" aria-label="Pinned">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 17v5" />
            <path d="M9 10.8V4h6v6.8l3 3.2H6z" />
          </svg>
        </span>
      )}
      {repost && (
        <div className={s.gridRepost}>
          <RepostIcon size={11} />
          <span>@{stack.author.handle}</span>
        </div>
      )}
      <div className={s.gridTitle} style={pinned ? { paddingRight: 24 } : undefined}>
        {stack.title}
      </div>
      <div className={s.gridLines}>
        {lines.slice(0, 3).map((l, i) => (
          <div key={i} className={s.lineClip}>
            {l.num && <span className={s.num}>{l.num} </span>}
            {l.text}
          </div>
        ))}
      </div>
      <div className={s.gridStats}>
        <span className={s.gridCount}>{plural(lines.length, "line")}</span>
        {visitor ? (
          <button
            className={s.gridSave}
            style={{ color: saveColor }}
            onClick={(ev) => {
              ev.stopPropagation();
              a.toggleSave(stack.id, e);
            }}
            aria-pressed={e.saved}
            aria-label={e.saved ? "Unsave" : "Save"}
          >
            <BookmarkIcon size={12} color={saveColor} filled={e.saved} />
            {fmtCount(e.saves)}
          </button>
        ) : (
          <span className={s.gridVis} style={{ color: visColor }}>
            <VisIcon value={visibility} size={11} color={visColor} />
            {VIS[visibility].label}
          </span>
        )}
      </div>
    </div>
  );
}

export function FollowButton({
  following,
  onClick,
  small,
  className,
  style,
  label = "Follow",
}: {
  following: boolean;
  onClick: () => void;
  small?: boolean;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
}) {
  return (
    <button
      className={small ? s.followSmall : className}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-pressed={following}
      style={{
        background: following ? "transparent" : "var(--accent)",
        color: following ? "var(--text-2)" : "var(--on-accent)",
        border: `1px solid ${following ? "var(--line-4)" : "var(--accent)"}`,
        ...style,
      }}
    >
      {following ? "Following" : label}
    </button>
  );
}
