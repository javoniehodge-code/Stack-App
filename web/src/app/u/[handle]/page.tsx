import { redirect } from "next/navigation";
import { profilePath } from "@/lib/links";

// /u/{username}: the older address of a profile. It forwards to the readable one, /{username} (agreed Nov 27).
export default async function OldProfilePage({ params }: PageProps<"/u/[handle]">) {
  const { handle } = await params;
  redirect(profilePath(decodeURIComponent(handle).replace(/^@/, "")));
}
