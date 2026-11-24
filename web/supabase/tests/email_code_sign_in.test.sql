-- Regression tests for 20261125000000_email_code_sign_in.sql. Run against a scratch database built from the
-- migrations (see docs/party-mode-audit/schema-compare/build-clean.sh), never against a shared database:
--   psql "host=/tmp port=55432 dbname=<scratch db>" -v ON_ERROR_STOP=1 -f web/supabase/tests/email_code_sign_in.test.sql
-- Each check raises an exception when it fails. Everything runs in one transaction that is rolled back.

begin;

-- Test accounts: one existing user with a profile (made the old way), one brand-new user without one.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'existing@test.invalid'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'new@test.invalid');
insert into public.profiles (id, handle, name) values ('aaaaaaaa-0000-4000-8000-00000000000a', 'existing.user', 'Existing User');

-- 1. Creating an auth user no longer creates a profile on its own.
do $$ begin
  if exists (select 1 from public.profiles where id = 'bbbbbbbb-0000-4000-8000-00000000000b') then
    raise exception 'FAIL 1: a profile was created automatically for a new auth user';
  end if;
end $$;

-- Act as the new user (the test stand-in auth.uid() reads this setting).
set local role authenticated;
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-4000-8000-00000000000b', true);

-- 2. Before setup, the new account can't be found through the profiles API.
do $$ begin
  if exists (select 1 from public.profiles where id = 'bbbbbbbb-0000-4000-8000-00000000000b')
     or not exists (select 1 from public.profiles where id = 'aaaaaaaa-0000-4000-8000-00000000000a') then
    raise exception 'FAIL 2: before setup the new account should have no profile, while existing profiles stay visible';
  end if;
end $$;

-- 3. Username rules: too short, bad edges, reserved, taken.
do $$
declare h text;
begin
  foreach h in array array['ab', '.dot', 'under_', 'explore', 'me', 'stack', 'create', 'u'] loop
    if public.handle_available(h) then raise exception 'FAIL 3: % should not be available', h; end if;
    begin
      perform public.create_profile('New Person', h);
      raise exception 'FAIL 3: create_profile accepted %', h;
    exception when sqlstate '22023' then null;
    end;
  end loop;
  if public.handle_available('existing.user') then raise exception 'FAIL 3: a taken username showed as available'; end if;
  begin
    perform public.create_profile('New Person', 'existing.user');
    raise exception 'FAIL 3: create_profile accepted a taken username';
  exception when unique_violation then null;
  end;
  if not public.handle_available('new.person') then raise exception 'FAIL 3: a free username showed as taken'; end if;
end $$;

-- 4. A blank name is refused.
do $$ begin
  perform public.create_profile('   ', 'new.person');
  raise exception 'FAIL 4: a blank name was accepted';
exception when sqlstate '22023' then null;
end $$;

-- 5. Setup creates the profile with the chosen name and username (normalized), and a retry returns the same row.
do $$
declare p1 public.profiles; p2 public.profiles;
begin
  p1 := public.create_profile('  New   Person ', '@New.Person');
  if p1.id <> 'bbbbbbbb-0000-4000-8000-00000000000b' or p1.handle <> 'new.person' or p1.name <> 'New Person' then
    raise exception 'FAIL 5: unexpected profile %', row_to_json(p1);
  end if;
  p2 := public.create_profile('Someone Else', 'other.name');
  if p2.handle <> 'new.person' or p2.name <> 'New Person' then
    raise exception 'FAIL 5: a retry changed the profile %', row_to_json(p2);
  end if;
  if (select count(*) from public.profiles where id = p1.id) <> 1 then
    raise exception 'FAIL 5: more than one profile for the account';
  end if;
end $$;

-- 6. Users can't insert a profile directly, and a profile edit can't switch to a reserved or invalid username.
do $$ begin
  insert into public.profiles (id, handle, name) values ('bbbbbbbb-0000-4000-8000-00000000000b', 'sneaky', 'x');
  raise exception 'FAIL 6: a direct insert was allowed';
exception when insufficient_privilege or unique_violation then null;
end $$;
do $$ begin
  update public.profiles set handle = 'settings' where id = 'bbbbbbbb-0000-4000-8000-00000000000b';
  raise exception 'FAIL 6: a reserved username was saved by an edit';
exception when check_violation then null;
end $$;

-- 7. The existing account is untouched: same id, handle and name.
do $$ begin
  if not exists (select 1 from public.profiles where id = 'aaaaaaaa-0000-4000-8000-00000000000a' and handle = 'existing.user' and name = 'Existing User') then
    raise exception 'FAIL 7: the existing profile changed';
  end if;
end $$;

reset role;

-- 8. Signed-out visitors can't call either function.
set local role anon;
do $$ begin
  perform public.handle_available('anything');
  raise exception 'FAIL 8: anon could call handle_available';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.create_profile('x', 'anything');
  raise exception 'FAIL 8: anon could call create_profile';
exception when insufficient_privilege then null;
end $$;
reset role;

select 'all email_code_sign_in checks passed' as result;
rollback;
