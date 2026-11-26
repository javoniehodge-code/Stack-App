import { Fragment } from "react";
import { linkDomain, richParts, tagInfo } from "@/lib/format";
import type { LineFormat } from "@/lib/types";

export type ViewLine = {
  num: string;
  label: string | null;
  head: string;
  note: string;
  link: string | null;
  /** What the link's pill says (its name, or the domain when left out). */
  linkLabel?: string;
  /** More links, shown as pills after the line's own link: a pick's second link, or an older line's typed addresses. */
  links?: { href: string; label: string }[];
  format: LineFormat;
  /** The pick's tags, shown as chips under it. */
  tags?: string[];
  /** A pick's heading is plain text (no ** bold marks), shown as typed. */
  plain?: boolean;
};

/** A pick's tags as chips: suggested ones with their emoji and group colour, typed ones plain. */
export function TagChips({ tags, className, chipClass }: { tags: string[]; className: string; chipClass: string }) {
  if (!tags.length) return null;
  return (
    <div className={className}>
      {tags.map((t) => {
        const info = tagInfo(t);
        return (
          <span key={t} className={chipClass} data-group={info.group || "own"}>
            {info.emoji && <span aria-hidden>{info.emoji} </span>}
            {info.name}
          </span>
        );
      })}
    </div>
  );
}

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

// UTC so the server and the browser print the same day.
const day = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** The day a published stack was last edited ("Sep 20"), or null if it hasn't been since publishing. */
export function editedDay(publishedAt: string | null, updatedAt?: string | null) {
  // Publishing also stamps updated_at, so only a later change counts as an edit.
  if (!publishedAt || !updatedAt || Date.parse(updatedAt) - Date.parse(publishedAt) <= 60_000) return null;
  return day(updatedAt);
}

/**
 * "Published Sep 3", or "Updated Sep 20" once the author has saved an edit (the Stack page's bottom row). Publishing
 * stamps both dates with the same time, and only edits to the title, description or picks move updated_at, so any
 * later updated_at is an edit, even one saved a few seconds after publishing.
 */
export function dateLabel(publishedAt: string | null, updatedAt?: string | null) {
  if (!publishedAt) return "";
  return updatedAt && Date.parse(updatedAt) > Date.parse(publishedAt) ? `Updated ${day(updatedAt)}` : `Published ${day(publishedAt)}`;
}

/** "📍 Mexico City · Published Nov 24": a place Stack's city, then the date. */
export const metaLabel = (city: string, date: string) => [city && `📍 ${city}`, date].filter(Boolean).join(" · ");
