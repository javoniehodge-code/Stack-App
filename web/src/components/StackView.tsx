import { Fragment } from "react";
import { linkDomain, richParts } from "@/lib/format";
import type { LineFormat } from "@/lib/types";
import v from "./StackView.module.css";

export type ViewLine = {
  num: string;
  label: string | null;
  head: string;
  note: string;
  link: string | null;
  /** What the link's pill says (its name, or the domain when left out). */
  linkLabel?: string;
  /** Web addresses typed into the text, shown as pills before the line's own link. */
  links?: { href: string; label: string }[];
  format: LineFormat;
};

/** Text with its ** marked words in bold. */
export function RichText({ text }: { text: string }) {
  return (
    <>
      {richParts(text).map((p, i) => (p.bold ? <strong key={i}>{p.text}</strong> : <Fragment key={i}>{p.text}</Fragment>))}
    </>
  );
}

/** A line's marker: its number, an orange dot for a bulleted line, nothing for paragraphs and bold lines. */
export function LineMarker({ ln, numClass, bulletClass }: { ln: Pick<ViewLine, "num" | "format">; numClass: string; bulletClass: string }) {
  if (ln.format === "num") return <span className={numClass}>{ln.num}</span>;
  if (ln.format === "bullet")
    return (
      <span className={bulletClass} aria-hidden>
        <span />
      </span>
    );
  return null;
}

export { linkDomain };

/** A line's link: a chain icon and its name (or the site's domain), in a blue pill (style it with `className`). */
export function LinkPill({ href, label, className, size = 11 }: { href: string; label?: string; className: string; size?: number }) {
  return (
    <a className={className} href={href} target="_blank" rel="noopener noreferrer nofollow ugc" title={href} onClick={(e) => e.stopPropagation()}>
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0 }}>
        <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
        <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
      </svg>
      <span>{label || linkDomain(href)}</span>
    </a>
  );
}

/**
 * The stack as a paper card: "stack." and when it was updated on top, then the
 * author row, title, description and lines (numbered, bulleted, paragraphs, bold) grouped by section, and
 * a bottom bar (likes, saves… or nothing in a preview).
 */
export function StackPaper({
  updated,
  author,
  title,
  description,
  lines,
  footer,
  banner,
}: {
  updated: string;
  author: React.ReactNode;
  /** Shown between the author and the title (the "Updated: note" line). */
  banner?: React.ReactNode;
  title: string;
  description?: string;
  lines: ViewLine[];
  footer?: React.ReactNode;
}) {
  return (
    <article className={v.card}>
      <div className={v.top}>
        <span className={v.logo}>
          stack<span className={v.dot}>.</span>
        </span>
        <span className={v.updated}>{updated}</span>
      </div>
      <div className={v.body}>
        {author}
        {banner}
        <h1 className={v.title}>{title}</h1>
        {description && <p className={v.desc}>{description}</p>}
        <div className={v.gap} />
        {lines.map((ln, i) => {
          // A line gets a divider unless it's the last one in its subsection.
          const next = lines[i + 1];
          const last = !next || !!next.label;
          return (
            <Fragment key={i}>
              {ln.label && <div className={`${v.label} ${i === 0 ? v.labelFirst : ""}`}>{ln.label}</div>}
              <div className={`${v.line} ${last ? "" : v.divided}`}>
                <LineMarker ln={ln} numClass={v.num} bulletClass={v.bullet} />
                <div className={v.lineBody}>
                  {ln.head && (
                    <div className={ln.format === "text" ? v.para : ln.format === "bold" ? v.boldLine : v.head}>
                      <RichText text={ln.head} />
                    </div>
                  )}
                  {ln.note && <div className={v.note}>{ln.note}</div>}
                  {(ln.link || !!ln.links?.length) && (
                    <div className={v.pills}>
                      {ln.links?.map((u) => <LinkPill key={u.href} href={u.href} label={u.label} className={v.visit} />)}
                      {ln.link && <LinkPill href={ln.link} label={ln.linkLabel} className={v.visit} />}
                    </div>
                  )}
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      {footer && <div className={v.bar}>{footer}</div>}
    </article>
  );
}

// UTC so the server and the browser print the same day.
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The day a published stack was last edited ("Sep 20"), or null if it hasn't been since publishing. */
export function editedDay(publishedAt: string | null, updatedAt?: string | null) {
  // Publishing also stamps updated_at, so only a later change counts as an edit.
  if (!publishedAt || !updatedAt || Date.parse(updatedAt) - Date.parse(publishedAt) <= 60_000) return null;
  return day(updatedAt);
}

/** "Published Sep 3", plus "· Updated Sep 20" once the author has edited it since. */
export function publishedLabel(publishedAt: string | null, updatedAt?: string | null) {
  if (!publishedAt) return "";
  const edited = editedDay(publishedAt, updatedAt);
  return `Published ${day(publishedAt)}${edited ? ` · Updated ${edited}` : ""}`;
}
