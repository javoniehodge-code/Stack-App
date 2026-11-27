import { notFound, redirect } from "next/navigation";
import { stackPath } from "@/lib/links";
import { fetchStack } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";

// /s/{id}: the older address of a Stack. It forwards to the readable one, /{username}/{slug} (agreed Nov 27), keeping
// ?comment=1 and ?from=create (and the browser keeps any #comment-… part).
export default async function StackByIdPage({ params, searchParams }: PageProps<"/s/[id]">) {
  const { id } = await params;
  const { comment, from } = await searchParams;
  const sb = await createClient();
  const stack = await fetchStack(sb, await getViewerId(sb), id);
  if (!stack) notFound();
  const path = stackPath(stack);
  if (path.startsWith("/s/")) notFound();
  const q = new URLSearchParams();
  if (typeof comment === "string") q.set("comment", comment);
  if (typeof from === "string") q.set("from", from);
  redirect(path + (q.size ? `?${q}` : ""));
}
