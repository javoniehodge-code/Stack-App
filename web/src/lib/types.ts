export type Line = { text: string; link: string | null };
export type Section = { label: string | null; lines: Line[] };

export type Author = { id: string; handle: string; name: string };

export type Comment = { id: string; body: string; created_at: string; author: { handle: string } | null };

export type StackRow = {
  id: string;
  title: string;
  sections: Section[];
  style: "numbered" | "bulleted";
  status: "draft" | "published";
  forked_from_id: string | null;
  line_count: number;
  likes_count: number;
  saves_count: number;
  forks_count: number;
  comments_count: number;
  created_at: string;
  published_at: string | null;
  author: Author;
  comments?: Comment[];
};

/** A stack plus whether the current viewer has liked/saved it. */
export type Stack = StackRow & { liked: boolean; saved: boolean };

export type SocialKey = "x" | "instagram" | "tiktok" | "facebook" | "email" | "newsletter" | "booking" | "shop";
export type Socials = Partial<Record<SocialKey, string>>;

export type Profile = {
  id: string;
  handle: string;
  name: string;
  bio: string;
  socials: Socials;
  pinned_stack_id: string | null;
  pin_note: string;
  featured_link_label: string | null;
  featured_link_url: string | null;
};

/** A draft being edited in the create screen. */
export type DraftLine = { text: string; link: string; linkOpen?: boolean };
export type DraftSection = { label: string; lines: DraftLine[] };
export type Draft = {
  id: string | null;
  title: string;
  sections: DraftSection[];
  tags: string[];
  style: "numbered" | "bulleted";
  forkedFromId: string | null;
};
