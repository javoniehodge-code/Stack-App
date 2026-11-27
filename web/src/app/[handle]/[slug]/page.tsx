import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { plainText } from "@/lib/format";
import { stackPath } from "@/lib/links";
import { fetchCurrentHandle, fetchFollowing, fetchProfileByHandle, fetchStackBySlug } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import DetailScreen from "../../s/[id]/DetailScreen";

// A Stack at its readable address, /{username}/{slug} (agreed Nov 27). An old username forwards to the current one;
// /s/{id} forwards here.
const clean = (h: string) => decodeURIComponent(h).replace(/^@/, "").toLowerCase();

async function find(sb: SupabaseClient, viewerId: string | null, handle: string, slug: string) {
  const profile = await fetchProfileByHandle(sb, clean(handle));
  if (!profile) return null;
  return fetchStackBySlug(sb, viewerId, profile.id, decodeURIComponent(slug).toLowerCase());
}

export async function generateMetadata({ params }: PageProps<"/[handle]/[slug]">): Promise<Metadata> {
  const { handle, slug } = await params;
  const stack = await find(await createClient(), null, handle, slug);
  if (!stack) return { title: "Stack not found" };
  const first = stack.sections.flatMap((x) => x.lines).slice(0, 3).map((l) => plainText(l.text)).join(" · ");
  return {
    title: stack.title,
    description: `${stack.line_count} lines by @${stack.author.handle}${first ? ` — ${first}` : ""}`,
    openGraph: { title: stack.title, description: first, type: "article" },
    // Unlisted stacks open from their link but stay out of search engines.
    ...(stack.visibility && stack.visibility !== "public" ? { robots: { index: false } } : {}),
  };
}

export default async function StackBySlugPage({ params, searchParams }: PageProps<"/[handle]/[slug]">) {
  const { handle, slug } = await params;
  const { comment, from } = await searchParams;
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  const [stack, following] = await Promise.all([find(sb, viewerId, handle, slug), fetchFollowing(sb, viewerId)]);
  if (!stack) {
    // A username its owner has since changed: the same Stack under the current one.
    const current = await fetchCurrentHandle(sb, clean(handle));
    if (current) {
      const moved = await find(sb, viewerId, current, slug);
      if (moved) {
        const q = new URLSearchParams();
        if (typeof comment === "string") q.set("comment", comment);
        if (typeof from === "string") q.set("from", from);
        redirect(stackPath(moved) + (q.size ? `?${q}` : ""));
      }
    }
    notFound();
  }
  return <DetailScreen stack={stack} following={following.includes(stack.author.id)} openComposer={comment === "1"} fromCreate={from === "create"} />;
}
