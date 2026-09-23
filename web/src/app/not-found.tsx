import Link from "next/link";
import shell from "@/components/AppShell.module.css";
import s from "./Feed.module.css";

export default function NotFound() {
  return (
    <main className={`${shell.screen} ${s.empty}`}>
      <div className={s.emptyTitle}>Nothing here</div>
      <div className={s.emptyText}>This stack or profile doesn&apos;t exist, or it hasn&apos;t been published.</div>
      <Link href="/" className={s.emptyCta}>
        Back to the feed
      </Link>
    </main>
  );
}
