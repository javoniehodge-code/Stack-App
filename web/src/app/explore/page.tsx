import type { Metadata } from "next";
import { CATEGORY_DOTS, DEFAULT_DOT, EXPLORE_CATS } from "@/lib/format";
import { STACK_SELECT, fetchCategoriesFor, fetchFollowing, searchStacks, withViewerState } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";
import type { StackRow } from "@/lib/types";
import ExploreScreen from "./ExploreScreen";

export const metadata: Metadata = { title: "Explore" };

export default async function ExplorePage({ searchParams }: PageProps<"/explore">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 100) : "";
  const sb = await createClient();
  const viewerId = await getViewerId(sb);

  let trendingQ = sb.from("stacks").select(STACK_SELECT).eq("status", "published");
  if (viewerId) trendingQ = trendingQ.neq("author_id", viewerId);
  const [trendingRes, recentRes, catsRes, results, following] = await Promise.all([
    trendingQ.order("likes_count", { ascending: false }).limit(4),
    sb.from("stacks").select(STACK_SELECT).eq("status", "published").order("published_at", { ascending: false }).limit(4),
    sb.rpc("explore_categories", { cats: EXPLORE_CATS }),
    query ? searchStacks(sb, viewerId, query) : Promise.resolve(null),
    query ? fetchFollowing(sb, viewerId) : Promise.resolve([] as string[]),
  ]);

  const trending = await withViewerState(sb, viewerId, (trendingRes.data ?? []) as unknown as StackRow[]);
  const recent = (recentRes.data ?? []) as unknown as StackRow[];
  const catOf = await fetchCategoriesFor(sb, recent.map((r) => r.id), [...EXPLORE_CATS, "Shopping"]);

  const categories = ((catsRes.data ?? []) as { name: string; titles: string[] }[]).map((c) => ({
    name: c.name,
    dot: CATEGORY_DOTS[c.name] ?? DEFAULT_DOT,
    samples: c.titles.length ? c.titles : ["Nothing here yet", "Be the first to add one"],
  }));

  return (
    <ExploreScreen
      query={query}
      trending={trending}
      categories={categories}
      recent={recent.map((r) => ({
        id: r.id,
        title: r.title,
        meta: `@${r.author.handle} · ${r.line_count} lines`,
        dot: CATEGORY_DOTS[catOf[r.id]] ?? DEFAULT_DOT,
        publishedAt: r.published_at,
      }))}
      results={results}
      following={following}
    />
  );
}
