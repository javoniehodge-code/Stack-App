"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { postComment, thread, threadRoot } from "@/lib/comments";
import { flatten, fmtCount, initials, plural, timeAgo } from "@/lib/format";
import { useEngagement, useIsFollowing, useVisibility } from "@/lib/store";
import type { Comment, FeedItem, Stack } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { useStackActions } from "@/lib/useStackActions";
import { useAuth, useToast } from "./AppProviders";
import CommentBody from "./CommentBody";
import { BookmarkIcon, RepostIcon } from "./icons";
import { MentionList, useMentions } from "./Mentions";
import { RepostButton, RepostGlyph } from "./Repost";
import { ShareButton } from "./Share";
import { LineMarker, LinkPill } from "./StackView";
import { VIS, VisIcon } from "./Visibility";
import s from "./Cards.module.css";

const stop = (e: React.SyntheticEvent) => e.stopPropagation();

/** Props for a clickable card that opens the stack. */
function useOpen(id: string) {
  const router = useRouter();
  const open = () => router.push(`/s/${id}`);
  return {
    role: "link",
    tabIndex: 0,
    onClick: open,
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.target === e.currentTarget && e.key === "Enter") open();
    },
  } as const;
}

function AuthorRow({ stack }: { stack: Stack }) {
  const { authorHref } = useStackActions();
  return (
    <Link href={authorHref(stack.author)} onClick={stop} className={s.author}>
      <span className={s.avatar}>{initials(stack.author.name)}</span>
      <span className={s.authorName}>{stack.author.name}</span>
      <span className={s.authorHandle}>@{stack.author.handle}</span>
    </Link>
  );
}

/** Like · save · [extra] · share. The feed's bar (`feed`) is like · save · repost · Share. */
export function ActionRow({ stack, extra, feed }: { stack: Stack; extra?: React.ReactNode; feed?: boolean }) {
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
      <ShareButton stack={stack} className={s.copy} size={16} label={feed ? "Share" : undefined} />
    </div>
  );
}

/** A feed card, with "X reposted" and their note when it's in the Following feed because of a repost. */
export function FeedCard({ stack }: { stack: FeedItem }) {
  const { authorHref } = useStackActions();
  const rp = stack.repost;
  if (!rp) return <FeedCardBody stack={stack} />;
  return (
    <div className={s.feedItem}>
      <Link href={authorHref(rp.by)} className={s.feedRepostLabel}>
        <RepostGlyph size={13} width={2.2} />
        {rp.by.name} reposted
      </Link>
      <FeedCardBody
        stack={stack}
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

/** A paper card: author and age on top, as many lines as fit (faded, with See all, when cut off), the action bar, then comments that open inline. */
function FeedCardBody({ stack, note }: { stack: Stack; note?: React.ReactNode }) {
  const open = useOpen(stack.id);
  const { viewer, requireAuth } = useAuth();
  const toast = useToast();
  const { authorHref } = useStackActions();
  const lines = flatten(stack);
  const shown = lines.slice(0, 14);
  const extra = lines.length > shown.length;
  // The body has a fixed maximum height; the fade and See all show only when it cuts lines off.
  const clipRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(lines.length > 4);
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
    if (!viewer) return requireAuth(null, "Sign in to join the conversation.");
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
  const startReply = (c: Comment) =>
    requireAuth(() => {
      const handle = c.author?.handle;
      setReplyTo({ id: threadRoot(c), handle: handle ?? "deleted" });
      if (handle && handle !== viewer?.handle && !draft.includes(`@${handle}`)) setDraft((d) => `@${handle} ${d}`.slice(0, 500));
      inputRef.current?.focus();
    }, "Sign in to reply.");

  return (
    <article className={s.feedCard}>
      <div className={s.feedTop}>
        <Link href={authorHref(stack.author)} className={s.author}>
          <span className={s.avatar}>{initials(stack.author.name)}</span>
          <span className={s.authorName}>{stack.author.name}</span>
          <span className={s.authorHandle}>@{stack.author.handle}</span>
        </Link>
        <span className={s.feedMeta}>
          {timeAgo(stack.published_at)} · {plural(lines.length, "line")}
        </span>
      </div>
      <div className={s.feedBody}>
        {note}
        <UpdateBanner stack={stack} />
        <div {...open} className={s.feedOpen}>
          <div ref={clipRef} className={s.feedClip}>
            <div className={s.title}>{stack.title}</div>
            {stack.description && <div className={s.feedDescription}>{stack.description}</div>}
            <div className={s.feedLines}>
              {shown.map((l, i) => {
                // A rule under each line, except before a new section and after the last line shown.
                const divided = i < shown.length - 1 && !shown[i + 1].label;
                return (
                  <div key={i}>
                    {l.label && <div className={`${s.feedLabel} ${i === 0 ? s.feedLabelFirst : ""}`}>{l.label}</div>}
                    <div className={`${s.feedLine} ${divided ? s.feedLineDivided : ""}`}>
                      <LineMarker ln={l} numClass={s.num} bulletClass={s.feedBullet} />
                      <span className={s.feedLineText}>
                        <span className={l.format === "text" ? s.feedPara : l.format === "bold" ? s.feedBoldLine : `${s.feedHead} ${l.bold ? "" : s.feedPlain}`}>{l.head}</span>
                        {l.note && <span className={s.feedNote}>{l.note}</span>}
                        {l.link && <LinkPill href={l.link} className={s.feedLink} size={10} />}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            {more && <div className={s.feedFade} aria-hidden />}
          </div>
          {more && (
            <div className={s.viewFull}>
              See all {lines.length} lines<span className={s.viewFullArrow}>→</span>
            </div>
          )}
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

/** Explore's horizontally scrolling cards: first 3 lines. */
export function TrendingCard({ stack }: { stack: Stack }) {
  const open = useOpen(stack.id);
  const lines = flatten(stack);
  return (
    <div className={`${s.card} ${s.trending}`} {...open}>
      <AuthorRow stack={stack} />
      <div className={s.title}>{stack.title}</div>
      <div className={s.lines}>
        {lines.slice(0, 3).map((l, i) => (
          <div key={i} className={s.lineClip}>
            {l.num && <span className={s.num}>{l.num} </span>}
            {l.text}
          </div>
        ))}
      </div>
      {lines.length > 3 && <div className={s.more}>+ {lines.length - 3} more lines</div>}
      <ActionRow stack={stack} />
    </div>
  );
}

/** Creator profile card: first 4 lines, a comment count instead of comments. */
export function CompactCard({ stack, repostedBy }: { stack: Stack; repostedBy?: string }) {
  const open = useOpen(stack.id);
  const lines = flatten(stack);
  return (
    <div className={s.userItem}>
      {repostedBy && (
        <div className={s.repostLabel}>
          <RepostIcon />
          {repostedBy} reposted
        </div>
      )}
      <div className={s.card} {...open}>
        <AuthorRow stack={stack} />
        <div className={s.title}>{stack.title}</div>
        <div className={s.lines}>
          {lines.slice(0, 4).map((l, i) => (
            <div key={i} className={s.lineClip}>
              {l.num && <span className={s.num}>{l.num} </span>}
            {l.text}
            </div>
          ))}
        </div>
        {lines.length > 4 && <div className={s.more}>+ {lines.length - 4} more · tap to see all</div>}
        <ActionRow
          stack={stack}
          extra={<span className={s.commentCount}>{stack.comments_count ? plural(stack.comments_count, "comment") : "No comments"}</span>}
        />
      </div>
    </div>
  );
}

/** Flat list card used for search results and your own stacks. */
export function ListCard({ stack, following = false }: { stack: Stack; following?: boolean }) {
  const open = useOpen(stack.id);
  const { viewer } = useAuth();
  const a = useStackActions();
  const e = useEngagement(stack);
  const isFollowing = useIsFollowing(stack.author.id, following);
  const mine = viewer?.id === stack.author.id;
  const lines = flatten(stack);
  const likeColor = e.liked ? "var(--accent)" : "var(--muted-66)";
  const saveColor = e.saved ? "var(--accent)" : "var(--muted-66)";
  return (
    <div className={s.listCard} {...open}>
      <div className={s.lcAuthor}>
        <Link href={a.authorHref(stack.author)} onClick={stop} className={s.lcAuthorLink}>
          <span className={s.lcAvatar}>{initials(stack.author.name)}</span>
          <span className={s.lcNames}>
            <span className={s.lcName}>{stack.author.name}</span>
            <span className={s.lcHandle}>@{stack.author.handle}</span>
            <span className={s.lcTime}>· {timeAgo(stack.published_at)}</span>
          </span>
        </Link>
        {!mine && <FollowButton small following={isFollowing} onClick={() => a.toggleFollow(stack.author, isFollowing)} />}
      </div>
      <div className={s.lcTitle}>{stack.title}</div>
      {lines.map((l, i) => (
        <div key={i}>
          {l.label && <div className={s.lcLabel}>{l.label}</div>}
          <div className={s.lcLine}>
            {l.num && <span className={s.lcNum}>{l.num}</span>}
            <span className={s.lcText}>{l.text}</span>
            {l.link && (
              <span className={s.linkChip} aria-label="Has a link">
                ↗
              </span>
            )}
          </div>
        </div>
      ))}
      <div className={s.lcActions} onClick={stop}>
        <button className={s.lcAction} style={{ color: likeColor }} onClick={() => a.toggleLike(stack.id, e)} aria-pressed={e.liked} aria-label={e.liked ? "Unlike" : "Like"}>
          <span style={{ fontSize: 14, lineHeight: 1 }}>{e.liked ? "♥" : "♡"}</span>
          {fmtCount(e.likes)}
        </button>
        <span style={{ flex: 1 }} />
        <button className={s.lcAction} style={{ color: saveColor }} onClick={() => a.toggleSave(stack.id, e)} aria-pressed={e.saved} aria-label={e.saved ? "Unsave" : "Save"}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>{e.saved ? "◆" : "◇"}</span>
          {fmtCount(e.saves)}
        </button>
      </div>
    </div>
  );
}

/** Your own profile's square tile: title, first 3 lines, line count and who can see it. Pinned stacks get a pin. */
export function GridCard({ stack, pinned = false }: { stack: Stack; pinned?: boolean }) {
  const open = useOpen(stack.id);
  const visibility = useVisibility(stack);
  const lines = flatten(stack);
  const visColor = visibility === "public" ? "var(--muted-66)" : "var(--warn)";
  return (
    <div className={`${s.gridCard} ${pinned ? s.gridCardPinned : ""}`} {...open}>
      {pinned && (
        <span className={s.gridPin} title="Pinned" aria-label="Pinned">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="var(--accent)" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M12 17v5" />
            <path d="M9 10.8V4h6v6.8l3 3.2H6z" />
          </svg>
        </span>
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
        <span className={s.gridVis} style={{ color: visColor }}>
          <VisIcon value={visibility} size={11} color={visColor} />
          {VIS[visibility].label}
        </span>
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
