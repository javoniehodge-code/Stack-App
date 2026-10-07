-- Keep lines that have a link but no text.
--
-- A numbered or bulleted line can be just a link, shown as its pill (often with a link name, like "my
-- facebook"). normalize_sections dropped any line without text, so those lines vanished on save. Now a line
-- is dropped only when it has neither text nor a link. Everything else is as in rich_lines.

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
      -- A line with only a link (shown as its pill) is kept; one with neither text nor a link is dropped.
      continue when btrim(plain) = '' and lnk is null;
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
