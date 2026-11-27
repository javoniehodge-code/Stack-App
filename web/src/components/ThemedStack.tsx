"use client";

import { useState } from "react";
import { LineMarker, LinkPill, RichText, type ViewLine } from "@/components/StackView";
import { TAG_GROUPS, tagInfo } from "@/lib/format";
import t from "./ThemedStack.module.css";

/** A section of picks: its heading (null or "" for none) and its lines. */
export type ThemedSection = { key: string; label: string | null; lines: ViewLine[] };

// Tags show in the tray's order: Highlight, Price, Good for, Know before, When, then typed ones.
const ORDER = new Map(TAG_GROUPS.flatMap((g) => g.tags.map(([name]) => name.toLowerCase())).map((k, i) => [k, i]));
const rank = (tag: string) => ORDER.get(tag.trim().toLowerCase()) ?? 1e6;
const sortTags = (tags: string[]) => [...tags].sort((a, b) => rank(a) - rank(b));
const tagKey = (tag: string) => tag.trim().toLowerCase();
const tagText = (tag: string) => {
  const info = tagInfo(tag);
  return `${info.emoji ? `${info.emoji} ` : ""}${info.name}`;
};

/**
 * A Stack in its theme, as in the design: the theme colour with its emoji wallpaper behind everything, a top row,
 * and the card: a band with the picks count, the author, title, description, the tag filter, the picks (with Pin
 * and Send), then a small row with the city and date at the very bottom. Used by the Stack page and Finalize ›
 * Preview, so the two always match. In the Preview (`preview`) nothing under the title can be tapped.
 */
export function ThemedStack({
  emoji,
  color,
  top,
  author,
  banner,
  title,
  description,
  sections,
  ownerFirst,
  mine,
  meta,
  footer,
  atBottom,
  preview,
  onPin,
  onSend,
}: {
  emoji: string;
  color: string;
  top: React.ReactNode;
  author: React.ReactNode;
  /** Shown between the author and the title (the "Updated: note" line). */
  banner?: React.ReactNode;
  title: string;
  description?: string;
  sections: ThemedSection[];
  /** Before a pick's tags: "{ownerFirst} says" ("You say" on your own Stack). */
  ownerFirst: string;
  /** Your own Stack: the filter's note says the tags are yours. */
  mine: boolean;
  /** The row after the last pick: "📍 Mexico City · Published Nov 24 · Food & Drink". */
  meta: string;
  /** The card's bottom bar. */
  footer?: React.ReactNode;
  /** The card sits at the bottom of the screen, with nothing under it (the Stack page). */
  atBottom?: boolean;
  preview?: boolean;
  onPin?: (ln: ViewLine) => void;
  onSend?: (ln: ViewLine) => void;
}) {
  const [filter, setFilter] = useState<string | null>(null);
  const all = sections.flatMap((sec) => sec.lines.map((ln, i) => ({ ln, label: i === 0 ? sec.label : null, sectionEnd: i === sec.lines.length - 1 })));
  const n = all.length;
  // Every tag used, once, in the tray's order.
  const present = sortTags([...new Map(all.flatMap(({ ln }) => ln.tags ?? []).map((tag) => [tagKey(tag), tag])).values()]);
  const active = filter && present.some((tag) => tagKey(tag) === filter) ? filter : null;
  const shown = active ? all.filter(({ ln }) => (ln.tags ?? []).some((tag) => tagKey(tag) === active)) : all;
  const pick = (tag: string | null) => !preview && setFilter((f) => (tag === null || f === tagKey(tag) ? null : tagKey(tag)));
  const activeName = active ? tagText(present.find((tag) => tagKey(tag) === active)!) : "";

  return (
    <div className={t.pmScreen} style={{ background: color }} data-bottom={atBottom || undefined}>
      <div className={t.pmWallLong} aria-hidden>
        {Array(240).fill(emoji).join("")}
      </div>
      <div className={t.pmTop}>{top}</div>
      <div className={t.pmCardWrap}>
        <article className={t.pmCard}>
          <div className={t.pmBand} style={{ background: color }}>
            <span className={t.pmWallShort} aria-hidden>
              {Array(24).fill(emoji).join("")}
            </span>
            <span className={t.pmPicks}>
              <span aria-hidden>{emoji}</span>
              {n} {n === 1 ? "pick" : "picks"}
            </span>
          </div>
          <div className={t.pmBody}>
            {author}
            {banner}
            <h1 className={t.pmTitle}>{title}</h1>
            {description && <p className={t.pmDesc}>{description}</p>}
            <div style={{ height: 22 }} />
            {present.length > 0 && (
              <div className={t.pmFilter}>
                <div className={t.pmFilterRow} role="group" aria-label="Filter by tag">
                  <button type="button" className={t.pmFilterAll} aria-pressed={!active} tabIndex={preview ? -1 : undefined} onClick={() => pick(null)}>
                    All {n}
                  </button>
                  {present.map((tag) => (
                    <button
                      key={tagKey(tag)}
                      type="button"
                      className={t.pmFilterChip}
                      data-group={tagInfo(tag).group || "own"}
                      aria-pressed={active === tagKey(tag)}
                      tabIndex={preview ? -1 : undefined}
                      onClick={() => pick(tag)}
                    >
                      {tagText(tag)}
                    </button>
                  ))}
                </div>
                <div className={t.pmFilterNote} aria-live="polite">
                  {active ? `Showing ${shown.length} of ${n} · ${activeName}` : mine ? "Your tags. Viewers can filter by them." : "Filter by tag, or tap any tag on a pick"}
                </div>
              </div>
            )}
            {shown.map(({ ln, label, sectionEnd }, i) => {
              const last = i === shown.length - 1 || (!active && sectionEnd);
              return (
                <div key={i}>
                  {!active && label && (
                    <div className={t.pmSecHead} data-first={i === 0 || undefined}>
                      <span className={t.pmSecBar} />
                      <h2 className={t.pmSecLabel}>{label}</h2>
                    </div>
                  )}
                  <div className={t.pmLine} data-last={last || undefined}>
                    <LineMarker ln={ln} numClass={t.pmNum} bulletClass={t.pmBullet} />
                    <div className={t.pmLineBody}>
                      {ln.head && <div className={ln.format === "text" ? t.pmPara : t.pmHead}>{ln.plain ? ln.head : <RichText text={ln.head} />}</div>}
                      {ln.note && <div className={t.pmSub}>{ln.note}</div>}
                      {(ln.link || !!ln.links?.length) && (
                        <div className={t.pmLinks}>
                          {ln.link && <LinkPill href={ln.link} label={ln.linkLabel} className={t.pmLink} />}
                          {ln.links?.map((u) => <LinkPill key={u.href} href={u.href} label={u.label} className={t.pmLink} />)}
                        </div>
                      )}
                      {!!ln.tags?.length && (
                        <div className={t.pmTags}>
                          <span className={t.pmYouSay}>{mine ? "You say" : `${ownerFirst} says`}</span>
                          {sortTags(ln.tags).map((tag) => (
                            <button
                              key={tag}
                              type="button"
                              className={t.pmTag}
                              data-group={tagInfo(tag).group || "own"}
                              aria-label={`Filter by ${tagText(tag)}`}
                              tabIndex={preview ? -1 : undefined}
                              onClick={() => pick(tag)}
                            >
                              {tagText(tag)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className={t.pmPickActions} aria-hidden={preview || undefined}>
                      <button type="button" className={t.pmRound} aria-label="Add to your bucket list" title="Add to your bucket list" tabIndex={preview ? -1 : undefined} onClick={() => onPin?.(ln)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M9 3h6l-1 6 4 4H6l4-4z" />
                          <path d="M12 13v8" />
                        </svg>
                      </button>
                      <button type="button" className={t.pmRound} aria-label="Send this pick" title="Send this pick" tabIndex={preview ? -1 : undefined} onClick={() => onSend?.(ln)}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M21 3L10 14" />
                          <path d="M21 3l-7 18-4-7-7-4z" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
            {meta && <div className={t.pmMeta}>{meta}</div>}
          </div>
          {footer && <div className={t.pmBar}>{footer}</div>}
        </article>
      </div>
    </div>
  );
}

export const themed = t;
