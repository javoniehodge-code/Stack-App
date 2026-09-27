"use client";

import { useBack } from "@/components/AppProviders";
import s from "./Settings.module.css";

/** Back chevron and a centered title, like the design's settings screens, plus anything below it (tabs). */
export default function SettingsHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  const back = useBack();
  return (
    <header className={s.header}>
      <div className={s.headerRow}>
        <button className={s.back} onClick={back} aria-label="Back">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M14.5 5.5L8 12l6.5 6.5" />
          </svg>
        </button>
        <h1 className={s.title}>{title}</h1>
        <span />
      </div>
      {children}
    </header>
  );
}
