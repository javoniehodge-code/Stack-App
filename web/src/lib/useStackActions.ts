"use client";

import { useRouter } from "next/navigation";
import { useAuth, useResume, useToast } from "@/components/AppProviders";
import { createClient } from "./supabase/client";
import { setEngagement, setFollowing, type Engagement } from "./store";
import type { Author } from "./types";
import { profilePath } from "./links";

export function useStackActions() {
  const { viewer, requireAuth } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const sb = createClient();

  // A Like, Save or Follow that asked for a Google sign-in is finished on return (the page reloads in between,
  // so only its name survives). Turning one on twice is harmless, so the database write is simply repeated,
  // and the page then shows the server's state.
  const turnOn = (kind: "likes" | "saves") => (id: string) => {
    if (!id) return;
    sb.from(kind)
      .upsert({ stack_id: id }, { onConflict: "user_id,stack_id", ignoreDuplicates: true })
      .then(({ error }) => (error ? toast("Something went wrong. Try again.") : router.refresh()));
  };
  useResume("like", turnOn("likes"));
  useResume("save", turnOn("saves"));
  useResume("follow", (id) => {
    if (!id) return;
    setFollowing(id, true);
    sb.from("follows")
      .upsert({ followee_id: id }, { onConflict: "follower_id,followee_id", ignoreDuplicates: true })
      .then(({ error }) => {
        if (!error) return router.refresh();
        setFollowing(id, false);
        toast("Something went wrong. Try again.");
      });
  });

  // A viewer who is signed out has nothing liked yet, so the gated action
  // always turns the like/save on once they sign in.
  function toggle(kind: "likes" | "saves", id: string, e: Engagement) {
    const on = kind === "likes" ? !e.liked : !e.saved;
    const next: Engagement =
      kind === "likes"
        ? { ...e, liked: on, likes: Math.max(0, e.likes + (on ? 1 : -1)) }
        : { ...e, saved: on, saves: Math.max(0, e.saves + (on ? 1 : -1)) };
    setEngagement(id, next);
    const req = on
      ? sb.from(kind).upsert({ stack_id: id }, { onConflict: "user_id,stack_id", ignoreDuplicates: true })
      : sb.from(kind).delete().eq("stack_id", id).eq("user_id", viewer?.id ?? "");
    req.then(({ error }) => {
      if (error) {
        setEngagement(id, e);
        toast("Something went wrong. Try again.");
      }
    });
  }

  /** Resolves true once saved, so the sheet can close; rolls back and toasts on failure. */
  async function setRepost(id: string, e: Engagement, on: boolean, note = "") {
    setEngagement(id, { ...e, reposted: on, reposts: Math.max(0, e.reposts + (on ? 1 : -1)), repostNote: on ? note : "" });
    let error;
    if (on) {
      ({ error } = await sb.from("reposts").insert(note ? { stack_id: id, note } : { stack_id: id }));
      // A repost that's already there (another tab) is fine.
      if (error?.code === "23505") error = null;
    } else {
      ({ error } = await sb.from("reposts").delete().eq("stack_id", id).eq("user_id", viewer?.id ?? ""));
    }
    if (error) {
      setEngagement(id, e);
      toast(error.code === "PGRST204" ? "Notes on reposts aren't available yet." : "Something went wrong. Try again.");
      return false;
    }
    toast(on ? "Reposted to your profile" : "Repost removed");
    return true;
  }

  return {
    repost: (id: string, e: Engagement, note: string) => setRepost(id, e, true, note.trim()),
    undoRepost: (id: string, e: Engagement) => setRepost(id, e, false),
    toggleLike: (id: string, e: Engagement) =>
      requireAuth(() => toggle("likes", id, e), "Sign in to like stacks and keep track of what you love.", `like:${id}`),
    toggleSave: (id: string, e: Engagement) =>
      requireAuth(() => toggle("saves", id, e), "Sign in to save stacks to your profile.", `save:${id}`),
    toggleFollow: (author: Author, following: boolean) =>
      requireAuth(() => {
        setFollowing(author.id, !following);
        const req = following
          ? createClient().from("follows").delete().eq("followee_id", author.id).eq("follower_id", viewer?.id ?? "")
          : createClient().from("follows").upsert({ followee_id: author.id }, { onConflict: "follower_id,followee_id", ignoreDuplicates: true });
        req.then(({ error }) => {
          if (error) {
            setFollowing(author.id, following);
            toast("Something went wrong. Try again.");
          }
        });
      }, "Sign in to follow people and build your own feed.", `follow:${author.id}`),
    authorHref: (a: Author) => (viewer && a.id === viewer.id ? "/profile" : profilePath(a.handle)),
  };
}
