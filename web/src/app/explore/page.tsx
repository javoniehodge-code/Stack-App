import type { Metadata } from "next";
import { CATEGORY_DOTS, DEFAULT_DOT, EXPLORE_CATS, plural, stackTheme } from "@/lib/format";
import { stackPath } from "@/lib/links";
import { STACK_SELECT, fetchCategoriesFor, fetchFollowing, publicOnly, searchStacks, withViewerState } from "@/lib/queries";
import { createClient, getViewerId } from "@/lib/supabase/server";
import type { StackRow } from "@/lib/types";
import ExploreScreen from "./ExploreScreen";

export const metadata: Metadata = { title: "Explore" };

export default async function ExplorePage({ searchParams }: PageProps<"/explore">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim().slice(0, 100) : "";
  const sb = await createClient();
  const viewerId = await getViewerId(sb);

  // Public stacks only (unlisted and private ones stay out of Explore).
  const published = (pub: boolean) => {
    const q = sb.from("stacks").select(STACK_SELECT).eq("status", "published");
    return pub ? q.eq("visibility", "public") : q;
  };
  const [trendingRes, recentRes, catsRes, results, following] = await Promise.all([
    publicOnly((pub) => {
      const q = published(pub);
      return (viewerId ? q.neq("author_id", viewerId) : q).order("likes_count", { ascending: false }).limit(4);
    }),
    publicOnly((pub) => published(pub).order("published_at", { ascending: false }).limit(4)),
    sb.rpc("explore_categories", { cats: EXPLORE_CATS }),
    query ? searchStacks(sb, viewerId, query) : Promise.resolve(null),
    query ? fetchFollowing(sb, viewerId) : Promise.resolve([] as string[]),
  ]);

  const trending = await withViewerState(sb, viewerId, (trendingRes.data ?? []) as unknown as StackRow[]);
  const recent = (recentRes.data ?? []) as unknown as StackRow[];
  // Each Trending Stack's category: the author's first choice, or else the one its picks suggest.
  const guessed = await fetchCategoriesFor(sb, trending.filter((t) => !t.categories?.length).map((t) => t.id), [...EXPLORE_CATS, "Shopping"]);
  const trendingCats = Object.fromEntries(trending.map((t) => [t.id, t.categories?.[0] ?? guessed[t.id] ?? ""]));

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
      trendingCats={trendingCats}
      recent={recent.map((r) => ({
        id: r.id,
        href: stackPath(r),
        title: r.title,
        meta: `${r.author.name} · ${plural(r.line_count, "pick")}`,
        ...stackTheme(r),
        publishedAt: r.published_at,
      }))}
      results={results}
      following={following}
    />
  );
}
