"use client";

import { useSyncExternalStore } from "react";
import type { Stack } from "./types";

// Optimistic engagement state shared across screens, so a like on the feed
// shows up on the stack page without a refetch. Entries exist only for stacks
// or people the viewer has touched in this session; otherwise the server copy wins.

export type Engagement = { liked: boolean; saved: boolean; likes: number; saves: number };

const engagement = new Map<string, Engagement>();
const follows = new Map<string, boolean>();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version++;
  listeners.forEach((l) => l());
}
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
const getVersion = () => version;

export function useEngagement(stack: Stack): Engagement {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return engagement.get(stack.id) ?? { liked: stack.liked, saved: stack.saved, likes: stack.likes_count, saves: stack.saves_count };
}

export function setEngagement(id: string, e: Engagement) {
  engagement.set(id, e);
  emit();
}

export function useIsFollowing(userId: string, initial: boolean) {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return follows.get(userId) ?? initial;
}

export function setFollowing(userId: string, value: boolean) {
  follows.set(userId, value);
  emit();
}

/** Called when the viewer changes; server data is refetched afterwards. */
export function resetStore() {
  engagement.clear();
  follows.clear();
  emit();
}
