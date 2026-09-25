import { socialLinks } from "@/lib/socials";
import type { SocialKey, Socials } from "@/lib/types";
import s from "./SocialLinks.module.css";

export function SocialIcon({ name, size = 15 }: { name: SocialKey; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="oklch(80% 0.01 165)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

const ICONS: Record<SocialKey, React.ReactNode> = {
  x: (
    <>
      <path d="M4 4l16 16" />
      <path d="M20 4L4 20" />
    </>
  ),
  instagram: (
    <>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="3.8" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="oklch(80% 0.01 165)" />
    </>
  ),
  tiktok: (
    <>
      <path d="M14 3.5v11.2a3.8 3.8 0 1 1-3.8-3.8" />
      <path d="M14 3.5c.4 2.6 2.2 4.4 5 4.6" />
    </>
  ),
  facebook: <path d="M14 21v-7.5h2.6l.4-3H14V8.6c0-.9.3-1.5 1.6-1.5H17V4.4c-.3 0-1.2-.1-2.3-.1-2.3 0-3.8 1.4-3.8 3.9v2.3H8.3v3h2.6V21" />,
  email: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M4.5 7.5l7.5 5.5 7.5-5.5" />
    </>
  ),
  newsletter: (
    <>
      <path d="M5 4.5h11.5a2 2 0 0 1 2 2V18a1.5 1.5 0 0 0 1.5 1.5H6.5A2.5 2.5 0 0 1 4 17V5.5a1 1 0 0 1 1-1z" />
      <path d="M8 9h7" />
      <path d="M8 12.5h7" />
      <path d="M8 16h4" />
    </>
  ),
  booking: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
      <path d="M9 14.5l2 2 4-4" />
    </>
  ),
  shop: (
    <>
      <path d="M5.5 8.5h13l-1 11h-11z" />
      <path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" />
    </>
  ),
};

/** The row of social icons under a bio. Renders nothing when none are filled in. */
export default function SocialLinks({ socials }: { socials: Socials | null | undefined }) {
  const links = socialLinks(socials);
  if (links.length === 0) return null;
  return (
    <div className={s.row}>
      {links.map((l) => (
        <a key={l.key} className={s.link} href={l.href} target={l.key === "email" ? undefined : "_blank"} rel="noopener noreferrer nofollow" title={l.label} aria-label={l.label}>
          <SocialIcon name={l.key} />
        </a>
      ))}
    </div>
  );
}
