-- Rollback for 20261129000000_pick_model.sql. Run by hand, then mark the migration reverted:
--   supabase migration repair --status reverted 20261129000000
-- Puts back the previous pick rules and limits (20261011000000_link_only_lines, 20261009000000_line_formats_limits
-- and 20261128000000_drafts). Stacks published with the new picks keep their content; their pick ids and tags
-- are dropped the next time their content is saved.

begin;

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

create or replace function public.publish_draft(
  p_id          uuid,
  p_title       text,
  p_sections    jsonb,
  p_tags        text[],
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
  uid    uuid := auth.uid();
  d      drafts;
  descr  text := btrim(coalesce(p_description, ''));
  loc    text := btrim(coalesce(p_location, ''));
  forked uuid;
  t      text;
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
  if char_length(descr) > 300 then
    raise exception 'descriptions are limited to 300 characters' using errcode = '22023';
  end if;
  if char_length(loc) > 80 then
    raise exception 'locations are limited to 80 characters' using errcode = '22023';
  end if;
  forked := d.remixed_from;
  if forked is not null and not exists (
    select 1 from stacks s where s.id = forked and s.status = 'published' and can_open_stack(s)
  ) then
    forked := null;
  end if;

  insert into stacks (id, author_id, title, description, sections, status, forked_from_id, style, visibility, location)
  values (p_id, uid, btrim(p_title), descr, coalesce(p_sections, '[]'::jsonb), 'published', forked,
          coalesce(p_style, 'numbered'), coalesce(p_visibility, 'public'), loc);

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

create or replace function public.apply_stack_edit(
  p_id          uuid,
  p_title       text,
  p_description text,
  p_sections    jsonb,
  p_share       boolean default false,
  p_note        text default ''
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  uid   uuid := auth.uid();
  st    stacks;
  descr text := btrim(coalesce(p_description, ''));
  note  text := btrim(coalesce(p_note, ''));
  shared timestamptz;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select * into st from stacks where id = p_id and author_id = uid and status = 'published' for update;
  if not found then
    raise exception 'stack not found' using errcode = 'P0002';
  end if;
  if char_length(btrim(coalesce(p_title, ''))) = 0 then
    raise exception 'add a title' using errcode = '22023';
  end if;
  if char_length(descr) > 300 then
    raise exception 'descriptions are limited to 300 characters' using errcode = '22023';
  end if;
  if char_length(note) > 40 then
    raise exception 'update notes are limited to 40 characters' using errcode = '22023';
  end if;
  if p_share then
    if btrim(p_title) = st.title and descr = coalesce(st.description, '')
       and (select n.sections from public.normalize_sections(coalesce(p_sections, '[]'::jsonb)) n) = st.sections then
      raise exception 'change something before sharing an update' using errcode = '22023';
    end if;
    if st.visibility <> 'public' then
      raise exception 'only public stacks can share updates' using errcode = '22023';
    end if;
    if st.shared_at is not null and st.shared_at > now() - interval '7 days' then
      raise exception 'you can share an update once every 7 days' using errcode = '22023';
    end if;
  end if;

  update stacks
     set title = btrim(p_title),
         description = descr,
         sections = coalesce(p_sections, '[]'::jsonb),
         shared_at = case when p_share then now() else shared_at end,
         update_note = case when p_share then note else update_note end,
         profile_position = case when p_share then null else profile_position end
   where id = p_id
  returning shared_at into shared;

  delete from drafts where edit_of = p_id and owner_id = uid;
  delete from stacks where edit_of = p_id and author_id = uid;
  return shared;
end;
$$;

-- one_line is used only by the functions above in the newer version.
drop function if exists public.one_line(text);

commit;
