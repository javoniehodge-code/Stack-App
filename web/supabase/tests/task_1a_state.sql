-- Read-only: reports whether 20261125000000_email_code_sign_in is in effect, in the schema and in Supabase's
-- migration history. Used by the rollout (docs/party-mode-task-1a-rollout.md) after apply, rollback and retry.
-- Expected after apply/retry:  schema = applied,     history = recorded
-- Expected after rollback:     schema = rolled back, history = not recorded
-- Anything else (mixed, or schema and history disagreeing) means stop and reconcile before going on.
begin read only;
with checks as (
  select
    to_regprocedure('public.create_profile(text,text)') is not null                    as has_create_profile,
    to_regprocedure('public.handle_available(text)') is not null                        as has_handle_available,
    exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'reject_old_signup')   as has_guard,
    exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') as has_old_trigger,
    coalesce((select pg_get_constraintdef(oid) like '%handle_is_reserved%' from pg_constraint where conname = 'profiles_handle_check'), false) as has_new_handle_rule,
    to_regclass('supabase_migrations.schema_migrations') is not null                    as has_history_table
), history as (
  -- The history table may not exist yet (as on the live project before rollout step 4), so it's read only if present.
  select case when (select has_history_table from checks)
    then (xpath('/row/n/text()', query_to_xml('select count(*) filter (where version = ''20261125000000'') as n from supabase_migrations.schema_migrations', false, true, '')))[1]::text::int
    else 0 end as recorded,
  case when (select has_history_table from checks)
    then (xpath('/row/n/text()', query_to_xml('select count(*) as n from supabase_migrations.schema_migrations', false, true, '')))[1]::text::int
    else 0 end as rows
)
select
  case
    when c.has_guard and c.has_new_handle_rule and not c.has_old_trigger and c.has_create_profile then 'applied'
    when not c.has_guard and not c.has_new_handle_rule and c.has_old_trigger then 'rolled back'
    else 'MIXED'
  end as schema,
  case when h.recorded > 0 then 'recorded' else 'not recorded' end as history,
  case when c.has_history_table then h.rows::text else 'no history table' end as history_rows
from checks c, history h;
rollback;
