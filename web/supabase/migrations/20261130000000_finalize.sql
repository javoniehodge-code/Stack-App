-- The Finalize choices on published Stacks (Task 2c; spec, Flow 1 step 4).
--
-- * stacks.theme_emoji and stacks.theme_color: the Stack's theme, one of 12 emoji and one of 6 colours (null for
--   Stacks published before this).
-- * stacks.is_place: whether the Stack is about a place. Its city stays in stacks.location (up to 80 characters).
-- * stacks.categories: up to 2 of the 12 platform categories.
-- * publish_draft() takes the four choices (all optional, so older app versions still work). A Stack answered "not
--   about a place" keeps no city; when the answer is left out (an older app version), a city means it is one, and the
--   city is kept.
-- * Requiring a city for a place Stack and at least one category comes with the publish checks (Task 3).
-- * apply_stack_edit() is unchanged: editing a published Stack keeps its choices.

begin;

-- The lists, kept in one place for the checks below (the app has the same lists: web/src/lib/format.ts).
create or replace function public.theme_emojis() returns text[] language sql immutable set search_path = ''
as $$ select array['🍸', '🍜', '☕', '📖', '✈️', '🛍️', '🖥️', '🎧', '🌮', '🌴', '🎨', '✨'] $$;
create or replace function public.theme_colors() returns text[] language sql immutable set search_path = ''
as $$ select array['oklch(86% 0.13 85)', 'oklch(84% 0.12 40)', 'oklch(84% 0.09 260)', 'oklch(85% 0.1 160)', 'oklch(85% 0.1 340)', 'oklch(88% 0.12 110)'] $$;
create or replace function public.stack_categories_list() returns text[] language sql immutable set search_path = ''
as $$ select array['Art & Design', 'Technology', 'Business & Money', 'Learning', 'Health & Wellness', 'Food & Drink',
                   'Travel & Places', 'Style & Shopping', 'Home & Living', 'Entertainment & Culture', 'Sports & Outdoors',
                   'Games & Hobbies'] $$;

alter table public.stacks
  add column if not exists theme_emoji text,
  add column if not exists theme_color text,
  add column if not exists is_place boolean not null default false,
  add column if not exists categories text[] not null default '{}';

alter table public.stacks drop constraint if exists stacks_theme_emoji_valid;
alter table public.stacks add constraint stacks_theme_emoji_valid check (theme_emoji is null or theme_emoji = any (public.theme_emojis()));
alter table public.stacks drop constraint if exists stacks_theme_color_valid;
alter table public.stacks add constraint stacks_theme_color_valid check (theme_color is null or theme_color = any (public.theme_colors()));
alter table public.stacks drop constraint if exists stacks_categories_valid;
alter table public.stacks add constraint stacks_categories_valid
  check (cardinality(categories) <= 2 and categories <@ public.stack_categories_list());

-- publish_draft: as in 20261129000000_pick_model, plus the Finalize choices. The old signature goes, so a call
-- with only the earlier arguments (an older app version) reaches this one, with the choices left out.
drop function if exists public.publish_draft(uuid, text, jsonb, text[], text, text, text, text);

create or replace function public.publish_draft(
  p_id          uuid,
  p_title       text,
  p_sections    jsonb,
  p_tags        text[],
  p_style       text default 'numbered',
  p_description text default null,
  p_visibility  text default null,
  p_location    text default null,
  p_theme_emoji text default null,
  p_theme_color text default null,
  p_is_place    boolean default null,
  p_categories  text[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid    uuid := auth.uid();
  d      drafts;
  descr  text := public.one_line(p_description);
  loc    text := btrim(coalesce(p_location, ''));
  forked uuid;
  t      text;
  cats   text[] := coalesce(p_categories, '{}');
  -- Left out (an older app version, which has no place question): a Stack with a city is about a place, so its
  -- city is kept. An explicit No from the new app clears the city below.
  place  boolean := coalesce(p_is_place, btrim(coalesce(p_location, '')) <> '');
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select * into d from drafts where id = p_id and owner_id = uid for update;
  -- Published already (this is a retry, whose save may have brought the draft back): the same answer, the draft
  -- removed, and nothing new.
  if exists (select 1 from stacks s where s.id = p_id and s.author_id = uid and s.status = 'published') then
    delete from drafts where id = p_id and owner_id = uid;
    return p_id;
  end if;
  if not found then
    raise exception 'draft not found' using errcode = 'P0002';
  end if;
  if d.edit_of is not null then
    raise exception 'edits to a published stack are saved, not published' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'add a title' using errcode = '22023';
  end if;
  if p_visibility is not null and p_visibility not in ('public', 'unlisted', 'private') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;
  if char_length(descr) > 160 then
    raise exception 'descriptions are limited to 160 characters' using errcode = '22023';
  end if;
  if char_length(loc) > 80 then
    raise exception 'locations are limited to 80 characters' using errcode = '22023';
  end if;
  if p_theme_emoji is not null and not (p_theme_emoji = any (public.theme_emojis())) then
    raise exception 'pick one of the theme emoji' using errcode = '22023';
  end if;
  if p_theme_color is not null and not (p_theme_color = any (public.theme_colors())) then
    raise exception 'pick one of the theme colours' using errcode = '22023';
  end if;
  if not (cats <@ public.stack_categories_list()) then
    raise exception 'pick categories from the list' using errcode = '22023';
  end if;
  if cardinality(cats) > 2 or cardinality(cats) <> cardinality(array(select distinct unnest(cats))) then
    raise exception 'a stack can have up to 2 different categories' using errcode = '22023';
  end if;
  -- Not about a place: no city.
  if not place then
    loc := '';
  end if;
  forked := d.remixed_from;
  if forked is not null and not exists (
    select 1 from stacks s where s.id = forked and s.status = 'published' and can_open_stack(s)
  ) then
    forked := null;
  end if;

  insert into stacks (id, author_id, title, description, sections, status, forked_from_id, style, visibility, location,
                      theme_emoji, theme_color, is_place, categories)
  values (p_id, uid, btrim(p_title), descr, coalesce(p_sections, '[]'::jsonb), 'published', forked,
          coalesce(p_style, 'numbered'), coalesce(p_visibility, 'public'), loc,
          p_theme_emoji, p_theme_color, place, cats);

  if p_tags is not null then
    if array_length(p_tags, 1) > 20 then
      raise exception 'a stack can have at most 20 tags' using errcode = '22023';
    end if;
    foreach t in array p_tags loop
      t := btrim(regexp_replace(t, '^#', ''));
      continue when t = '';
      insert into stack_tags (stack_id, tag) values (p_id, left(t, 40)) on conflict do nothing;
    end loop;
  end if;

  delete from drafts where id = p_id and owner_id = uid;
  return p_id;
end;
$$;

revoke execute on function public.publish_draft(uuid, text, jsonb, text[], text, text, text, text, text, text, boolean, text[]) from public, anon;
grant execute on function public.publish_draft(uuid, text, jsonb, text[], text, text, text, text, text, text, boolean, text[]) to authenticated;

commit;

-- The API picks up publish_draft's new arguments.
notify pgrst, 'reload schema';
