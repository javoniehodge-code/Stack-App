-- Rollback for 20261201000000_publish_checks.sql. Run by hand, then mark the migration reverted:
--   supabase migration repair --status reverted 20261201000000
-- Puts back publish_draft as in 20261130000000_finalize and save_stack as in 20261007000000_edit_published_stacks
-- (without the publish checks), and removes the slug trigger, its check, publish_status, publish_attempts and the
-- helper functions. stacks.slug, its index and stack_slug() stay, with the slugs already set; the previous app
-- doesn't read them. Re-applying the migration works over them (Stacks published meanwhile get their slug then).

begin;

alter table public.stacks drop constraint if exists stacks_published_slug;
drop trigger if exists stacks_set_slug on public.stacks;
drop function if exists public.stacks_set_slug();
drop function if exists public.claim_stack_slug(uuid, text);
drop function if exists public.publish_status(uuid, uuid);
drop function if exists public.publish_draft(uuid, text, jsonb, text[], text, text, text, text, text, text, boolean, text[], uuid);
drop table if exists public.publish_attempts;

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

drop function if exists public.check_publishable(text, jsonb, text[], boolean, text);

commit;

notify pgrst, 'reload schema';
