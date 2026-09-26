import Link from "next/link";
import { MENTION_RE } from "@/lib/comments";

/** Comment text with @handles linked to the person's profile. */
export default function CommentBody({ text, linkClass }: { text: string; linkClass?: string }) {
  const out: React.ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(MENTION_RE)) {
    const handle = m[2].replace(/\.+$/, "");
    const start = m.index + m[1].length;
    out.push(text.slice(last, start));
    out.push(
      <Link key={start} href={`/u/${handle.toLowerCase()}`} className={linkClass} onClick={(e) => e.stopPropagation()}>
        @{handle}
      </Link>,
    );
    last = start + 1 + handle.length;
  }
  out.push(text.slice(last));
  return <>{out}</>;
}
