-- One text per line, bold words and link names (the user chose these from the latest Create Flow design).
--
-- * Numbered and bulleted lines are one text of up to 360 characters, like paragraphs, instead of a 60-character
--   heading plus a 300-character note. Bold lines stay at 60.
-- * Words can be bold anywhere in a line's text: they're saved between ** marks. The marks don't count toward
--   any limit, and a line that's only marks counts as empty.
-- * A line's link can have a name (up to 40 characters) shown on its pill instead of the domain ("linkName"), and
--   web addresses typed into the text can be named too ("linkNames", address → name, at most 20 per line).
-- * The per-line "bold" setting is gone (bold words replace it). Notes are still accepted and shown, so older
--   app versions keep saving, but the app no longer writes them.
-- * Existing stacks and drafts are converted now: a bold numbered/bulleted heading becomes **heading**, and its
--   note is joined on ("Heading. Note"). A note that would push its line past 360 characters, or its stack past
--   6,000, stays a separate note. Converting doesn't change when a stack was last updated.

create or replace function public.normalize_sections(p jsonb, out sections jsonb, out line_count int)
language plpgsql
immutable
as $$
declare
  sec   jsonb;
  ln    jsonb;
  lbl   text;
  txt   text;
  plain text;
  nte   text;
  lnk   text;
  fmt   text;
  nm    text;
  names jsonb;
  kv    record;
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
      plain := replace(txt, '**', '');
      nte := case when fmt in ('text', 'bold') then null else nullif(btrim(coalesce(ln ->> 'note', '')), '') end;
      lnk := nullif(btrim(coalesce(ln ->> 'link', '')), '');
      continue when btrim(plain) = '';
      if fmt = 'bold' then
        if char_length(plain) > 60 then
          raise exception 'bold lines are limited to 60 characters' using errcode = '22023';
        end if;
      elsif char_length(plain) > 360 then
        raise exception 'lines are limited to 360 characters' using errcode = '22023';
      end if;
      if char_length(nte) > 300 then
        raise exception 'line details are limited to 300 characters' using errcode = '22023';
      end if;
      if lnk is not null and (lnk !~* '^https?://[^\s]+$' or char_length(lnk) > 2048) then
        raise exception 'links must be http(s) URLs' using errcode = '22023';
      end if;
      nm := case when lnk is null then null else nullif(btrim(coalesce(ln ->> 'linkName', '')), '') end;
      if char_length(nm) > 40 then
        raise exception 'link names are limited to 40 characters' using errcode = '22023';
      end if;
      names := '{}'::jsonb;
      if jsonb_typeof(ln -> 'linkNames') = 'object' then
        for kv in select * from jsonb_each_text(ln -> 'linkNames') loop
          continue when nullif(btrim(coalesce(kv.value, '')), '') is null;
          if kv.key !~* '^https?://[^\s]+$' or char_length(kv.key) > 2048 then
            raise exception 'named links must be http(s) URLs' using errcode = '22023';
          end if;
          if char_length(btrim(kv.value)) > 40 then
            raise exception 'link names are limited to 40 characters' using errcode = '22023';
          end if;
          names := names || jsonb_build_object(kv.key, btrim(kv.value));
        end loop;
        if (select count(*) from jsonb_object_keys(names)) > 20 then
          raise exception 'a line can have at most 20 named links' using errcode = '22023';
        end if;
      end if;
      obj := jsonb_build_object('text', txt, 'link', lnk);
      if nte is not null then obj := obj || jsonb_build_object('note', nte); end if;
      if fmt is not null then obj := obj || jsonb_build_object('format', fmt); end if;
      if nm is not null then obj := obj || jsonb_build_object('linkName', nm); end if;
      if names <> '{}'::jsonb then obj := obj || jsonb_build_object('linkNames', names); end if;
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

-- Same as before, but ** bold marks don't count.
create or replace function public.stack_text_length(p_title text, p_description text, p_sections jsonb)
returns int
language sql
immutable
as $$
  select coalesce(char_length(p_title), 0)
       + coalesce(char_length(p_description), 0)
       + coalesce((
           select sum(coalesce(char_length(sec ->> 'label'), 0)
                    + coalesce((select sum(coalesce(char_length(replace(ln ->> 'text', '**', '')), 0) + coalesce(char_length(ln ->> 'note'), 0))
                                  from jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) ln), 0))
             from jsonb_array_elements(coalesce(p_sections, '[]'::jsonb)) sec
         ), 0)::int;
$$;

-- One-off: a stack's lines in the new form. With p_join, notes are joined onto their line where it fits.
create or replace function public.rich_lines_convert(p jsonb, p_style text, p_join boolean)
returns jsonb
language plpgsql
immutable
as $$
declare
  outp   jsonb := '[]'::jsonb;
  sec    jsonb;
  ln     jsonb;
  lines  jsonb;
  fmt    text;
  txt    text;
  nte    text;
  head   text;
  joined text;
begin
  if p is null or jsonb_typeof(p) <> 'array' then
    return p;
  end if;
  for sec in select * from jsonb_array_elements(p) loop
    lines := '[]'::jsonb;
    for ln in select * from jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) loop
      fmt := coalesce(nullif(ln ->> 'format', ''), case when p_style = 'bulleted' then 'bullet' else 'num' end);
      if fmt in ('num', 'bullet') then
        txt := btrim(coalesce(ln ->> 'text', ''));
        nte := nullif(btrim(coalesce(ln ->> 'note', '')), '');
        if txt = '' or ln -> 'bold' = 'false'::jsonb then
          head := txt;
        elsif nullif(ln ->> 'format', '') is null and nte is null and txt ~ '\s[—–]\s' then
          -- Older lines written as "Name — details" showed only the name in bold.
          head := '**' || substring(txt from '^(.*?)\s+[—–]\s+') || '** — ' || regexp_replace(txt, '^.*?\s+[—–]\s+', '');
        else
          head := '**' || txt || '**';
        end if;
        ln := (ln - 'bold' - 'text') || jsonb_build_object('text', head);
        if nte is not null and p_join then
          joined := head || case when txt = '' then '' when txt ~ '[.!?]$' then ' ' else '. ' end || nte;
          if char_length(replace(joined, '**', '')) <= 360 then
            ln := (ln - 'note' - 'text') || jsonb_build_object('text', joined);
          end if;
        end if;
      else
        ln := ln - 'bold';
      end if;
      lines := lines || jsonb_build_array(ln);
    end loop;
    outp := outp || jsonb_build_array(jsonb_set(sec, '{lines}', lines));
  end loop;
  return outp;
end;
$$;

-- Convert every stack and draft. The write trigger is off for this so updated_at stays as it was.
alter table public.stacks disable trigger stacks_before_write;

do $$
declare
  r record;
  n record;
begin
  for r in select id, title, description, sections, style, line_count from public.stacks loop
    select * into n from public.normalize_sections(public.rich_lines_convert(r.sections, r.style, true));
    if public.stack_text_length(r.title, r.description, n.sections) > 6000 then
      select * into n from public.normalize_sections(public.rich_lines_convert(r.sections, r.style, false));
    end if;
    if n.sections is distinct from r.sections or n.line_count is distinct from r.line_count then
      update public.stacks set sections = n.sections, line_count = n.line_count where id = r.id;
    end if;
  end loop;
end;
$$;

alter table public.stacks enable trigger stacks_before_write;

drop function public.rich_lines_convert(jsonb, text, boolean);
