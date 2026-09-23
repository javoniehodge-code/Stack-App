"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth, useBack, useToast } from "@/components/AppProviders";
import { BackIcon, BookmarkIcon, ForkIcon, LinkIcon } from "@/components/icons";
import { FollowButton } from "@/components/StackCards";
import shell from "@/components/AppShell.module.css";
import { flatten, fmtCount, initials, timeAgo } from "@/lib/format";
import { useEngagement, useIsFollowing } from "@/lib/store";
import { createClient } from "@/lib/supabase/client";
import type { Comment, Stack } from "@/lib/types";
import { useStackActions } from "@/lib/useStackActions";
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
  const [posting, setPosting] = useState(false);

  const likeColor = e.liked ? "var(--accent)" : "var(--muted-66)";
  const saveColor = e.saved ? "var(--accent)" : "var(--muted-66)";

  const startComment = () => requireAuth(() => setComposing(true), "Sign in to join the conversation.");

  async function post(ev: React.FormEvent) {
    ev.preventDefault();
    const body = draft.trim();
    if (!body || !viewer) return;
    setPosting(true);
    const { data, error } = await createClient()
      .from("comments")
      .insert({ stack_id: stack.id, body })
      .select("id,body,created_at")
      .single();
    setPosting(false);
    if (error || !data) {
      toast("Couldn't post your comment. Try again.");
      return;
    }
    setComments((c) => [...c, { ...(data as Omit<Comment, "author">), author: { handle: viewer.handle } }]);
    setDraft("");
    setComposing(false);
  }

  const composer = composing && (
    <form className={s.composer} onSubmit={post}>
      <textarea
        className={s.composerInput}
        value={draft}
        onChange={(ev) => setDraft(ev.target.value.slice(0, 500))}
        placeholder="Share a tip, a favorite, or what you'd add."
        rows={3}
        autoFocus
        aria-label="Comment"
      />
      <div className={s.composerBar}>
        <span className={s.composerCount}>{500 - draft.length}</span>
        <button type="button" className={s.composerCancel} onClick={() => setComposing(false)}>
          Cancel
        </button>
        <button type="submit" className={s.composerPost} disabled={!draft.trim() || posting}>
          {posting ? "Posting…" : "Post"}
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
          {viewer?.id !== stack.author.id && (
            <FollowButton className={s.follow} following={isFollowing} onClick={() => a.toggleFollow(stack.author, isFollowing)} />
          )}
        </div>
        <h1 className={s.title}>{stack.title}</h1>
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
              {comments.map((c) => (
                <div key={c.id} className={s.comment}>
                  <div className={s.commentAuthor}>@{c.author?.handle ?? "deleted"}</div>
                  <div className={s.commentText}>{c.body}</div>
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
        <span style={{ flex: 1 }} />
        <button className={s.action} onClick={() => a.copyLink(stack.id)} aria-label="Copy link">
          <LinkIcon size={16} />
        </button>
      </div>
    </main>
  );
}
