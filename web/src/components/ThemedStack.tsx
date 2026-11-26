import { LineMarker, LinkPill, RichText, type ViewLine } from "@/components/StackView";
import { tagInfo } from "@/lib/format";
import t from "./ThemedStack.module.css";

/** A section of picks: its heading (null or "" for none) and its lines. */
export type ThemedSection = { key: string; label: string | null; lines: ViewLine[] };

/**
 * A Stack in its theme, as in the design: the theme colour with its emoji wallpaper behind everything, a top row,
 * and the card: a band with the picks count, the author, title, description, the picks, then a small row with the
 * city and date at the very bottom. Used by the Stack page and Finalize › Preview, so the two always match.
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
  sayLabel,
  meta,
  actions,
  footer,
  atBottom,
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
  /** Before a pick's tags: "You say" or "Renata says". */
  sayLabel: string;
  /** The row after the last pick: "📍 Mexico City · Published Nov 24". */
  meta: string;
  /** Under each pick (the Preview shows where Pin and Send go). */
  actions?: React.ReactNode;
  /** The card's bottom bar. */
  footer?: React.ReactNode;
  /** The card sits at the bottom of the screen, with nothing under it (the Stack page). */
  atBottom?: boolean;
}) {
  const n = sections.reduce((k, sec) => k + sec.lines.length, 0);
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
            {sections.map((sec, si) => (
              <div key={sec.key}>
                {sec.label !== null && sec.label !== "" && (
                  <div className={t.pmSecHead} data-first={si === 0 || undefined}>
                    <span className={t.pmSecBar} />
                    <h2 className={t.pmSecLabel}>{sec.label}</h2>
                  </div>
                )}
                {sec.lines.map((ln, li) => (
                  <div key={li} className={t.pmLine} data-last={li === sec.lines.length - 1 || undefined}>
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
                          <span className={t.pmYouSay}>{sayLabel}</span>
                          {ln.tags.map((tag) => {
                            const info = tagInfo(tag);
                            return (
                              <span key={tag} className={t.pmTag} data-group={info.group || "own"}>
                                {`${info.emoji ? `${info.emoji} ` : ""}${info.name}`}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {actions}
                    </div>
                  </div>
                ))}
              </div>
            ))}
            {meta && <div className={t.pmMeta}>{meta}</div>}
          </div>
          {footer && <div className={t.pmBar}>{footer}</div>}
        </article>
      </div>
    </div>
  );
}

export const themed = t;
