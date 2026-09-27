import type { SocialKey, Socials } from "./types";

export const SOCIAL_FIELDS: { key: SocialKey; label: string; placeholder: string; group: "social" | "other" }[] = [
  { key: "x", label: "X", placeholder: "@handle", group: "social" },
  { key: "instagram", label: "Instagram", placeholder: "@handle", group: "social" },
  { key: "tiktok", label: "TikTok", placeholder: "@handle", group: "social" },
  { key: "facebook", label: "Facebook", placeholder: "username", group: "social" },
  { key: "youtube", label: "YouTube", placeholder: "@channel", group: "social" },
  { key: "email", label: "Email", placeholder: "you@example.com", group: "other" },
];

/** The custom link's type, shown as its button text. It's stored in the profile's featured_link fields. */
export const CONTACT_TYPES = ["Newsletter", "Bookings", "Website", "Shop", "Portfolio", "Podcast"];

const PROFILE_BASE: Partial<Record<SocialKey, string>> = {
  x: "https://x.com/",
  instagram: "https://instagram.com/",
  tiktok: "https://tiktok.com/@",
  facebook: "https://facebook.com/",
  youtube: "https://youtube.com/@",
};

/** Adds https:// to a bare domain; keeps http(s) and mailto links as they are. */
export function toUrl(v: string) {
  const s = v.trim();
  if (!s) return "";
  return /^(https?:|mailto:)/i.test(s) ? s : "https://" + s;
}

/** The link a filled-in social field points to, or null when it's empty. */
export function socialUrl(key: SocialKey, value: string | undefined) {
  const v = (value ?? "").trim();
  if (!v) return null;
  const base = PROFILE_BASE[key];
  // YouTube channels can also be /channel/… or /c/… links, so pasted URLs are kept as they are.
  if (key === "youtube" && /^(https?:\/\/)?(www\.|m\.)?youtube\.com\//i.test(v)) return toUrl(v);
  if (base) {
    // Accept "@name", "name" or a pasted profile URL.
    const name = v.replace(/^@/, "").replace(/^https?:\/\/[^/]+\/@?/i, "").replace(/\/+$/, "");
    return name ? base + encodeURIComponent(name) : null;
  }
  if (key === "email") return "mailto:" + v.replace(/^mailto:/i, "");
  return toUrl(v);
}

/** Filled-in socials in display order, with their links. */
export function socialLinks(socials: Socials | null | undefined) {
  return SOCIAL_FIELDS.flatMap((f) => {
    const href = socialUrl(f.key, socials?.[f.key]);
    return href ? [{ key: f.key, label: f.label, href }] : [];
  });
}
