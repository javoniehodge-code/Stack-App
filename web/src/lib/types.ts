/**
 * How a line shows: numbered, bulleted, a paragraph or a bold line. Lines saved before formats existed have
 * none and follow the stack's style.
 */
export type LineFormat = "num" | "bullet" | "text" | "bold";

/**
 * A line of a stack. `text` can have bold words between ** marks. `note` is the separate detail older numbered
 * and bulleted lines had (new lines keep everything in `text`). `linkName` is the name shown on the link's pill
 * instead of its domain, and `linkNames` names web addresses typed into the text (address → name); both are
 * missing until the rich_lines migration has run. `bold` (false for a plain heading) is from before then.
 */
export type Line = {
  text: string;
  link: string | null;
  note?: string | null;
  format?: LineFormat;
  bold?: boolean;
  linkName?: string | null;
  linkNames?: Record<string, string> | null;
  /**
   * A pick's stable id, its tags and its links (up to 2; the first is also in `link` and `linkName`). All missing
   * on lines saved before the pick_model migration.
   */
  id?: string;
  tags?: string[];
  links?: PickLink[];
};
/** One of a pick's links: its web address and the optional name its button shows. */
export type PickLink = { url: string; name?: string };
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
  /** The theme from Finalize (2c); null for a Stack published before it (it then shows the suggested theme). */
  theme_emoji?: string | null;
  theme_color?: string | null;
  /** Whether the Stack is about a place; its city is `location`. */
  is_place?: boolean;
  categories?: string[];
  /** The readable name in its address, /{username}/{slug}: set at first publish, never changed (D-1). */
  slug?: string | null;
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
/** `legacyUrls`: web addresses left in an older line's text when it became a pick, for its owner to resolve. */
export type DraftLine = {
  id?: string;
  text: string;
  link: string;
  note?: string;
  format: LineFormat;
  linkName?: string;
  linkNames?: Record<string, string>;
  tags?: string[];
  links?: PickLink[];
  legacyUrls?: string[];
};
/** `headed` is whether the section shows a heading (the first section can go without one). */
export type DraftSection = { label: string; headed?: boolean; lines: DraftLine[] };
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
  /** The Finalize choices: a theme the author picked (null: suggested from the title), whether it's about a place
   *  (null: guessed from the theme and city), and up to 2 categories. */
  theme?: { emoji: string; color: string } | null;
  isPlace?: boolean | null;
  categories?: string[];
};

/**
 * The published stack being edited in the create screen: whether it can share an update, and its live
 * content (sharing an update needs a change from it).
 */
export type EditTarget = {
  stackId: string;
  visibility: Visibility;
  sharedAt: string | null;
  /** When the stack last changed as the edit began (kept on its edits draft). */
  baseVersion: string | null;
  live: Pick<Draft, "title" | "description" | "sections">;
  /** Its readable name, for its address /{username}/{slug}. */
  slug?: string | null;
};
