-- The publish checks (Task 3; spec, Flow 1 "Publish", Content rules, Links and D-1, G-6).
--
-- * publish_draft() now also refuses, as the app's red box does on Finalize:
--     - no category ("pick at least 1 category");
--     - a place Stack with no city ("add a city to publish this place stack");
--     - no items ("add at least one item");
--     - a titled section with no items ("a section has no items: add one or remove the section").
-- * stacks.slug: the Stack's readable name for its link, made from the title at first publish and never changed
--   (D-1). Lowercase, accents removed, a–z and 0–9 joined by dashes; "stack" when nothing is left (G-6); -2, -3 …
--   when the same person already has it. Stacks published before this get one now, oldest first. Links still use
--   the Stack's id for now (agreed Nov 26); the readable links come in a later task.
-- * apply_stack_edit() is unchanged: editing a published Stack keeps its slug.

begin;

create or replace function public.stack_slug(t text) returns text language sql immutable set search_path = ''
as $$
  select coalesce(nullif(btrim(left(btrim(regexp_replace(regexp_replace(
           translate(replace(replace(replace(normalize(lower(coalesce(t, '')), NFD), 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'), 'øłđħı', 'oldhi'),
           '[̀-ͯ]', '', 'g'), '[^a-z0-9]+', '-', 'g'), '-'), 60), '-'), ''), 'stack')
$$;

alter table public.stacks add column if not exists slug text;
create unique index if not exists stacks_author_slug on public.stacks (author_id, slug) where slug is not null;

-- Slugs for Stacks already published, oldest first. The write trigger is off for this so updated_at stays as it was.
alter table public.stacks disable trigger stacks_before_write;
do $$
declare
  r record;
  b text;
  s text;
  k int;
begin
  for r in select id, author_id, title from public.stacks where status = 'published' and slug is null
           order by author_id, published_at nulls last, created_at, id loop
    b := public.stack_slug(r.title);
    s := b;
    k := 1;
    while exists (select 1 from public.stacks x where x.author_id = r.author_id and x.slug = s) loop
      k := k + 1;
      s := b || '-' || k;
    end loop;
    update public.stacks set slug = s where id = r.id;
  end loop;
end;
$$;
alter table public.stacks enable trigger stacks_before_write;

-- publish_draft: as in 20261130000000_finalize, with the checks above and the slug.
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
  n      record;
  titled int;
  nslug  text;
  base   text;
  k      int := 1;
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
  if cardinality(cats) = 0 then
    raise exception 'pick at least 1 category' using errcode = '22023';
  end if;
  if place and loc = '' then
    raise exception 'add a city to publish this place stack' using errcode = '22023';
  end if;
  -- Not about a place: no city.
  if not place then
    loc := '';
  end if;
  -- At least one item, and no titled section without items (normalize_sections drops empty sections, so a titled
  -- section that went missing had none).
  select * into n from public.normalize_sections(coalesce(p_sections, '[]'::jsonb));
  if n.line_count = 0 then
    raise exception 'add at least one item' using errcode = '22023';
  end if;
  select count(*) into titled from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) x
   where nullif(public.one_line(x ->> 'label'), '') is not null;
  if titled > (select count(*) from jsonb_array_elements(n.sections) x where x ->> 'label' is not null) then
    raise exception 'a section has no items: add one or remove the section' using errcode = '22023';
  end if;
  -- The slug, fixed now and never changed (D-1): unique among this person's Stacks, with -2, -3 … when taken.
  -- One publish at a time per person, so two at once can't pick the same one.
  perform pg_advisory_xact_lock(hashtextextended('stack_slug:' || uid::text, 0));
  base := public.stack_slug(p_title);
  nslug := base;
  while exists (select 1 from stacks s where s.author_id = uid and s.slug = nslug) loop
    k := k + 1;
    nslug := base || '-' || k;
  end loop;
  forked := d.remixed_from;
  if forked is not null and not exists (
    select 1 from stacks s where s.id = forked and s.status = 'published' and can_open_stack(s)
  ) then
    forked := null;
  end if;

  insert into stacks (id, author_id, title, description, sections, status, forked_from_id, style, visibility, location,
                      theme_emoji, theme_color, is_place, categories, slug)
  values (p_id, uid, btrim(p_title), descr, coalesce(p_sections, '[]'::jsonb), 'published', forked,
          coalesce(p_style, 'numbered'), coalesce(p_visibility, 'public'), loc,
          p_theme_emoji, p_theme_color, place, cats, nslug);

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

notify pgrst, 'reload schema';
