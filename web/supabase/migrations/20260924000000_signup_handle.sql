-- Use the username chosen at sign-up (raw_user_meta_data.handle) when it is
-- valid and free; otherwise fall back to one generated from the email.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted    text := lower(btrim(coalesce(new.raw_user_meta_data ->> 'handle', '')));
  base      text;
  candidate text;
  display   text;
begin
  if wanted ~ '^[a-z0-9._]{2,30}$' and not exists (select 1 from public.profiles where handle = wanted) then
    candidate := wanted;
  else
    base := lower(regexp_replace(split_part(coalesce(new.email, 'user'), '@', 1), '[^a-zA-Z0-9._]', '', 'g'));
    if char_length(base) < 2 then base := 'user'; end if;
    base := left(base, 24);
    candidate := base;
    while exists (select 1 from public.profiles where handle = candidate) loop
      candidate := base || floor(random() * 10000)::int::text;
    end loop;
  end if;
  display := coalesce(nullif(btrim(new.raw_user_meta_data ->> 'name'), ''), split_part(coalesce(new.email, 'New user'), '@', 1));
  insert into public.profiles (id, handle, name) values (new.id, candidate, left(display, 50));
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
