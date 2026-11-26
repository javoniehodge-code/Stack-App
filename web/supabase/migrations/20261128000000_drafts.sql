-- Drafts in their own owner-only table (Task 2a; Task 0 audit, decision C).
--
-- * public.drafts holds work in progress as loose JSON, so a draft can be incomplete or over a limit and still
--   autosave. Limits are checked when it's published. Only its owner can read or change it.
-- * The app makes a draft's id itself, before the first save, and every save is an upsert on that id. A save
--   that's retried (say its reply was lost) updates the same row, so it can never make a second draft.
-- * step records where the editor was, so reopening /drafts/{id} returns there. edit_of marks unsaved edits to
--   one of your published stacks (one such draft per stack); base_version is when that stack last changed when
--   the edit began. remixed_from is the stack a remix started from.
-- * publish_draft() publishes a draft as a stack with the draft's id and removes the draft, in one step. A
--   repeated publish of the same draft returns the same stack instead of publishing a second one.
-- * apply_stack_edit() also removes the edits draft from the new table.
-- * Drafts kept in public.stacks (status 'draft') move here. public.stacks then holds published stacks only;
--   save_stack() stays for older app versions.

begin;

create table if not exists public.drafts (
  id           uuid primary key,
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  content      jsonb not null default '{}'::jsonb,
  step         text not null default 'title' check (step in ('title', 'description', 'build', 'review')),
  edit_of      uuid references public.stacks (id) on delete cascade,
  base_version timestamptz,
  remixed_from uuid references public.stacks (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint drafts_content_object check (jsonb_typeof(content) = 'object'),
  -- Generous for 15 picks; it only stops abuse.
  constraint drafts_content_size check (pg_column_size(content) <= 262144)
);

-- One set of unsaved edits per published stack.
create unique index if not exists drafts_one_edit_per_stack on public.drafts (owner_id, edit_of) where edit_of is not null;
create index if not exists drafts_owner_updated on public.drafts (owner_id, updated_at desc);

-- Keeps who owns a draft, when it was made and what it edits fixed; stamps updated_at; allows edits drafts only
-- for the owner's own published stacks; and caps drafts at 200 per person.
create or replace function public.drafts_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    new.owner_id := old.owner_id;
    new.created_at := old.created_at;
    new.edit_of := old.edit_of;
    new.updated_at := now();
    return new;
  end if;
  if new.edit_of is not null and not exists (
    select 1 from public.stacks s where s.id = new.edit_of and s.author_id = new.owner_id and s.status = 'published'
  ) then
    raise exception 'stack not found' using errcode = 'P0002';
  end if;
  -- An upsert of an existing draft also passes through here; only a new one counts toward the cap.
  if not exists (select 1 from public.drafts d where d.id = new.id)
     and (select count(*) from public.drafts d where d.owner_id = new.owner_id) >= 200 then
    raise exception 'you can keep up to 200 drafts' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function public.drafts_before_write() from public, anon, authenticated;

drop trigger if exists drafts_before_write on public.drafts;
create trigger drafts_before_write
  before insert or update on public.drafts
  for each row execute function public.drafts_before_write();

alter table public.drafts enable row level security;
revoke all on public.drafts from public, anon;
grant select, insert, update, delete on public.drafts to authenticated;

drop policy if exists drafts_owner_select on public.drafts;
drop policy if exists drafts_owner_insert on public.drafts;
drop policy if exists drafts_owner_update on public.drafts;
drop policy if exists drafts_owner_delete on public.drafts;
create policy drafts_owner_select on public.drafts for select to authenticated using (owner_id = (select auth.uid()));
create policy drafts_owner_insert on public.drafts for insert to authenticated with check (owner_id = (select auth.uid()));
create policy drafts_owner_update on public.drafts for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy drafts_owner_delete on public.drafts for delete to authenticated using (owner_id = (select auth.uid()));

-- Drafts kept in public.stacks move here, with their ids, in the same shape the editor saves.
insert into public.drafts (id, owner_id, content, step, edit_of, remixed_from, created_at, updated_at)
select s.id, s.author_id,
       jsonb_build_object(
         'v', 1,
         'title', s.title,
         'description', coalesce(s.description, ''),
         'sections', coalesce(s.sections, '[]'::jsonb),
         'style', coalesce(s.style, 'numbered'),
         'visibility', coalesce(s.visibility, 'public'),
         'location', coalesce(s.location, ''),
         'tags', coalesce((select jsonb_agg(t.tag order by t.tag) from public.stack_tags t where t.stack_id = s.id), '[]'::jsonb)),
       'build', s.edit_of, s.forked_from_id, s.created_at, s.updated_at
  from public.stacks s
 where s.status = 'draft'
on conflict (id) do nothing;
delete from public.stacks where status = 'draft';

-- Publishes your draft p_id as a stack with the same id, and removes the draft. Calling it again for a draft
-- already published returns that stack and publishes nothing. The stack's own rules (limits, line formats)
-- are enforced as for any stack.
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

revoke execute on function public.publish_draft(uuid, text, jsonb, text[], text, text, text, text) from public, anon;
grant execute on function public.publish_draft(uuid, text, jsonb, text[], text, text, text, text) to authenticated;

-- apply_stack_edit: as in 20261008000000_share_update_rules, and it also removes the edits draft from drafts.
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

commit;
