import { Fragment } from "react";
import v from "./StackView.module.css";

export type ViewLine = { num: string; label: string | null; head: string; note: string; link: string | null };

/**
 * The stack as a paper card: "stack." and when it was updated on top, then the
 * author row, title, description and numbered lines grouped by subsection, and
 * a bottom bar (likes, saves… or nothing in a preview).
 */
export function StackPaper({
  updated,
  author,
  title,
  description,
  lines,
  footer,
}: {
  updated: string;
  author: React.ReactNode;
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
                <span className={v.num}>{ln.num}</span>
                <div className={v.lineBody}>
                  <div className={v.head}>{ln.head}</div>
                  {ln.note && <div className={v.note}>{ln.note}</div>}
                  {ln.link && (
                    <a className={v.visit} href={ln.link} target="_blank" rel="noopener noreferrer nofollow ugc" title={ln.link}>
                      Visit site ↗
                    </a>
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

/** "Updated 3d ago · 6 lines" / "Updated just now · 1 line". */
export function updatedLabel(ago: string, count: number) {
  const when = !ago || ago === "just now" ? "just now" : `${ago} ago`;
  return `Updated ${when} · ${count} ${count === 1 ? "line" : "lines"}`;
}
