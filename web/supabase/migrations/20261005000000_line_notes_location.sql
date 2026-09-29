-- Line notes and stack locations.
--
-- * Each line can carry an optional note (up to 500 characters), shown in gray
--   under the line. It's stored with the line in stacks.sections as "note".
-- * stacks.location: an optional city or area ("Mexico City", "Brooklyn, NY"),
--   up to 80 characters. Search matches it, so people can find stacks locally.
-- * save_stack() takes p_location; leaving it out keeps the current value.

-- Same as before, plus the optional per-line note.
create or replace function public.normalize_sections(p jsonb, out sections jsonb, out line_count int)
language plpgsql
immutable
as $$
declare
  sec   jsonb;
  ln    jsonb;
  lbl   text;
  txt   text;
  nte   text;
  lnk   text;
  lines jsonb;
begin
  sections := '[]'::jsonb;
  line_count := 0;
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'sections must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p) > 30 then
    raise exception 'a stack can have at most 30 subsections' using errcode = '22023';
  end if;
  for sec in select * from jsonb_array_elements(p) loop
    lbl := nullif(btrim(coalesce(sec ->> 'label', '')), '');
    if char_length(lbl) > 60 then
      raise exception 'subsection labels are limited to 60 characters' using errcode = '22023';
    end if;
    lines := '[]'::jsonb;
    for ln in select * from jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) loop
      txt := btrim(coalesce(ln ->> 'text', ''));
      nte := nullif(btrim(coalesce(ln ->> 'note', '')), '');
      lnk := nullif(btrim(coalesce(ln ->> 'link', '')), '');
      continue when txt = '';
      if char_length(txt) > 500 then
        raise exception 'lines are limited to 500 characters' using errcode = '22023';
      end if;
      if char_length(nte) > 500 then
        raise exception 'line notes are limited to 500 characters' using errcode = '22023';
      end if;
      if lnk is not null and (lnk !~* '^https?://[^\s]+$' or char_length(lnk) > 2048) then
        raise exception 'links must be http(s) URLs' using errcode = '22023';
      end if;
      lines := lines || jsonb_build_array(
        case when nte is null then jsonb_build_object('text', txt, 'link', lnk)
             else jsonb_build_object('text', txt, 'note', nte, 'link', lnk) end);
      line_count := line_count + 1;
    end loop;
    continue when jsonb_array_length(lines) = 0;
    sections := sections || jsonb_build_array(jsonb_build_object('label', lbl, 'lines', lines));
  end loop;
  if line_count > 200 then
    raise exception 'a stack can have at most 200 lines' using errcode = '22023';
  end if;
end;
$$;

alter table public.stacks
  add column if not exists location text not null default ''
  check (char_length(location) <= 80);

-- save_stack with p_location. The old signature is dropped so named calls stay unambiguous.
drop function if exists public.save_stack(uuid, text, jsonb, text[], text, uuid, text, text, text);

create function public.save_stack(
  p_id          uuid,
  p_title       text,
  p_sections    jsonb,
  p_tags        text[],
  p_status      text,
  p_forked_from uuid default null,
  p_style       text default 'numbered',
  p_description text default null,
  p_visibility  text default null,
  p_location    text default null
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
  if char_length(descr) > 500 then
    raise exception 'descriptions are limited to 500 characters' using errcode = '22023';
  end if;
  if char_length(loc) > 80 then
    raise exception 'locations are limited to 80 characters' using errcode = '22023';
  end if;
  if p_forked_from is not null and not exists (
    select 1 from stacks s where s.id = p_forked_from and s.status = 'published' and can_open_stack(s)
  ) then
    p_forked_from := null;
  end if;

  if p_id is null then
    insert into stacks (author_id, title, description, sections, status, forked_from_id, style, visibility, location)
    values (uid, coalesce(p_title, ''), coalesce(descr, ''), coalesce(p_sections, '[]'::jsonb), p_status, p_forked_from,
            coalesce(p_style, 'numbered'), coalesce(p_visibility, 'public'), coalesce(loc, ''))
    returning id into sid;
  else
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

revoke execute on function public.save_stack(uuid, text, jsonb, text[], text, uuid, text, text, text, text) from public, anon;
grant execute on function public.save_stack(uuid, text, jsonb, text[], text, uuid, text, text, text, text) to authenticated;

-- Search also matches the location.
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

-- Forks start with the source's location too.
create or replace function public.fork_template(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', s.id,
           'title', s.title,
           'description', s.description,
           'location', s.location,
           'sections', s.sections,
           'style', s.style,
           'tags', coalesce((select jsonb_agg(t.tag order by t.tag) from stack_tags t where t.stack_id = s.id), '[]'::jsonb))
    from stacks s
   where s.id = p_id and s.status = 'published' and can_open_stack(s);
$$;
