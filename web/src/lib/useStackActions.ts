"use client";

import { useRouter } from "next/navigation";
import { useAuth, useToast } from "@/components/AppProviders";
import { createClient } from "./supabase/client";
import { setEngagement, setFollowing, type Engagement } from "./store";
import type { Author } from "./types";

export function useStackActions() {
  const router = useRouter();
  const { viewer, requireAuth } = useAuth();
  const toast = useToast();
  const sb = createClient();

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

  return {
    toggleLike: (id: string, e: Engagement) =>
      requireAuth(() => toggle("likes", id, e), "Sign in to like stacks and keep track of what you love."),
    toggleSave: (id: string, e: Engagement) =>
      requireAuth(() => toggle("saves", id, e), "Sign in to save stacks to your profile."),
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
      }, "Sign in to follow people and build your own feed."),
    fork: (id: string) => router.push(`/create?fork=${id}`),
    copyLink: async (id: string) => {
      const url = `${window.location.origin}/s/${id}`;
      try {
        await navigator.clipboard.writeText(url);
        toast("Link copied to clipboard");
      } catch {
        toast("Couldn't copy the link");
      }
    },
    authorHref: (a: Author) => (viewer && a.id === viewer.id ? "/profile" : `/u/${a.handle}`),
  };
}
