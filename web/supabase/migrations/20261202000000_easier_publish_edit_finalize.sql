-- Easier publishing, and the Finalize choices when editing a published Stack (agreed Nov 27).
--
-- * check_publishable(): to publish, a Stack needs only a title, at least one item, and nothing over a limit. The
--   categories (still up to 2) and the city (still up to 80 characters) are optional, even for a place Stack.
--   publish_draft() and save_stack() use it, so both accept a Stack with no category or city now.
-- * apply_stack_edit() also takes the Finalize choices: theme, whether it's about a place, the city and the
--   categories (each left out keeps what the Stack has, for older app versions). It checks them as publish_draft
--   does, and checks the edit as a publish would.
--     - Only a change to the title, description or picks moves the Stack's edit date ("Updated …") or can be shared
--       as an update. Changing only the Finalize choices keeps the date.
-- * The old apply_stack_edit signature goes, so a call without the new arguments (an older app version) reaches the
--   new one.

begin;

-- What every publish needs: a title, at least one item, no titled section without items, and the city within its
-- limit. Categories and the city are optional (agreed Nov 27). p_categories and p_place stay for the callers.
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

drop function if exists public.apply_stack_edit(uuid, text, text, jsonb, boolean, text);

create or replace function public.apply_stack_edit(
  p_id          uuid,
  p_title       text,
  p_description text,
  p_sections    jsonb,
  p_share       boolean default false,
  p_note        text default '',
  p_theme_emoji text default null,
  p_theme_color text default null,
  p_is_place    boolean default null,
  p_location    text default null,
  p_categories  text[] default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  uid     uuid := auth.uid();
  st      stacks;
  descr   text := public.one_line(p_description);
  note    text := btrim(coalesce(p_note, ''));
  shared  timestamptz;
  emoji   text;
  color   text;
  place   boolean;
  loc     text;
  cats    text[];
  changed boolean;
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  select * into st from stacks where id = p_id and author_id = uid and status = 'published' for update;
  if not found then
    raise exception 'stack not found' using errcode = 'P0002';
  end if;
  -- Left out: keep what the Stack has.
  emoji := coalesce(p_theme_emoji, st.theme_emoji);
  color := coalesce(p_theme_color, st.theme_color);
  place := coalesce(p_is_place, st.is_place);
  loc   := btrim(coalesce(p_location, st.location, ''));
  cats  := coalesce(p_categories, st.categories, '{}');
  if char_length(descr) > 160 then
    raise exception 'descriptions are limited to 160 characters' using errcode = '22023';
  end if;
  if char_length(note) > 40 then
    raise exception 'update notes are limited to 40 characters' using errcode = '22023';
  end if;
  if emoji is not null and not (emoji = any (public.theme_emojis())) then
    raise exception 'pick one of the theme emoji' using errcode = '22023';
  end if;
  if color is not null and not (color = any (public.theme_colors())) then
    raise exception 'pick one of the theme colours' using errcode = '22023';
  end if;
  if not (cats <@ public.stack_categories_list()) then
    raise exception 'pick categories from the list' using errcode = '22023';
  end if;
  if cardinality(cats) > 2 or cardinality(cats) <> cardinality(array(select distinct unnest(cats))) then
    raise exception 'a stack can have up to 2 different categories' using errcode = '22023';
  end if;
  -- The same checks as publishing (title, items, sections, the city's limit).
  perform public.check_publishable(p_title, p_sections, cats, place, loc);
  if not place then
    loc := '';
  end if;

  changed := not (public.one_line(p_title) = st.title and descr = coalesce(st.description, '')
                  and (select n.sections from public.normalize_sections(coalesce(p_sections, '[]'::jsonb)) n) = st.sections);
  if p_share then
    if not changed then
      raise exception 'change something before sharing an update' using errcode = '22023';
    end if;
    if st.visibility <> 'public' then
      raise exception 'only public stacks can share updates' using errcode = '22023';
    end if;
    if st.shared_at is not null and st.shared_at > now() - interval '7 days' then
      raise exception 'you can share an update once every 7 days' using errcode = '22023';
    end if;
  end if;

  -- The content, only when it changed (writing it moves the edit date).
  if changed then
    update stacks
       set title = btrim(p_title),
           description = descr,
           sections = coalesce(p_sections, '[]'::jsonb),
           shared_at = case when p_share then now() else shared_at end,
           update_note = case when p_share then note else update_note end,
           profile_position = case when p_share then null else profile_position end
     where id = p_id;
  end if;
  -- The Finalize choices: these columns don't move the edit date.
  update stacks
     set theme_emoji = emoji,
         theme_color = color,
         is_place = place,
         location = loc,
         categories = cats
   where id = p_id
  returning shared_at into shared;

  delete from drafts where edit_of = p_id and owner_id = uid;
  delete from stacks where edit_of = p_id and author_id = uid;
  return shared;
end;
$$;

revoke execute on function public.apply_stack_edit(uuid, text, text, jsonb, boolean, text, text, text, boolean, text, text[]) from public, anon;
grant execute on function public.apply_stack_edit(uuid, text, text, jsonb, boolean, text, text, text, boolean, text, text[]) to authenticated;

commit;

notify pgrst, 'reload schema';
