"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { flatten, fmtCount, initials, plural, timeAgo } from "@/lib/format";
import { useEngagement, useIsFollowing } from "@/lib/store";
import type { Comment, Stack } from "@/lib/types";
import { createClient } from "@/lib/supabase/client";
import { useStackActions } from "@/lib/useStackActions";
import { useAuth, useToast } from "./AppProviders";
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

/** Like · save · fork · [extra] · copy link. `large` is the feed slide's size. */
export function ActionRow({ stack, extra, large }: { stack: Stack; extra?: React.ReactNode; large?: boolean }) {
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
        <BookmarkIcon size={large ? 16 : 13} color={saveColor} filled={e.saved} />
        {fmtCount(e.saves)}
      </button>
      <button className={s.action} style={{ color: "var(--muted-66)" }} onClick={() => a.fork(stack.id)} aria-label="Fork">
        <ForkIcon size={large ? 16 : 13} />
        {fmtCount(stack.forks_count)}
      </button>
      {extra}
      <button className={s.copy} onClick={() => a.copyLink(stack.id)} aria-label="Copy link">
        <LinkIcon size={large ? 17 : 14} />
      </button>
    </div>
  );
}

/** A feed card: up to 4 lines (5 faded plus See more when longer), then comments that open inline. */
export function FeedCard({ stack }: { stack: Stack }) {
  const open = useOpen(stack.id);
  const { viewer, requireAuth } = useAuth();
  const toast = useToast();
  const lines = flatten(stack);
  // Longer stacks show a 5th line under a fade, then See more.
  const more = lines.length > 4;
  const [comments, setComments] = useState<Comment[]>(stack.comments ?? []);
  const [showComments, setShowComments] = useState(false);
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
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
    const { data, error } = await createClient().from("comments").insert({ stack_id: stack.id, body }).select("id,body,created_at").single();
    setPosting(false);
    if (error || !data) {
      toast("Couldn't post your comment. Try again.");
      return;
    }
    setComments((c) => [...c, { ...(data as Omit<Comment, "author">), author: { handle: viewer.handle } }]);
    setDraft("");
  }

  return (
    <article className={s.feedCard}>
      <AuthorRow stack={stack} />
      <div {...open} className={s.feedOpen}>
        <div className={s.title}>{stack.title}</div>
        {stack.description && <div className={s.feedDescription}>{stack.description}</div>}
        <div className={s.feedLines}>
          {lines.slice(0, more ? 5 : 4).map((l, i) => (
            <div key={i} className={s.feedLine}>
              <span className={s.num}>{l.num}</span>
              <span className={s.feedLineText}>
                {l.text}
                {l.link && <span className={s.feedLink}> ↗</span>}
              </span>
            </div>
          ))}
          {more && <div className={s.feedFade} aria-hidden />}
        </div>
        {more && <div className={s.viewFull}>See more · {plural(lines.length, "line")} →</div>}
      </div>
      <ActionRow stack={stack} large />
      <button className={s.commentToggle} onClick={() => setShowComments((v) => !v)} aria-expanded={showComments}>
        <span className={s.commentToggleLabel}>{toggleLabel}</span>
        <span className={s.commentPreview}>{!showComments && first ? `@${first.author?.handle ?? "deleted"}: ${first.body}` : ""}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: showComments ? "rotate(180deg)" : undefined }}>
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      </button>
      {showComments && (
        <div className={s.feedComments}>
          {comments.map((c) => (
            <div key={c.id} className={s.feedComment}>
              <div className={s.commentInitial}>{(c.author?.handle ?? "?").charAt(0).toUpperCase()}</div>
              <div className={s.feedCommentBody}>
                <div className={s.commentAuthor}>@{c.author?.handle ?? "deleted"}</div>
                <div className={s.commentText}>{c.body}</div>
              </div>
            </div>
          ))}
          <form className={s.commentForm} onSubmit={post}>
            <input className={s.commentInput} value={draft} maxLength={500} onChange={(e) => setDraft(e.target.value)} placeholder="Add a comment…" aria-label={`Comment on ${stack.title}`} />
            <button type="submit" className={s.postButton} disabled={posting} style={{ opacity: draft.trim() && !posting ? 1 : 0.4 }}>
              Post
            </button>
          </form>
        </div>
      )}
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

/** Your own profile's two-column grid tile: title, first 5 lines, counts, and a pin badge when featured. */
export function GridCard({ stack, pinned = false }: { stack: Stack; pinned?: boolean }) {
  const open = useOpen(stack.id);
  const e = useEngagement(stack);
  const lines = flatten(stack);
  return (
    <div className={`${s.gridCard} ${pinned ? s.gridCardPinned : ""}`} {...open}>
      {pinned && (
        <span className={s.gridPin} title="Featured" aria-label="Featured">
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
        {lines.slice(0, 5).map((l, i) => (
          <div key={i} className={s.lineClip}>
            <span className={s.num}>{l.num}</span> {l.text}
          </div>
        ))}
      </div>
      {lines.length > 5 && <div className={s.gridMore}>+ {lines.length - 5} more</div>}
      <div className={s.gridStats}>
        <span className={s.gridStat}>
          <span style={{ fontSize: 12, lineHeight: 1 }}>♡</span>
          {fmtCount(e.likes)}
        </span>
        <span className={s.gridStat}>
          <BookmarkIcon size={11} color="var(--muted-66)" filled={false} width={2.2} />
          {fmtCount(e.saves)}
        </span>
        <span className={s.gridStat}>
          <ForkIcon size={11} width={2.2} />
          {fmtCount(stack.forks_count)}
        </span>
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
