/** A line of a stack. `note` is missing until the line_notes_location migration has run. */
export type Line = { text: string; link: string | null; note?: string | null };
export type Section = { label: string | null; lines: Line[] };

export type Author = { id: string; handle: string; name: string };

export type Comment = {
  id: string;
  body: string;
  created_at: string;
  /** The comment this replies to. Missing until the comment_replies migration has run. */
  parent_id?: string | null;
  author: { handle: string } | null;
};

/** Who can see a stack: everyone, people with the link, or only the author. */
export type Visibility = "public" | "unlisted" | "private";

export type StackRow = {
  id: string;
  title: string;
  /** Missing until the stack_description migration has run. */
  description?: string;
  sections: Section[];
  style: "numbered" | "bulleted";
  status: "draft" | "published";
  forked_from_id: string | null;
  line_count: number;
  likes_count: number;
  saves_count: number;
  forks_count: number;
  comments_count: number;
  /** Missing until the reposts migration has run. */
  reposts_count?: number;
  /** Missing until the stack_visibility migration has run (everything is public then). */
  visibility?: Visibility;
  /** City or area; missing until the line_notes_location migration has run. */
  location?: string;
  updated_at?: string;
  /** Edit mode columns; missing until the edit_published_stacks migration has run. */
  edit_of?: string | null;
  /** When the author last shared an update to the feed, and its note (up to 40 characters). */
  shared_at?: string | null;
  update_note?: string;
  created_at: string;
  published_at: string | null;
  author: Author;
  comments?: Comment[];
};

/** A stack plus whether the current viewer has liked/saved/reposted it. */
export type Stack = StackRow & { liked: boolean; saved: boolean; reposted?: boolean; repost_note?: string };

/** A Following feed entry: the stack, and who reposted it when that's why it's there. */
export type FeedItem = Stack & { repost?: { by: Author; note: string } };

/** A row in your own Reposts tab. */
export type MyRepost = { stack: Stack; note: string };

export type SocialKey = "x" | "instagram" | "tiktok" | "facebook" | "youtube" | "email" | "newsletter" | "booking" | "shop";
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
  /** Whether the profile shows follower and following counts. Missing (hidden) before the edit_published_stacks migration. */
  show_follow_counts?: boolean;
};

/** A draft being edited in the create screen. */
export type DraftLine = { text: string; link: string; note?: string; linkOpen?: boolean };
export type DraftSection = { label: string; lines: DraftLine[] };
export type Draft = {
  id: string | null;
  title: string;
  description: string;
  sections: DraftSection[];
  tags: string[];
  style: "numbered" | "bulleted";
  forkedFromId: string | null;
  visibility: Visibility;
  location: string;
};

/** The published stack being edited in the create screen: whether it can share an update, and why not. */
export type EditTarget = { stackId: string; visibility: Visibility; sharedAt: string | null };
