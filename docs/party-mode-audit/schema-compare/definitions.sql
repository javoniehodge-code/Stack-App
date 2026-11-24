-- Full definitions, for looking at an object whose fingerprint differs. Read-only.
-- Usage (psql): psql ... -v key="'function notify_on_follow()'" -f definitions.sql
with items(k, d) as (
  select 'column '||c.relname||'.'||a.attname, format_type(a.atttypid,a.atttypmod)||case when a.attnotnull then ' not null' else '' end||coalesce(' default '||pg_get_expr(ad.adbin,ad.adrelid),'')
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum
   where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
  union all select 'table '||c.relname, 'rls='||c.relrowsecurity||' force='||c.relforcerowsecurity from pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r'
  union all select 'constraint '||c.relname||'.'||co.conname, pg_get_constraintdef(co.oid) from pg_constraint co join pg_class c on c.oid=co.conrelid where c.relnamespace='public'::regnamespace
  union all select 'index '||i.indexname, i.indexdef from pg_indexes i where i.schemaname='public'
  union all select 'function '||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', pg_get_functiondef(p.oid) from pg_proc p where p.pronamespace='public'::regnamespace
  union all select 'function-exec '||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', 'anon='||has_function_privilege('anon',p.oid,'execute')||' authenticated='||has_function_privilege('authenticated',p.oid,'execute') from pg_proc p where p.pronamespace='public'::regnamespace
  union all select 'trigger '||c.relname||'.'||t.tgname, pg_get_triggerdef(t.oid) from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and (c.relnamespace='public'::regnamespace or t.tgname='on_auth_user_created')
  union all select 'policy '||tablename||'.'||policyname, cmd||' to '||roles::text||' using '||coalesce(qual,'-')||' check '||coalesce(with_check,'-') from pg_policies where schemaname='public'
  union all select 'grant '||table_name||' '||grantee, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') group by table_name, grantee
)
select k, d from items where k = :key;
