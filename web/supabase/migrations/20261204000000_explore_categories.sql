-- Categories in Explore and search (agreed Nov 27, part 2 of showing the Finalize choices). Explore and search use
-- the categories chosen in Finalize (stacks.categories, up to 2 of the 12), not the older free-form tags.
--
-- * explore_categories(): each category's two most-liked Stacks and its count, by stacks.categories.
-- * category_stacks(): the Stacks in one category, for tapping a category in Explore (choice 2A: only Stacks in that
--   category, not a text search for its name).
-- * search_stacks(): also matches a category's name ("food" finds Stacks in Food & Drink), and still matches the
--   title, city, name, @username and the older tags.
-- * An index on stacks.categories for the two lookups by category.
-- Nothing is changed or removed in the data.

begin;

create index if not exists stacks_categories_idx on public.stacks using gin (categories);

create or replace function public.explore_categories(cats text[])
returns table (name text, titles text[], total int)
language sql
stable
security definer
set search_path = public
as $$
  select c.name,
         coalesce((
           select array_agg(x.title) from (
             select s.title from stacks s
              where s.status = 'published'
                and s.visibility = 'public'
                and not is_blocked_with(s.author_id)
                and s.categories @> array[c.name]
              order by s.likes_count desc, s.published_at desc
              limit 2) x
         ), '{}'),
         (select count(*)::int from stacks s
           where s.status = 'published'
             and s.visibility = 'public'
             and not is_blocked_with(s.author_id)
             and s.categories @> array[c.name])
    from unnest(cats) with ordinality as c(name, ord)
   order by c.ord;
$$;

create or replace function public.category_stacks(cat text)
returns setof public.stacks
language sql
stable
security definer
set search_path = public
as $$
  select s.*
    from stacks s
   where s.status = 'published'
     and s.visibility = 'public'
     and not is_blocked_with(s.author_id)
     and s.categories @> array[cat]
   order by s.likes_count desc, s.published_at desc
   limit 50;
$$;

create or replace function public.search_stacks(q text)
returns setof public.stacks
language sql
stable
security definer
set search_path = public
as $$
  select s.*
    from stacks s
    join profiles p on p.id = s.author_id
   where s.status = 'published'
     and s.visibility = 'public'
     and not is_blocked_with(s.author_id)
     and btrim(coalesce(q, '')) <> ''
     and (
       s.title ilike '%' || btrim(q) || '%'
       or s.location ilike '%' || btrim(q) || '%'
       or p.name ilike '%' || btrim(q) || '%'
       or ('@' || p.handle) ilike '%' || btrim(q) || '%'
       or exists (select 1 from unnest(s.categories) c where c ilike '%' || btrim(q) || '%')
       or exists (select 1 from stack_tags t where t.stack_id = s.id and t.tag ilike '%' || btrim(q) || '%')
     )
   order by s.likes_count desc, s.published_at desc
   limit 50;
$$;

commit;

notify pgrst, 'reload schema';
