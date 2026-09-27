-- Adds YouTube to the social links a profile can save. Same function as in
-- profile_featured, with 'youtube' added to the allowed keys.

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
      if k not in ('x', 'instagram', 'tiktok', 'facebook', 'youtube', 'email', 'newsletter', 'booking', 'shop') then
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
