-- Stack size limits.
--
-- * Title: 120 characters (unchanged).
-- * Description: up to 300 characters (was 500). Checked when a stack is saved;
--   the table still allows 500 so older, longer descriptions keep working.
-- * Subsections: at most 20 (was 30), each title up to 100 characters (was 60).
-- * Items: at most 100 across the stack (was 200). Each heading is up to
--   120 characters (was 500); each optional note stays at 500.
-- * All visible text together (title, description, subsection titles, item
--   headings and notes) is limited to 25,000 characters. Links and location
--   don't count.
--
-- Stacks already over a limit stay as they are and keep showing. The checks
-- run when a stack's title, description, sections or status is saved, so an
-- oversized draft has to be trimmed before it saves again.

-- Same as before, with the new subsection, item, heading and label limits.
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
  if jsonb_array_length(p) > 20 then
    raise exception 'a stack can have at most 20 subsections' using errcode = '22023';
  end if;
  for sec in select * from jsonb_array_elements(p) loop
    lbl := nullif(btrim(coalesce(sec ->> 'label', '')), '');
    if char_length(lbl) > 100 then
      raise exception 'subsection titles are limited to 100 characters' using errcode = '22023';
    end if;
    lines := '[]'::jsonb;
    for ln in select * from jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) loop
      txt := btrim(coalesce(ln ->> 'text', ''));
      nte := nullif(btrim(coalesce(ln ->> 'note', '')), '');
      lnk := nullif(btrim(coalesce(ln ->> 'link', '')), '');
      continue when txt = '';
      if char_length(txt) > 120 then
        raise exception 'item headings are limited to 120 characters' using errcode = '22023';
      end if;
      if char_length(nte) > 500 then
        raise exception 'item notes are limited to 500 characters' using errcode = '22023';
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
  if line_count > 100 then
    raise exception 'a stack can have at most 100 items' using errcode = '22023';
  end if;
end;
$$;

-- Characters of visible text in a stack: title, description, subsection titles, item headings and notes.
create or replace function public.stack_text_length(p_title text, p_description text, p_sections jsonb)
returns int
language sql
immutable
as $$
  select coalesce(char_length(p_title), 0)
       + coalesce(char_length(p_description), 0)
       + coalesce((
           select sum(coalesce(char_length(sec ->> 'label'), 0)
                    + coalesce((select sum(coalesce(char_length(ln ->> 'text'), 0) + coalesce(char_length(ln ->> 'note'), 0))
                                  from jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) ln), 0))
             from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) sec
         ), 0)::int;
$$;

-- Same as before, plus the 25,000-character total.
create or replace function public.stacks_before_write()
returns trigger
language plpgsql
as $$
declare
  n record;
begin
  select * into n from public.normalize_sections(new.sections);
  new.sections := n.sections;
  new.line_count := n.line_count;
  new.title := btrim(new.title);
  if public.stack_text_length(new.title, new.description, new.sections) > 25000 then
    raise exception 'a stack can have at most 25,000 characters of text' using errcode = '22023';
  end if;
  new.updated_at := now();
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

-- The trigger also runs when only the description changes, so the total can't be exceeded that way.
drop trigger if exists stacks_before_write on public.stacks;
create trigger stacks_before_write
  before insert or update of title, description, sections, status on public.stacks
  for each row execute function public.stacks_before_write();

-- save_stack: same as before, with descriptions limited to 300 characters.
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
