-- The publish checks (Task 3; spec, Flow 1 "Publish", Content rules, Links and D-1, G-6).
--
-- * check_publishable(): what every publish needs, as the app's red box on Finalize says:
--     - a title ("add a title");
--     - at least 1 category ("pick at least 1 category");
--     - a city for a place Stack ("add a city to publish this place stack"), up to 80 characters;
--     - at least one item ("add at least one item");
--     - no titled section without items ("a section has no items: add one or remove the section").
-- * publish_draft() and the older save_stack() both use it. save_stack() still saves drafts as before; publishing
--   through it (older app versions, which have no category question) is refused.
-- * stacks.slug: the Stack's readable name for its link, made from the title at first publish and never changed
--   (D-1). Lowercase, accents removed, a–z and 0–9 joined by dashes; "stack" when nothing is left (G-6); -2, -3 …
--   when the same person already has it.
--     - A trigger sets it whenever a Stack becomes published, whichever way, and keeps it once set.
--     - Stacks published before this get one now, oldest first.
--     - A check makes sure no published Stack is without one.
--     - Links still use the Stack's id for now (agreed Nov 26); the readable links come in a later task.
-- * apply_stack_edit() is unchanged: editing a published Stack keeps its slug.

begin;

-- No other writes to stacks while the slugs are filled in and the check is added.
lock table public.stacks in share row exclusive mode;

create or replace function public.stack_slug(t text) returns text language sql immutable set search_path = ''
as $$
  select coalesce(nullif(btrim(left(btrim(regexp_replace(regexp_replace(
           translate(replace(replace(replace(normalize(lower(coalesce(t, '')), NFD), 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'), 'øłđħı', 'oldhi'),
           '[\u0300-\u036f]', '', 'g'), '[^a-z0-9]+', '-', 'g'), '-'), 60), '-'), ''), 'stack')
$$;

alter table public.stacks add column if not exists slug text;
create unique index if not exists stacks_author_slug on public.stacks (author_id, slug) where slug is not null;

-- The next free slug for this person's title. One at a time per person, so two publishes at once can't take the
-- same one.
create or replace function public.claim_stack_slug(p_author uuid, p_title text)
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  base text := public.stack_slug(p_title);
  s    text := base;
  k    int := 1;
begin
  perform pg_advisory_xact_lock(hashtextextended('stack_slug:' || p_author::text, 0));
  while exists (select 1 from public.stacks x where x.author_id = p_author and x.slug = s) loop
    k := k + 1;
    s := base || '-' || k;
  end loop;
  return s;
end;
$$;
revoke execute on function public.claim_stack_slug(uuid, text) from public, anon, authenticated;

-- Sets the slug when a Stack becomes published, and keeps it once set. Runs after stacks_before_write (triggers
-- run in name order), so the title is already tidied.
create or replace function public.stacks_set_slug()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.slug is not null then
    new.slug := old.slug;
  elsif new.status = 'published' and new.slug is null then
    new.slug := public.claim_stack_slug(new.author_id, new.title);
  end if;
  return new;
end;
$$;
drop trigger if exists stacks_set_slug on public.stacks;
create trigger stacks_set_slug before insert or update on public.stacks
  for each row execute function public.stacks_set_slug();

-- Slugs for Stacks already published, oldest first. The write trigger is off for this so updated_at stays as it was.
alter table public.stacks disable trigger stacks_before_write;
do $$
declare
  r record;
begin
  for r in select id, author_id, title from public.stacks where status = 'published' and slug is null
           order by author_id, published_at nulls last, created_at, id loop
    update public.stacks set slug = public.claim_stack_slug(r.author_id, r.title) where id = r.id;
  end loop;
end;
$$;
alter table public.stacks enable trigger stacks_before_write;

alter table public.stacks drop constraint if exists stacks_published_slug;
alter table public.stacks add constraint stacks_published_slug check (status <> 'published' or slug is not null);

-- What every publish needs (see the top). p_place: whether it's about a place; p_city: its city, trimmed.
create or replace function public.check_publishable(p_title text, p_sections jsonb, p_categories text[], p_place boolean, p_city text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  n      record;
  titled int;
begin
  if char_length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'add a title' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_categories, '{}')) = 0 then
    raise exception 'pick at least 1 category' using errcode = '22023';
  end if;
  if p_place and btrim(coalesce(p_city, '')) = '' then
    raise exception 'add a city to publish this place stack' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_city, ''))) > 80 then
    raise exception 'locations are limited to 80 characters' using errcode = '22023';
  end if;
  -- normalize_sections drops empty picks and sections, so a titled section that went missing had no items.
  select * into n from public.normalize_sections(coalesce(p_sections, '[]'::jsonb));
  if n.line_count = 0 then
    raise exception 'add at least one item' using errcode = '22023';
  end if;
  select count(*) into titled from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) x
   where jsonb_typeof(x) = 'object' and nullif(public.one_line(x ->> 'label'), '') is not null;
  if titled > (select count(*) from jsonb_array_elements(n.sections) x where x ->> 'label' is not null) then
    raise exception 'a section has no items: add one or remove the section' using errcode = '22023';
  end if;
end;
$$;
revoke execute on function public.check_publishable(text, jsonb, text[], boolean, text) from public, anon, authenticated;

-- publish_draft: as in 20261130000000_finalize, with the shared checks. The slug comes from the trigger above.
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
  if p_visibility is not null and p_visibility not in ('public', 'unlisted', 'private') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;
  if char_length(descr) > 160 then
    raise exception 'descriptions are limited to 160 characters' using errcode = '22023';
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
  -- The publish checks (title, category, city, items, sections), shared with save_stack.
  perform public.check_publishable(p_title, p_sections, cats, place, loc);
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

-- save_stack (older app versions): as in 20261007000000_edit_published_stacks, with the shared checks on publishing.
create or replace function public.save_stack(
  p_id          uuid,
  p_title       text,
  p_sections    jsonb,
  p_tags        text[],
  p_status      text,
  p_forked_from uuid default null,
  p_style       text default 'numbered',
  p_description text default null,
  p_visibility  text default null,
  p_location    text default null,
  p_edit_of     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid  uuid := auth.uid();
  sid  uuid;
  t    text;
  descr text := btrim(p_description);
  loc  text := btrim(p_location);
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  if p_status not in ('draft', 'published') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  if p_visibility is not null and p_visibility not in ('public', 'unlisted', 'private') then
    raise exception 'invalid visibility' using errcode = '22023';
  end if;
  if char_length(descr) > 300 then
    raise exception 'descriptions are limited to 300 characters' using errcode = '22023';
  end if;
  if char_length(loc) > 80 then
    raise exception 'locations are limited to 80 characters' using errcode = '22023';
  end if;
  -- Publishing from an older app version: the same publish checks as publish_draft. That app has no category or
  -- place question, so it's refused with "pick at least 1 category" (a city still means a place, as in
  -- publish_draft). Draft saves are unchanged.
  if p_status = 'published' then
    perform public.check_publishable(p_title, p_sections, '{}', coalesce(loc, '') <> '', coalesce(loc, ''));
  end if;
  if p_forked_from is not null and not exists (
    select 1 from stacks s where s.id = p_forked_from and s.status = 'published' and can_open_stack(s)
  ) then
    p_forked_from := null;
  end if;

  if p_edit_of is not null then
    if p_status <> 'draft' then
      raise exception 'edits to a published stack are saved, not published' using errcode = '22023';
    end if;
    if not exists (select 1 from stacks s where s.id = p_edit_of and s.author_id = uid and s.status = 'published') then
      raise exception 'stack not found' using errcode = 'P0002';
    end if;
    -- Keep writing to the existing edits draft, if there is one.
    if p_id is null then
      select s.id into p_id from stacks s where s.edit_of = p_edit_of and s.author_id = uid;
    end if;
  end if;

  if p_id is null then
    insert into stacks (author_id, title, description, sections, status, forked_from_id, style, visibility, location, edit_of)
    values (uid, coalesce(p_title, ''), coalesce(descr, ''), coalesce(p_sections, '[]'::jsonb), p_status, p_forked_from,
            coalesce(p_style, 'numbered'), coalesce(p_visibility, 'public'), coalesce(loc, ''), p_edit_of)
    returning id into sid;
  else
    if p_status = 'published' and exists (select 1 from stacks s where s.id = p_id and s.edit_of is not null) then
      raise exception 'edits to a published stack are saved, not published' using errcode = '22023';
    end if;
    update stacks
       set title = coalesce(p_title, ''),
           description = coalesce(descr, description),
           sections = coalesce(p_sections, '[]'::jsonb),
           status = p_status,
           style = coalesce(p_style, style),
           visibility = coalesce(p_visibility, visibility),
           location = coalesce(loc, location),
           forked_from_id = coalesce(p_forked_from, forked_from_id)
     where id = p_id and author_id = uid and status = 'draft'
    returning id into sid;
    if sid is null then
      raise exception 'draft not found' using errcode = 'P0002';
    end if;
    delete from stack_tags where stack_id = sid;
  end if;

  if p_tags is not null then
    if array_length(p_tags, 1) > 20 then
      raise exception 'a stack can have at most 20 tags' using errcode = '22023';
    end if;
    foreach t in array p_tags loop
      t := btrim(regexp_replace(t, '^#', ''));
      continue when t = '';
      insert into stack_tags (stack_id, tag) values (sid, left(t, 40))
      on conflict do nothing;
    end loop;
  end if;
  return sid;
end;
$$;

revoke execute on function public.save_stack(uuid, text, jsonb, text[], text, uuid, text, text, text, text, uuid) from public, anon;
grant execute on function public.save_stack(uuid, text, jsonb, text[], text, uuid, text, text, text, text, uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
