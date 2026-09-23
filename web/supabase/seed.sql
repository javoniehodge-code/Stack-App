-- Demo content for local development (`supabase db reset` runs this).
-- Mirrors the sample creators and stacks from the design prototype.
-- Like/save/fork counts are set directly so the demo looks lived-in; they are
-- not backed by real like rows.

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'renata@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{"name":"Renata Díaz"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-4222-8222-222222222222', 'authenticated', 'authenticated', 'marcus@example.com', '', now(), '{"provider":"email","providers":["email"]}', '{"name":"Marcus Webb"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-4333-8333-333333333333', 'authenticated', 'authenticated', 'june@example.com',   '', now(), '{"provider":"email","providers":["email"]}', '{"name":"June Ostrander"}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', '44444444-4444-4444-8444-444444444444', 'authenticated', 'authenticated', 'kenji@example.com',  '', now(), '{"provider":"email","providers":["email"]}', '{"name":"Kenji Sato"}', now(), now());

update public.profiles set handle = 'renata.diaz',  bio = 'Bartender turned travel writer. Mostly Mexico City, sometimes Oaxaca.' where id = '11111111-1111-4111-8111-111111111111';
update public.profiles set handle = 'marcus.reads', bio = 'Reading 50 books a year and ranking all of them.' where id = '22222222-2222-4222-8222-222222222222';
update public.profiles set handle = 'junehome',     bio = 'Small apartment, good objects. Etsy archaeologist.' where id = '33333333-3333-4333-8333-333333333333';
update public.profiles set handle = 'kenji.eats',   bio = 'Will wait in any line for noodles.' where id = '44444444-4444-4444-8444-444444444444';

insert into public.stacks (id, author_id, title, style, status, published_at, sections) values
(
  'aaaaaaaa-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
  'Mexico City Bars', 'numbered', 'published', now() - interval '2 days',
  '[
    {"label":"Roma Norte","lines":[
      {"text":"Licorería Limantour — no menu, just tell them what you like","link":"https://limantour.com.mx"},
      {"text":"Departamento — rooftop, arrive before 8pm or wait an hour","link":"https://departamento.mx"},
      {"text":"Baltra Bar — unmarked door, ring the bell twice"}]},
    {"label":"Condesa","lines":[
      {"text":"Bling Bling Bar — natural wine, seats six people max"},
      {"text":"Mono — mezcal flights, go on a Tuesday"}]},
    {"label":"Centro","lines":[
      {"text":"Hanky Panky — speakeasy behind a taxidermy shop"},
      {"text":"Salón Cielito Lindo — cheap micheladas, plastic chairs, perfect"}]}
  ]'
),
(
  'aaaaaaaa-0000-4000-8000-000000000002', '22222222-2222-4222-8222-222222222222',
  'Books That Actually Changed How I Think', 'bulleted', 'published', now() - interval '5 days',
  '[
    {"label":null,"lines":[
      {"text":"Meditations — Marcus Aurelius","link":"https://bookshop.org/meditations"},
      {"text":"The Selfish Gene — Richard Dawkins"},
      {"text":"Man''s Search for Meaning — Viktor Frankl"},
      {"text":"Sapiens — Yuval Noah Harari","link":"https://bookshop.org/sapiens"},
      {"text":"Thinking, Fast and Slow — Daniel Kahneman"},
      {"text":"Zen and the Art of Motorcycle Maintenance — Robert Pirsig"}]}
  ]'
),
(
  'aaaaaaaa-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333',
  'Etsy Finds Worth the Shipping Wait', 'bulleted', 'published', now() - interval '7 days',
  '[
    {"label":"For the kitchen","lines":[
      {"text":"Hand-thrown mug from ClayAndKin — every one is slightly different","link":"https://etsy.com/shop/clayandkin"},
      {"text":"Linen napkins from FieldFolkCo — get the oat color, not white","link":"https://etsy.com/shop/fieldfolkco"}]},
    {"label":"For the desk","lines":[
      {"text":"Brass paperweight from OrsoStudio — heavier than it looks, worth it","link":"https://etsy.com/shop/orsostudio"},
      {"text":"Letterpress notepad from PressAndPaper — refills are cheap"}]}
  ]'
),
(
  'aaaaaaaa-0000-4000-8000-000000000004', '44444444-4444-4444-8444-444444444444',
  'Tokyo Ramen Worth the Line', 'numbered', 'published', now() - interval '3 days',
  '[
    {"label":"Shibuya","lines":[
      {"text":"Fuunji — cold dipping noodles, go before 11am","link":"https://fuunji.jp"},
      {"text":"Nagi — spicy niboshi broth, expect a 40 min wait"}]},
    {"label":"Shinjuku","lines":[
      {"text":"Fuutou — thick tonkotsu, cash only"}]}
  ]'
);

insert into public.stack_tags (stack_id, tag) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Travel'),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Food & Drink'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'Books'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'Shopping'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'Home'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'Travel'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'Food & Drink');

insert into public.comments (stack_id, author_id, body, created_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', '22222222-2222-4222-8222-222222222222', 'Baltra Bar is no joke, bring cash.', now() - interval '40 hours'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333', 'Went to Limantour off this list, worth the wait.', now() - interval '30 hours'),
  ('aaaaaaaa-0000-4000-8000-000000000001', '44444444-4444-4444-8444-444444444444', 'Adding Mono to my next trip because of this.', now() - interval '20 hours'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333', 'Reread Meditations every winter now, thank you.', now() - interval '4 days'),
  ('aaaaaaaa-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 'Sapiens changed how I think about basically everything.', now() - interval '3 days'),
  ('aaaaaaaa-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 'The paperweight is heavier than I expected, love it.', now() - interval '6 days'),
  ('aaaaaaaa-0000-4000-8000-000000000004', '22222222-2222-4222-8222-222222222222', 'Fuunji line moves fast if you go right at open.', now() - interval '2 days'),
  ('aaaaaaaa-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333', 'Nagi wait was worth every minute.', now() - interval '1 day');

insert into public.follows (follower_id, followee_id) values
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'),
  ('11111111-1111-4111-8111-111111111111', '44444444-4444-4444-8444-444444444444'),
  ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111'),
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222');

insert into public.reposts (user_id, stack_id) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000004'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-4000-8000-000000000002'),
  ('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-0000-4000-8000-000000000001'),
  ('44444444-4444-4444-8444-444444444444', 'aaaaaaaa-0000-4000-8000-000000000003');

-- Demo engagement numbers (after comments so the counter triggers don't overwrite them).
update public.stacks set likes_count = 842,  saves_count = 310, forks_count = 96  where id = 'aaaaaaaa-0000-4000-8000-000000000001';
update public.stacks set likes_count = 1204, saves_count = 588, forks_count = 210 where id = 'aaaaaaaa-0000-4000-8000-000000000002';
update public.stacks set likes_count = 356,  saves_count = 190, forks_count = 44  where id = 'aaaaaaaa-0000-4000-8000-000000000003';
update public.stacks set likes_count = 675,  saves_count = 240, forks_count = 71  where id = 'aaaaaaaa-0000-4000-8000-000000000004';
