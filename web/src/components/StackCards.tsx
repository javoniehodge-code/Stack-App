"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { flatten, fmtCount, initials, plural, timeAgo } from "@/lib/format";
import { useEngagement, useIsFollowing } from "@/lib/store";
import type { Comment, Stack } from "@/lib/types";
import { useStackActions } from "@/lib/useStackActions";
import { useAuth } from "./AppProviders";
import { BookmarkIcon, ForkIcon, LinkIcon, RepostIcon } from "./icons";
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

/** Like · save · fork · [extra] · copy link. */
export function ActionRow({ stack, extra }: { stack: Stack; extra?: React.ReactNode }) {
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
        <BookmarkIcon color={saveColor} filled={e.saved} />
        {fmtCount(e.saves)}
      </button>
      <button className={s.action} style={{ color: "var(--muted-66)" }} onClick={() => a.fork(stack.id)} aria-label="Fork">
        <ForkIcon />
        {fmtCount(stack.forks_count)}
      </button>
      {extra}
      <button className={s.copy} onClick={() => a.copyLink(stack.id)} aria-label="Copy link">
        <LinkIcon />
      </button>
    </div>
  );
}

export function CommentList({ comments }: { comments: Comment[] }) {
  return comments.map((c) => (
    <div key={c.id} className={s.comment}>
      <div className={s.commentAuthor}>@{c.author?.handle ?? "deleted"}</div>
      <div className={s.commentText}>{c.body}</div>
    </div>
  ));
}

/** A full-height feed slide: the stack card, then its comments. */
export function FeedSlide({ stack }: { stack: Stack }) {
  const open = useOpen(stack.id);
  const router = useRouter();
  const lines = flatten(stack);
  const comments = stack.comments ?? [];
  return (
    <div className={s.slide}>
      <div className={`${s.card} ${s.slideCard}`} {...open}>
        <AuthorRow stack={stack} />
        <div className={s.title}>{stack.title}</div>
        <div className={`${s.lines} ${s.slideLines}`}>
          {lines.map((l, i) => (
            <div key={i}>
              <span className={s.num}>{l.num}</span> {l.text}
            </div>
          ))}
        </div>
        <ActionRow stack={stack} />
      </div>
      {comments.length > 0 ? (
        <div className={s.comments}>
          <div className={s.commentsLabel}>Comments</div>
          <CommentList comments={comments} />
        </div>
      ) : (
        <button className={s.noComments} onClick={() => router.push(`/s/${stack.id}?comment=1`)}>
          <span className={s.noCommentsText}>No comments yet. Be the first.</span>
          <span className={s.outlinePill}>Add a comment</span>
        </button>
      )}
    </div>
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
            <span className={s.num}>{l.num}</span> {l.text}
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
              <span className={s.num}>{l.num}</span> {l.text}
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
            <span className={s.lcNum}>{l.num}</span>
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
        <span className={s.lcAction} style={{ color: "var(--muted-66)" }}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>⑂</span>
          {fmtCount(stack.forks_count)}
        </span>
        <span style={{ flex: 1 }} />
        <button className={s.lcAction} style={{ color: saveColor }} onClick={() => a.toggleSave(stack.id, e)} aria-pressed={e.saved} aria-label={e.saved ? "Unsave" : "Save"}>
          <span style={{ fontSize: 13, lineHeight: 1 }}>{e.saved ? "◆" : "◇"}</span>
          {fmtCount(e.saves)}
        </button>
      </div>
    </div>
  );
}

export function FollowButton({ following, onClick, small, className, style }: { following: boolean; onClick: () => void; small?: boolean; className?: string; style?: React.CSSProperties }) {
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
      {following ? "Following" : "Follow"}
    </button>
  );
}
