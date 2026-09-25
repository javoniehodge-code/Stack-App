-- Profile extras: social links, a pinned ("featured") stack with a caption,
-- one featured link button, and the order stacks appear in on a profile.

alter table public.profiles
  -- { x, instagram, tiktok, facebook, email, newsletter, booking, shop }: text,
  -- normalized by profiles_before_update. Empty links are dropped.
  add column socials jsonb not null default '{}'::jsonb,
  add column pinned_stack_id uuid references public.stacks (id) on delete set null,
  add column pin_note text not null default '' check (char_length(pin_note) <= 60),
  add column featured_link_label text check (char_length(featured_link_label) between 1 and 40),
  add column featured_link_url text check (
    featured_link_url ~* '^(https?://|mailto:)[^\s]+$' and char_length(featured_link_url) <= 2048),
  add constraint featured_link_complete check ((featured_link_label is null) = (featured_link_url is null));

-- Lower comes first on the author's profile; unordered (new) stacks come first.
alter table public.stacks add column profile_position int;

create or replace function public.profiles_before_update()
returns trigger
language plpgsql
as $$
declare
  k   text;
  v   text;
  cleaned jsonb := '{}'::jsonb;
begin
  if new.socials is distinct from old.socials then
    if new.socials is null or jsonb_typeof(new.socials) <> 'object' then
      raise exception 'socials must be an object' using errcode = '22023';
    end if;
    for k, v in select key, btrim(value) from jsonb_each_text(new.socials) loop
      continue when v is null or v = '';
      if k not in ('x', 'instagram', 'tiktok', 'facebook', 'email', 'newsletter', 'booking', 'shop') then
        raise exception 'unknown social link: %', k using errcode = '22023';
      end if;
      if char_length(v) > 200 then
        raise exception 'social links are limited to 200 characters' using errcode = '22023';
      end if;
      cleaned := cleaned || jsonb_build_object(k, v);
    end loop;
    new.socials := cleaned;
  end if;

  if new.pinned_stack_id is distinct from old.pinned_stack_id and new.pinned_stack_id is not null
     and not exists (
       select 1 from public.stacks s
        where s.id = new.pinned_stack_id and s.author_id = new.id and s.status = 'published')
  then
    raise exception 'you can only pin your own published stacks' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger profiles_before_update
  before update on public.profiles
  for each row execute function public.profiles_before_update();

grant update (socials, pinned_stack_id, pin_note, featured_link_label, featured_link_url)
  on public.profiles to authenticated;

-- Sets the order of the caller's stacks on their profile. `p_ids` is the full
-- order; ids that aren't the caller's are ignored.
create or replace function public.set_stack_order(p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'sign in required' using errcode = '42501';
  end if;
  update stacks s
     set profile_position = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where s.id = o.id and s.author_id = uid;
end;
$$;

revoke execute on function public.set_stack_order(uuid[]) from public, anon;
grant execute on function public.set_stack_order(uuid[]) to authenticated;
revoke execute on function public.profiles_before_update() from public, anon, authenticated;
