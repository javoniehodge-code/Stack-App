-- The new pick model and content limits (Task 2b; spec, Content rules).
--
-- * A pick (a line of a stack) is numbered or bulleted, with a heading (`text`, up to 80 characters, required), an
--   optional subheading (`note`, up to 100), an optional link (`link`, `linkName` up to 40) and up to 3 tags
--   (`tags`, up to 20 characters each; one price at most). Every pick has a stable `id`: the one the editor gave it,
--   or a new one when it's missing, malformed or used twice in the same stack.
-- * No paragraphs or bold lines, and no line breaks: typed breaks become spaces.
-- * Up to 5 sections (titles up to 40 characters) and 15 picks per stack; descriptions up to 160 characters. The
--   6,000-character total is gone.
-- * Checked when a stack's content is written (publishing, applying an edit). Stacks already published keep their
--   content as it is until it's next changed. Drafts aren't checked: they live in public.drafts.

begin;

-- Typed or pasted line breaks become single spaces; the ends are trimmed.
create or replace function public.one_line(t text)
returns text
language sql
immutable
set search_path = ''
as $$ select btrim(regexp_replace(coalesce(t, ''), '\s*[\r\n]+\s*', ' ', 'g')) $$;

create or replace function public.normalize_sections(p jsonb, out sections jsonb, out line_count int)
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  sec    jsonb;
  ln     jsonb;
  lbl    text;
  txt    text;
  nte    text;
  lnk    text;
  fmt    text;
  nm     text;
  pid    text;
  tg     text;
  tags   jsonb;
  seen   text[] := '{}';
  prices int;
  titled int := 0;
  obj    jsonb;
  lines  jsonb;
begin
  sections := '[]'::jsonb;
  line_count := 0;
  if p is null or jsonb_typeof(p) <> 'array' then
    raise exception 'sections must be an array' using errcode = '22023';
  end if;
  for sec in select * from jsonb_array_elements(p) loop
    lbl := nullif(public.one_line(sec ->> 'label'), '');
    if char_length(lbl) > 40 then
      raise exception 'section titles are limited to 40 characters' using errcode = '22023';
    end if;
    lines := '[]'::jsonb;
    for ln in select * from jsonb_array_elements(coalesce(sec -> 'lines', '[]'::jsonb)) loop
      fmt := nullif(ln ->> 'format', '');
      if fmt in ('text', 'bold') then
        raise exception 'paragraphs and bold lines aren''t items: make them numbered or bulleted' using errcode = '22023';
      end if;
      if fmt is not null and fmt not in ('num', 'bullet') then
        raise exception 'invalid line format' using errcode = '22023';
      end if;
      txt := public.one_line(ln ->> 'text');
      nte := nullif(public.one_line(ln ->> 'note'), '');
      lnk := nullif(btrim(coalesce(ln ->> 'link', '')), '');
      tags := '[]'::jsonb;
      prices := 0;
      if jsonb_typeof(ln -> 'tags') = 'array' then
        for tg in select public.one_line(x) from jsonb_array_elements_text(ln -> 'tags') x loop
          continue when tg = '' or exists (select 1 from jsonb_array_elements_text(tags) y where lower(y) = lower(tg));
          if char_length(tg) > 20 then
            raise exception 'tags are limited to 20 characters' using errcode = '22023';
          end if;
          if tg in ('Free', '$', '$$', '$$$') then
            prices := prices + 1;
          end if;
          tags := tags || to_jsonb(tg);
        end loop;
      end if;
      -- A pick with nothing in it is dropped; one with anything in it needs a heading.
      continue when txt = '' and nte is null and lnk is null and jsonb_array_length(tags) = 0;
      if txt = '' then
        raise exception 'every item needs a heading' using errcode = '22023';
      end if;
      if char_length(txt) > 80 then
        raise exception 'item headings are limited to 80 characters' using errcode = '22023';
      end if;
      if char_length(nte) > 100 then
        raise exception 'item subheadings are limited to 100 characters' using errcode = '22023';
      end if;
      if jsonb_array_length(tags) > 3 then
        raise exception 'an item can have at most 3 tags' using errcode = '22023';
      end if;
      if prices > 1 then
        raise exception 'an item can have one price tag' using errcode = '22023';
      end if;
      if lnk is not null and (lnk !~* '^https?://[^\s]+$' or char_length(lnk) > 2048) then
        raise exception 'links must be http(s) URLs' using errcode = '22023';
      end if;
      nm := case when lnk is null then null else nullif(public.one_line(ln ->> 'linkName'), '') end;
      if char_length(nm) > 40 then
        raise exception 'link names are limited to 40 characters' using errcode = '22023';
      end if;
      pid := lower(ln ->> 'id');
      if pid is null or pid !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or pid = any (seen) then
        pid := gen_random_uuid()::text;
      end if;
      seen := seen || pid;
      obj := jsonb_build_object('id', pid, 'text', txt, 'link', lnk);
      if nte is not null then obj := obj || jsonb_build_object('note', nte); end if;
      if fmt is not null then obj := obj || jsonb_build_object('format', fmt); end if;
      if nm is not null then obj := obj || jsonb_build_object('linkName', nm); end if;
      if jsonb_array_length(tags) > 0 then obj := obj || jsonb_build_object('tags', tags); end if;
      lines := lines || jsonb_build_array(obj);
      line_count := line_count + 1;
    end loop;
    continue when jsonb_array_length(lines) = 0;
    if lbl is not null then
      titled := titled + 1;
    end if;
    sections := sections || jsonb_build_array(jsonb_build_object('label', lbl, 'lines', lines));
  end loop;
  if titled > 5 then
    raise exception 'a stack can have at most 5 sections' using errcode = '22023';
  end if;
  if line_count > 15 then
    raise exception 'a stack can have at most 15 items' using errcode = '22023';
  end if;
end;
$fn$;

-- As before, with the new description limit, no total, and no line breaks in the title or description.
create or replace function public.stacks_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  n record;
begin
  select * into n from public.normalize_sections(new.sections);
  new.sections := n.sections;
  new.line_count := n.line_count;
  new.title := public.one_line(new.title);
  new.description := public.one_line(new.description);
  if char_length(new.title) > 60 then
    raise exception 'titles are limited to 60 characters' using errcode = '22023';
  end if;
  if char_length(new.description) > 160 then
    raise exception 'descriptions are limited to 160 characters' using errcode = '22023';
  end if;
  new.updated_at := now();
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  return new;
end;
$$;

-- publish_draft: as in 20261128000000_drafts, with descriptions up to 160 characters.
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
  descr  text := public.one_line(p_description);
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
  if char_length(descr) > 160 then
    raise exception 'descriptions are limited to 160 characters' using errcode = '22023';
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

-- apply_stack_edit: as in 20261128000000_drafts, with descriptions up to 160 characters.
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
  descr text := public.one_line(p_description);
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
  if char_length(descr) > 160 then
    raise exception 'descriptions are limited to 160 characters' using errcode = '22023';
  end if;
  if char_length(note) > 40 then
    raise exception 'update notes are limited to 40 characters' using errcode = '22023';
  end if;
  if p_share then
    if public.one_line(p_title) = st.title and descr = coalesce(st.description, '')
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

commit;
