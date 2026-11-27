"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAuth, useBack, useResume, useToast } from "@/components/AppProviders";
import CommentBody from "@/components/CommentBody";
import { BookmarkIcon } from "@/components/icons";
import { RepostButton } from "@/components/Repost";
import { ShareButton } from "@/components/Share";
import { dateLabel, metaLabel, type ViewLine } from "@/components/StackView";
import { themed as t, ThemedStack, type ThemedSection } from "@/components/ThemedStack";
import { useVisibilityEditor } from "@/components/Visibility";
import { MentionList, useMentions } from "@/components/Mentions";
import { FollowButton, UpdateBanner } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import { postComment, thread, threadRoot } from "@/lib/comments";
import { flatten, initials, suggestColor, suggestEmoji } from "@/lib/format";
import { useEngagement, useIsFollowing } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { Comment, Stack } from "@/lib/types";
import { useStackActions } from "@/lib/useStackActions";
import s from "./Detail.module.css";

const noCount = () => "";

/** A stack as a paper card, with its actions in the card's bottom bar and comments in a sheet. */
export default function DetailScreen({
  stack,
  following,
  openComposer,
  fromCreate = false,
}: {
  stack: Stack;
  following: boolean;
  openComposer: boolean;
  /** Opened from "View your Stack" after publishing: show Exit (to your profile) instead of Back. */
  fromCreate?: boolean;
}) {
  const back = useBack();
  const { viewer, requireAuth } = useAuth();
  const toast = useToast();
  const a = useStackActions();
  const e = useEngagement(stack);
  const isFollowing = useIsFollowing(stack.author.id, following);
  const lines = flatten(stack);
  const [comments, setComments] = useState<Comment[]>(stack.comments ?? []);
  // The comments sheet opens straight away from a "comment" link or a comment notification (#comment-<id>).
  const [sheetOpen, setSheetOpen] = useState(openComposer);
  const [draft, setDraft] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; handle: string } | null>(null);
  const [posting, setPosting] = useState(false);
  const mentions = useMentions(draft, setDraft);
  const mine = viewer?.id === stack.author.id;
  const router = useRouter();
  const vis = useVisibilityEditor(() => {
    router.replace("/profile");
    router.refresh();
  });

  // Arriving from a comment notification: open the sheet, then scroll to the comment and highlight it briefly.
  const pendingHash = useRef<string | null>(null);
  useEffect(() => {
    const m = /^#comment-(.+)$/.exec(window.location.hash);
    if (!m) return;
    pendingHash.current = m[1];
    const r = requestAnimationFrame(() => setSheetOpen(true));
    return () => cancelAnimationFrame(r);
  }, []);
  useEffect(() => {
    const id = pendingHash.current;
    if (!sheetOpen || !id) return;
    pendingHash.current = null;
    const el = document.getElementById(`comment-${id}`);
    if (!el) {
      toast("This comment is no longer available.");
      return;
    }
    el.scrollIntoView({ block: "center" });
    el.classList.add(s.commentHighlight);
    const t = setTimeout(() => el.classList.remove(s.commentHighlight), 2000);
    return () => clearTimeout(t);
  }, [sheetOpen, toast]);

  // The design's bar colours: grey ink, pink when on.
  const OFF = "oklch(41.5% 0.035 300)";
  const PINK = "oklch(55% 0.22 350)";
  const likeColor = e.liked ? PINK : OFF;
  const saveColor = e.saved ? PINK : OFF;

  // Replies attach to the top-level comment and start with the person's @handle, so they're notified.
  const beginReply = (c: Comment) => {
    const handle = c.author?.handle;
    setReplyTo({ id: threadRoot(c), handle: handle ?? "deleted" });
    if (handle && handle !== viewer?.handle && !draft.includes(`@${handle}`)) setDraft((d) => `@${handle} ${d}`.slice(0, 500));
  };
  const startReply = (c: Comment) => requireAuth(() => beginReply(c), "Sign in to reply.", `comment:${stack.id}:${c.id}`);

  // Back from a Google sign-in started by commenting or replying: the comments open again with what was typed,
  // and a reply is started on the same comment.
  useResume(
    `comment:${stack.id}`,
    (commentId, state) => {
      setSheetOpen(true);
      const typed = (state as { draft?: unknown } | null)?.draft;
      if (typeof typed === "string") setDraft(typed);
      const c = commentId ? comments.find((x) => x.id === commentId) : null;
      if (c) beginReply(c);
    },
    () => ({ draft }),
  );

  async function post(ev: React.FormEvent) {
    ev.preventDefault();
    const body = draft.trim();
    if (!body) return;
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
    mentions.close();
  }

  const author = (
    <div className={t.pmAuthor}>
      <Link href={a.authorHref(stack.author)} className={s.authorLink}>
        <span className={t.pmAvatar}>{initials(stack.author.name)}</span>
        <span className={`${t.pmName} ${s.authorName}`}>{stack.author.name}</span>
        <span className={`${t.pmHandle} ${s.authorHandle}`}>@{stack.author.handle}</span>
      </Link>
      {!mine && <FollowButton className={s.follow} following={isFollowing} onClick={() => a.toggleFollow(stack.author, isFollowing)} />}
    </div>
  );

  const footer = (
    <>
      <button className={s.barButton} style={{ color: likeColor }} onClick={() => a.toggleLike(stack.id, e)} aria-pressed={e.liked} aria-label={e.liked ? "Unlike" : "Like"}>
        <span style={{ fontSize: 18, lineHeight: 1 }}>{e.liked ? "♥" : "♡"}</span>
      </button>
      <button className={s.barButton} onClick={() => a.toggleSave(stack.id, e)} aria-pressed={e.saved} aria-label={e.saved ? "Unsave" : "Save"}>
        <BookmarkIcon size={17} color={saveColor} filled={e.saved} />
      </button>
      <RepostButton stack={stack} className={s.barButton} size={17} count={noCount} />
      <button
        className={s.commentsButton}
        style={{ color: sheetOpen ? PINK : OFF }}
        onClick={() => setSheetOpen((o) => !o)}
        aria-expanded={sheetOpen}
        aria-label={comments.length ? `Comments, ${comments.length}` : "Comments"}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill={sheetOpen ? "oklch(64% 0.16 50 / 0.15)" : "none"} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
          <path d="M20.5 11.5a8 8 0 0 1-11.6 7.1L3.5 20l1.4-4.6A8 8 0 1 1 20.5 11.5z" />
        </svg>
        {comments.length > 0 && comments.length}
      </button>
      {!mine && (
        <button className={s.remix} onClick={() => toast("Remixing is coming soon.")} aria-label={`Remix, ${stack.forks_count}`}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M4 7h4l8 10h4" />
            <path d="M17 14l3 3-3 3" />
            <path d="M4 17h4l2-2.5" />
            <path d="M14 9.5L16 7h4" />
            <path d="M17 4l3 3-3 3" />
          </svg>
          Remix
          {stack.forks_count > 0 && <span className={s.remixCount}>{stack.forks_count}</span>}
        </button>
      )}
      <span style={{ flex: 1 }} />
      <ShareButton
        stack={stack}
        className={s.share}
        size={16}
        label="Share"
        onPrivate={mine ? () => vis.open(stack, "This stack is private. Make it public or invite only to share it.") : undefined}
      />
    </>
  );

  return (
    <main className={`${shell.screen} ${s.page}`}>
      <ThemedStack
        emoji={stack.theme_emoji ?? suggestEmoji(stack.title)}
        color={stack.theme_color ?? suggestColor(stack.title)}
        top={
          <>
            {fromCreate ? (
              <button onClick={() => router.replace("/profile")} className={t.pmEdit}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
                </svg>
                Exit
              </button>
            ) : (
              <button onClick={back} className={t.pmEdit}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M14.5 5.5L8 12l6.5 6.5" />
                </svg>
                Back
              </button>
            )}
            {/* ⋯: on your own Stack, Edit stack, who can see it, and Delete (as in Manage stacks); on anyone else's,
                Report and Block (coming soon). */}
            <button
              type="button"
              className={s.more}
              aria-label={mine ? "Edit, visibility and delete" : "More options"}
              onClick={() => (mine ? vis.openWithEdit(stack) : toast("Reporting and blocking are coming soon."))}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <circle cx="5" cy="12" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="19" cy="12" r="2" />
              </svg>
            </button>
          </>
        }
        author={author}
        banner={<UpdateBanner stack={stack} className={s.update} />}
        title={stack.title}
        description={stack.description}
        sections={sectionsOf(lines)}
        ownerFirst={mine ? "You" : stack.author.name.trim().split(/\s+/)[0] || stack.author.handle}
        mine={mine}
        onPin={() => toast("Pinning picks to your bucket list is coming soon.")}
        onSend={() => toast("Sending picks is coming soon.")}
        meta={metaLabel(stack.is_place ? (stack.location ?? "").trim() : "", dateLabel(stack.published_at, stack.updated_at), stack.categories ?? [])}
        footer={footer}
        atBottom
      />

      {sheetOpen && (
        <div className={s.scrim} onClick={() => setSheetOpen(false)}>
          <div className={s.sheet} onClick={(ev) => ev.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="comments-title">
            <div className={s.sheetHead}>
              <div className={s.grabber} />
              <div className={s.sheetTitleRow}>
                <span />
                <span id="comments-title" className={s.sheetTitle}>
                  Comments
                </span>
                <button className={s.hide} onClick={() => setSheetOpen(false)}>
                  Hide
                </button>
              </div>
            </div>
            <div className={s.commentList}>
              {thread(comments).map(({ comment: c, isReply }) => (
                <div key={c.id} id={`comment-${c.id}`} className={`${s.comment} ${isReply ? s.reply : ""}`}>
                  <span className={s.commentAvatar}>{(c.author?.handle ?? "?").charAt(0).toUpperCase()}</span>
                  <div className={s.commentMain}>
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
              {comments.length === 0 && (
                <div className={s.noComments}>
                  <div className={s.noCommentsTitle}>No comments yet</div>
                  <div className={s.noCommentsText}>Share a tip, a favorite, or what you&apos;d add.</div>
                </div>
              )}
            </div>
            <form className={s.composer} onSubmit={post}>
              {replyTo && (
                <div className={s.replyingTo}>
                  Replying to <span className={s.replyingHandle}>@{replyTo.handle}</span>
                  <button type="button" className={s.replyingClear} onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                    ×
                  </button>
                </div>
              )}
              <div className={s.composerRow}>
                <div className={s.composerField}>
                  <MentionList {...mentions} />
                  <textarea
                    className={s.composerInput}
                    value={draft}
                    rows={1}
                    onFocus={() => !viewer && requireAuth(null, "Sign in to join the conversation.", `comment:${stack.id}`)}
                    onChange={(ev) => {
                      setDraft(ev.target.value.slice(0, 500));
                      mentions.track(ev.target);
                    }}
                    onKeyDown={(ev) => mentions.onKeyDown(ev)}
                    onBlur={mentions.close}
                    placeholder={replyTo ? "Write a reply…" : "Add a comment…"}
                    aria-label={replyTo ? `Reply to @${replyTo.handle}` : "Comment"}
                  />
                </div>
                <button type="submit" className={s.post} disabled={!draft.trim() || posting}>
                  {posting ? "Posting…" : replyTo ? "Reply" : "Post"}
                </button>
              </div>
              {draft.length > 400 && <div className={s.composerCount}>{500 - draft.length} left</div>}
            </form>
          </div>
        </div>
      )}
      {vis.sheet}
    </main>
  );
}

/** The flat lines back into their sections: a new one starts at each section's first line. */
function sectionsOf(lines: ViewLine[]): ThemedSection[] {
  const out: ThemedSection[] = [];
  lines.forEach((ln) => {
    if (ln.label !== null || !out.length) out.push({ key: String(out.length), label: ln.label, lines: [] });
    out[out.length - 1].lines.push(ln);
  });
  return out;
}
