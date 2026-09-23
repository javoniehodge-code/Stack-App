type P = { size?: number; color?: string };

export function SearchIcon({ size = 20, color = "var(--muted-72)", width = 2 }: P & { width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" aria-hidden>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.6-3.6" />
    </svg>
  );
}

export function BookmarkIcon({ size = 13, color, filled }: P & { filled: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "var(--accent)" : "none"} stroke={color} strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
    </svg>
  );
}

export function ForkIcon({ size = 13, color = "var(--muted-66)" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="5" r="2.2" />
      <circle cx="18" cy="5" r="2.2" />
      <circle cx="12" cy="19" r="2.2" />
      <path d="M6 7.2v1.8a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.2" />
      <path d="M12 12v4.8" />
    </svg>
  );
}

export function LinkIcon({ size = 14, color = "var(--muted-66)" }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2" />
      <path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2" />
    </svg>
  );
}

export function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted-72)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

export function RepostIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--muted-66)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15" />
      <path d="M7 22l-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </svg>
  );
}

export function FeedTabIcon({ color }: { color: string }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M4 6.5h16" />
      <path d="M4 12h16" />
      <path d="M4 17.5h10" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--on-accent)" strokeWidth="3" strokeLinecap="round" aria-hidden>
      <path d="M12 5.5v13" />
      <path d="M5.5 12h13" />
    </svg>
  );
}

export function ProfileTabIcon({ color }: { color: string }) {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="8.5" r="3.7" />
      <path d="M5 19.5c1.4-3.2 4-4.6 7-4.6s5.6 1.4 7 4.6" />
    </svg>
  );
}
