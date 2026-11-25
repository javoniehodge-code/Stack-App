-- Regression tests for 20261126000000_gmail_alias_accounts.sql. Run only on a disposable test database built from
-- the migrations (never on live). Each check raises an exception when it fails; everything is rolled back.
--   psql "host=/tmp port=55433 dbname=<test db> user=postgres" -v ON_ERROR_STOP=1 -f web/supabase/tests/gmail_alias_accounts.test.sql

begin;

-- 1. Inbox keys: Gmail ignores dots, +tags and case; every other domain only ignores case.
do $$
declare c record;
begin
  for c in select * from (values
    ('First.Last@gmail.com',          'firstlast@gmail.com'),
    ('firstlast@gmail.com',           'firstlast@gmail.com'),
    ('f.i.r.s.t.last+stack@GMAIL.com', 'firstlast@gmail.com'),
    ('firstlast+a.b@gmail.com',       'firstlast@gmail.com'),
    ('  firstlast@gmail.com ',        'firstlast@gmail.com'),
    ('first.last@company.test',       'first.last@company.test'),
    ('firstlast@company.test',        'firstlast@company.test'),
    ('first.last+tag@company.test',   'first.last+tag@company.test'),
    ('first.last@googlemail.com',     'first.last@googlemail.com'),
    ('first.last@gmail.com.evil.test','first.last@gmail.com.evil.test')
  ) as t(input, expected) loop
    if private.email_key(c.input) <> c.expected then
      raise exception 'FAIL 1: email_key(%) = %, expected %', c.input, private.email_key(c.input), c.expected;
    end if;
  end loop;
end $$;

-- Test accounts (created in this transaction only).
insert into auth.users (id, email) values
  ('a1a1a1a1-0000-4000-8000-0000000000a1', 'gtest.first.last@gmail.com'),
  ('b2b2b2b2-0000-4000-8000-0000000000b2', 'w.first.last@company.test');

-- 2. A second account for the same Gmail inbox is refused, whichever alias it uses.
do $$
declare e text;
begin
  foreach e in array array['gtestfirstlast@gmail.com', 'gtestfirstlast+stack@gmail.com', 'G.Test.First.Last@Gmail.com'] loop
    begin
      insert into auth.users (id, email) values (gen_random_uuid(), e);
      raise exception 'FAIL 2: a second account was created for the same inbox as %', e;
    exception when unique_violation then null;
    end;
  end loop;
end $$;

-- 3. Work (non-Gmail) addresses that differ only by dots stay separate accounts.
do $$ begin
  insert into auth.users (id, email) values ('c3c3c3c3-0000-4000-8000-0000000000c3', 'wfirstlast@company.test');
exception when unique_violation then
  raise exception 'FAIL 3: w.first.last@company.test and wfirstlast@company.test were treated as one inbox';
end $$;

-- 4. Task 1b precondition: an account created by Google sign-in (another provider, same inbox) is refused too.
do $$ begin
  insert into auth.users (id, email, raw_app_meta_data)
  values (gen_random_uuid(), 'gtestfirstlast@gmail.com', '{"provider":"google","providers":["google"]}');
  raise exception 'FAIL 4: a Google-created account was allowed for an inbox that already has an account';
exception when unique_violation then null;
end $$;

-- 5. Resolving the address to send a code to, with the server's token.
insert into private.server_tokens (name, token_sha256) values ('sign_in_resolver', sha256(convert_to('test-token', 'UTF8')))
on conflict (name) do update set token_sha256 = excluded.token_sha256;
do $$
declare c record;
begin
  for c in select * from (values
    ('gtestfirstlast@gmail.com',           'gtest.first.last@gmail.com'),
    ('GTestFirstLast+stack@gmail.com',     'gtest.first.last@gmail.com'),
    ('g.t.e.s.t.f.i.r.s.t.l.a.s.t@gmail.com', 'gtest.first.last@gmail.com'),
    ('gtest.first.last@gmail.com',         'gtest.first.last@gmail.com'),
    ('wfirstlast@company.test',            'wfirstlast@company.test'),
    ('w.first.last@company.test',          'w.first.last@company.test'),
    ('Brand.New+x@gmail.com',              'brand.new+x@gmail.com')
  ) as t(input, expected) loop
    if public.resolve_sign_in_email(c.input, 'test-token') <> c.expected then
      raise exception 'FAIL 5: resolve(%) = %, expected %', c.input, public.resolve_sign_in_email(c.input, 'test-token'), c.expected;
    end if;
  end loop;
end $$;

-- 6. Without the right token, nobody can resolve addresses (so a browser can't probe for accounts).
do $$ begin
  perform public.resolve_sign_in_email('gtestfirstlast@gmail.com', 'wrong-token');
  raise exception 'FAIL 6: a wrong token was accepted';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.resolve_sign_in_email('gtestfirstlast@gmail.com', null);
  raise exception 'FAIL 6: a missing token was accepted';
exception when insufficient_privilege then null;
end $$;

-- 7. Changing an account's email moves its key; deleting an account frees it.
do $$ begin
  update auth.users set email = 'w.moved@company.test' where id = 'b2b2b2b2-0000-4000-8000-0000000000b2';
  if not exists (select 1 from private.account_email_keys where user_id = 'b2b2b2b2-0000-4000-8000-0000000000b2' and email_key = 'w.moved@company.test')
     or exists (select 1 from private.account_email_keys where email_key = 'w.first.last@company.test') then
    raise exception 'FAIL 7: the key did not move with the email change';
  end if;
  delete from auth.users where id = 'a1a1a1a1-0000-4000-8000-0000000000a1';
  insert into auth.users (id, email) values ('d4d4d4d4-0000-4000-8000-0000000000d4', 'gtestfirstlast+again@gmail.com');
exception when unique_violation then
  raise exception 'FAIL 7: a deleted account still held its inbox';
end $$;

-- 8. Signed-out and signed-in users can't read the keys, the collision list or the tokens.
set local role anon;
do $$ begin
  perform 1 from private.account_email_keys;
  raise exception 'FAIL 8: anon could read private.account_email_keys';
exception when insufficient_privilege then null;
end $$;
reset role;
set local role authenticated;
do $$ begin
  perform 1 from private.server_tokens;
  raise exception 'FAIL 8: a signed-in user could read private.server_tokens';
exception when insufficient_privilege then null;
end $$;
reset role;

select 'all gmail_alias_accounts checks passed' as result;
rollback;
