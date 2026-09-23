import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { fetchFollowing, fetchStack } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";
import DetailScreen from "./DetailScreen";

export async function generateMetadata({ params }: PageProps<"/s/[id]">): Promise<Metadata> {
  const { id } = await params;
  const sb = await createClient();
  const stack = await fetchStack(sb, null, id);
  if (!stack) return { title: "Stack not found" };
  const first = stack.sections.flatMap((x) => x.lines).slice(0, 3).map((l) => l.text).join(" · ");
  return {
    title: stack.title,
    description: `${stack.line_count} lines by @${stack.author.handle}${first ? ` — ${first}` : ""}`,
    openGraph: { title: stack.title, description: first, type: "article" },
  };
}

export default async function StackPage({ params, searchParams }: PageProps<"/s/[id]">) {
  const { id } = await params;
  const { comment } = await searchParams;
  const sb = await createClient();
  const viewerId = await getViewerId(sb);
  const [stack, following] = await Promise.all([fetchStack(sb, viewerId, id), fetchFollowing(sb, viewerId)]);
  if (!stack) notFound();
  return <DetailScreen stack={stack} following={following.includes(stack.author.id)} openComposer={comment === "1"} />;
}
