-- Rollback for 20261204000000_explore_categories.sql. Run by hand, then mark the migration reverted:
--   supabase migration repair --status reverted 20261204000000
-- Puts back explore_categories (by the older tags) as in 20261003000000_stack_visibility and search_stacks as in
-- 20261005000000_line_notes_location, and removes category_stacks and the index. The app's Explore then shows
-- empty categories until the app is rolled back too.

begin;

drop function if exists public.category_stacks(text);
drop index if exists public.stacks_categories_idx;

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
                and exists (select 1 from stack_tags t where t.stack_id = s.id and lower(t.tag) = lower(c.name))
              order by s.likes_count desc
              limit 2) x
         ), '{}'),
         (select count(*)::int from stacks s
           where s.status = 'published'
             and s.visibility = 'public'
             and not is_blocked_with(s.author_id)
             and exists (select 1 from stack_tags t where t.stack_id = s.id and lower(t.tag) = lower(c.name)))
    from unnest(cats) with ordinality as c(name, ord)
   order by c.ord;
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
       or exists (select 1 from stack_tags t where t.stack_id = s.id and t.tag ilike '%' || btrim(q) || '%')
     )
   order by s.likes_count desc, s.published_at desc
   limit 50;
$$;

commit;

notify pgrst, 'reload schema';
