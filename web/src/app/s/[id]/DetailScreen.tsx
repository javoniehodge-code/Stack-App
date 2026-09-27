"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth, useBack, useToast } from "@/components/AppProviders";
import CommentBody from "@/components/CommentBody";
import { BackIcon, BookmarkIcon, ForkIcon } from "@/components/icons";
import { RepostButton } from "@/components/Repost";
import { ShareButton } from "@/components/Share";
import { MentionList, useMentions } from "@/components/Mentions";
import { FollowButton } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import { postComment, thread, threadRoot } from "@/lib/comments";
import { flatten, fmtCount, initials, timeAgo } from "@/lib/format";
import { useEngagement, useIsFollowing } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { Comment, Stack } from "@/lib/types";
import { useStackActions } from "@/lib/useStackActions";
import DeleteStackSheet from "./DeleteStackSheet";
import s from "./Detail.module.css";

export default function DetailScreen({ stack, following, openComposer }: { stack: Stack; following: boolean; openComposer: boolean }) {
  const back = useBack();
  const { viewer, requireAuth } = useAuth();
  const toast = useToast();
  const a = useStackActions();
  const e = useEngagement(stack);
  const isFollowing = useIsFollowing(stack.author.id, following);
  const lines = flatten(stack);
  const [comments, setComments] = useState<Comment[]>(stack.comments ?? []);
  const [composing, setComposing] = useState(openComposer && !!viewer);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; handle: string } | null>(null);
  const [posting, setPosting] = useState(false);
  const mentions = useMentions(draft, setDraft);
  const [deleting, setDeleting] = useState(false);
  const mine = viewer?.id === stack.author.id;

  // Arriving from a comment notification (#comment-<id>): scroll to it and highlight it briefly.
  useEffect(() => {
    const m = /^#comment-(.+)$/.exec(window.location.hash);
    if (!m) return;
    const el = document.getElementById(`comment-${m[1]}`);
    if (!el) {
      toast("This comment is no longer available.");
      return;
    }
    el.scrollIntoView({ block: "center" });
    el.classList.add(s.commentHighlight);
    const t = setTimeout(() => el.classList.remove(s.commentHighlight), 2000);
    return () => clearTimeout(t);
  }, [toast]);

  const likeColor = e.liked ? "var(--accent)" : "var(--muted-66)";
  const saveColor = e.saved ? "var(--accent)" : "var(--muted-66)";

  const startComment = () =>
    requireAuth(() => {
      setReplyTo(null);
      setComposing(true);
    }, "Sign in to join the conversation.");

  // Replies attach to the top-level comment and start with the person's @handle, so they're notified.
  const startReply = (c: Comment) =>
    requireAuth(() => {
      const handle = c.author?.handle;
      setReplyTo({ id: threadRoot(c), handle: handle ?? "deleted" });
      if (handle && handle !== viewer?.handle && !draft.includes(`@${handle}`)) setDraft((d) => `@${handle} ${d}`.slice(0, 500));
      setComposing(true);
    }, "Sign in to reply.");

  const cancelComposer = () => {
    setComposing(false);
    setReplyTo(null);
    mentions.close();
  };

  async function post(ev: React.FormEvent) {
    ev.preventDefault();
    const body = draft.trim();
    if (!body || !viewer) return;
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
    setComposing(false);
  }

  const composer = composing && (
    <form className={s.composer} onSubmit={post}>
      {replyTo && (
        <div className={s.replyingTo}>
          Replying to <span className={s.replyingHandle}>@{replyTo.handle}</span>
          <button type="button" className={s.replyingClear} onClick={() => setReplyTo(null)} aria-label="Cancel reply">
            ×
          </button>
        </div>
      )}
      <div className={s.composerField}>
        <MentionList {...mentions} />
        <textarea
          className={s.composerInput}
          value={draft}
          onChange={(ev) => {
            setDraft(ev.target.value.slice(0, 500));
            mentions.track(ev.target);
          }}
          onKeyDown={(ev) => mentions.onKeyDown(ev)}
          onBlur={mentions.close}
          placeholder={replyTo ? "Write a reply…" : "Share a tip, a favorite, or what you'd add. Type @ to tag someone."}
          rows={3}
          autoFocus
          aria-label={replyTo ? `Reply to @${replyTo.handle}` : "Comment"}
        />
      </div>
      <div className={s.composerBar}>
        <span className={s.composerCount}>{500 - draft.length}</span>
        <button type="button" className={s.composerCancel} onClick={cancelComposer}>
          Cancel
        </button>
        <button type="submit" className={s.composerPost} disabled={!draft.trim() || posting}>
          {posting ? "Posting…" : replyTo ? "Reply" : "Post"}
        </button>
      </div>
    </form>
  );

  return (
    <main className={shell.screen}>
      <header className={s.header}>
        <button onClick={back} className={s.back}>
          <BackIcon />
          Back
        </button>
        <div className={s.authorRow}>
          <Link href={a.authorHref(stack.author)} className={s.authorLink}>
            <span className={s.avatar}>{initials(stack.author.name)}</span>
            <span className={s.authorText}>
              <span className={s.authorName}>{stack.author.name}</span>
              <span className={s.authorMeta}>
                @{stack.author.handle} · {timeAgo(stack.published_at)}
              </span>
            </span>
          </Link>
          {mine ? (
            <button className={s.deleteButton} onClick={() => setDeleting(true)}>
              Delete
            </button>
          ) : (
            <FollowButton className={s.follow} following={isFollowing} onClick={() => a.toggleFollow(stack.author, isFollowing)} />
          )}
        </div>
        <h1 className={s.title}>{stack.title}</h1>
        {stack.description && <p className={s.description}>{stack.description}</p>}
        <div className={s.count}>{lines.length} lines</div>
      </header>

      <div className={s.body}>
        {lines.map((l, i) => (
          <div key={i}>
            {l.label && <div className={s.label}>{l.label}</div>}
            <div className={s.line}>
              <span className={s.num}>{l.num}</span>
              <span className={s.text}>{l.text}</span>
              {l.link && (
                <a className={s.linkChip} href={l.link} target="_blank" rel="noopener noreferrer nofollow ugc" aria-label={`Open link for “${l.text}”`} title={l.link}>
                  ↗
                </a>
              )}
            </div>
          </div>
        ))}

        <section className={s.commentsSection}>
          <div className={s.commentsLabel}>Comments</div>
          {comments.length > 0 ? (
            <div className={s.commentsBox}>
              {thread(comments).map(({ comment: c, isReply }) => (
                <div key={c.id} id={`comment-${c.id}`} className={`${s.comment} ${isReply ? s.reply : ""}`}>
                  <div className={s.commentAuthor}>@{c.author?.handle ?? "deleted"}</div>
                  <div className={s.commentText}>
                    <CommentBody text={c.body} linkClass={s.mention} />
                  </div>
                  <button className={s.replyButton} onClick={() => startReply(c)}>
                    Reply
                  </button>
                </div>
              ))}
              {composer || (
                <button className={s.addInline} onClick={startComment}>
                  Add a comment…
                </button>
              )}
            </div>
          ) : (
            <div className={`${s.commentsBox} ${s.emptyBox}`}>
              {composer || (
                <>
                  <div className={s.emptyText}>No comments yet. Share a tip, a favorite, or what you&apos;d add.</div>
                  <button className={s.outlinePill} onClick={startComment}>
                    Add a comment
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      <div className={s.actions}>
        <button className={s.action} style={{ color: likeColor }} onClick={() => a.toggleLike(stack.id, e)} aria-pressed={e.liked} aria-label={e.liked ? "Unlike" : "Like"}>
          <span style={{ fontSize: 15, lineHeight: 1 }}>{e.liked ? "♥" : "♡"}</span>
          {fmtCount(e.likes)}
        </button>
        <button className={s.action} style={{ color: saveColor }} onClick={() => a.toggleSave(stack.id, e)} aria-pressed={e.saved} aria-label={e.saved ? "Unsave" : "Save"}>
          <BookmarkIcon size={15} color={saveColor} filled={e.saved} />
          {fmtCount(e.saves)}
        </button>
        <button className={s.action} style={{ color: "var(--muted-66)" }} onClick={() => a.fork(stack.id)} aria-label="Fork">
          <ForkIcon size={15} />
          {fmtCount(stack.forks_count)}
        </button>
        <RepostButton stack={stack} className={s.action} size={15} count={fmtCount} />
        <span style={{ flex: 1 }} />
        <ShareButton stack={stack} className={s.action} size={17} />
      </div>
      {deleting && <DeleteStackSheet stackId={stack.id} title={stack.title} onClose={() => setDeleting(false)} />}
    </main>
  );
}
