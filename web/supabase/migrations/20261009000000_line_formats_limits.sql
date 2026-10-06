-- Line formats and new stack size limits.
--
-- * Each line can have a format: 'num' (numbered), 'bullet' (bulleted), 'text'
--   (paragraph) or 'bold' (bold line). Lines saved before this have no format and
--   follow the stack's style (numbered or bulleted), as before.
-- * Numbered and bulleted lines have a heading of up to 60 characters and an
--   optional detail (note) of up to 300. They can turn off bold on the heading
--   ("bold": false). Paragraphs are up to 360 characters, bold lines up to 60;
--   neither has a note.
-- * Title: 60 characters (was 120). Description: 180 (was 300). Subsection
--   titles: 60 (was 100). All visible text together: 6,000 (was 25,000).
--   At most 20 subsections and 100 lines, as before.
-- * Existing stacks and drafts are trimmed to the new limits now (the user chose
--   this): text past a limit is cut, and once a stack reaches 6,000 characters the
--   rest of it is dropped. Trimming doesn't change when a stack was last updated.

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
  fmt   text;
  obj   jsonb;
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
    if char_length(lbl) > 60 then
      raise exception 'subsection titles are limited to 60 characters' using errcode = '22023';
    end if;
    lines := '[]'::jsonb;
    for ln in select * from jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) loop
      fmt := nullif(ln ->> 'format', '');
      if fmt is not null and fmt not in ('num', 'bullet', 'text', 'bold') then
        raise exception 'invalid line format' using errcode = '22023';
      end if;
      txt := btrim(coalesce(ln ->> 'text', ''));
      nte := case when fmt in ('text', 'bold') then null else nullif(btrim(coalesce(ln ->> 'note', '')), '') end;
      lnk := nullif(btrim(coalesce(ln ->> 'link', '')), '');
      continue when txt = '';
      if fmt = 'text' then
        if char_length(txt) > 360 then
          raise exception 'paragraphs are limited to 360 characters' using errcode = '22023';
        end if;
      elsif char_length(txt) > 60 then
        raise exception 'line headings are limited to 60 characters' using errcode = '22023';
      end if;
      if char_length(nte) > 300 then
        raise exception 'line details are limited to 300 characters' using errcode = '22023';
      end if;
      if lnk is not null and (lnk !~* '^https?://[^\s]+$' or char_length(lnk) > 2048) then
        raise exception 'links must be http(s) URLs' using errcode = '22023';
      end if;
      obj := jsonb_build_object('text', txt, 'link', lnk);
      if nte is not null then obj := obj || jsonb_build_object('note', nte); end if;
      if fmt is not null then obj := obj || jsonb_build_object('format', fmt); end if;
      if fmt is distinct from 'text' and fmt is distinct from 'bold' and ln -> 'bold' = 'false'::jsonb then
        obj := obj || jsonb_build_object('bold', false);
      end if;
      lines := lines || jsonb_build_array(obj);
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

-- Same as before, with the new title, description and total limits.
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
  if char_length(new.title) > 60 then
    raise exception 'titles are limited to 60 characters' using errcode = '22023';
  end if;
  if char_length(new.description) > 180 then
    raise exception 'descriptions are limited to 180 characters' using errcode = '22023';
  end if;
  if public.stack_text_length(new.title, new.description, new.sections) > 6000 then
    raise exception 'a stack can have at most 6,000 characters of text' using errcode = '22023';
  end if;
  new.updated_at := now();
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

-- One-off: cut a stack's sections down to the new limits, with p_room characters left for them.
create or replace function public.trim_sections_to_limits(p jsonb, p_room int)
returns jsonb
language plpgsql
immutable
as $$
declare
  room  int := p_room;
  outp  jsonb := '[]'::jsonb;
  sec   jsonb;
  ln    jsonb;
  lines jsonb;
  lbl   text;
  txt   text;
  nte   text;
  fmt   text;
  nsec  int := 0;
  nline int := 0;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    return '[]'::jsonb;
  end if;
  for sec in select * from jsonb_array_elements(p) loop
    exit when room <= 0 or nsec >= 20 or nline >= 100;
    lbl := nullif(btrim(left(btrim(coalesce(sec ->> 'label', '')), least(60, room))), '');
    lines := '[]'::jsonb;
    for ln in select * from jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) loop
      exit when room - coalesce(char_length(lbl), 0) <= 0 or nline >= 100;
      fmt := nullif(ln ->> 'format', '');
      if fmt is not null and fmt not in ('num', 'bullet', 'text', 'bold') then fmt := null; ln := ln - 'format'; end if;
      txt := btrim(coalesce(ln ->> 'text', ''));
      continue when txt = '';
      txt := btrim(left(txt, least(case when fmt = 'text' then 360 else 60 end, room - coalesce(char_length(lbl), 0))));
      continue when txt = '';
      room := room - char_length(txt);
      nte := case when fmt in ('text', 'bold') then null else nullif(btrim(coalesce(ln ->> 'note', '')), '') end;
      if nte is not null then
        nte := nullif(btrim(left(nte, least(300, greatest(room - coalesce(char_length(lbl), 0), 0)))), '');
        room := room - coalesce(char_length(nte), 0);
      end if;
      ln := (ln - 'text' - 'note') || jsonb_build_object('text', txt);
      if nte is not null then ln := ln || jsonb_build_object('note', nte); end if;
      lines := lines || jsonb_build_array(ln);
      nline := nline + 1;
    end loop;
    continue when jsonb_array_length(lines) = 0;
    room := room - coalesce(char_length(lbl), 0);
    outp := outp || jsonb_build_array(jsonb_build_object('label', lbl, 'lines', lines));
    nsec := nsec + 1;
  end loop;
  return outp;
end;
$$;

-- Trim every stack and draft. The write trigger is off for this so updated_at stays as it was.
alter table public.stacks disable trigger stacks_before_write;

do $$
declare
  r     record;
  t     text;
  d     text;
  n     record;
begin
  for r in select id, title, description, sections, line_count from public.stacks loop
    t := btrim(left(btrim(coalesce(r.title, '')), 60));
    d := left(coalesce(r.description, ''), 180);
    select * into n from public.normalize_sections(
      public.trim_sections_to_limits(r.sections, 6000 - char_length(t) - char_length(d)));
    if t is distinct from r.title or d is distinct from r.description
       or n.sections is distinct from r.sections or n.line_count is distinct from r.line_count then
      update public.stacks
         set title = t, description = d, sections = n.sections, line_count = n.line_count
       where id = r.id;
    end if;
  end loop;
end;
$$;

alter table public.stacks enable trigger stacks_before_write;

drop function public.trim_sections_to_limits(jsonb, int);
