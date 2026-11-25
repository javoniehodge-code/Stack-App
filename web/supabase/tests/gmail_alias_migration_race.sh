#!/usr/bin/env bash
# Sign-ups and an email change while 20261126000000_gmail_alias_accounts is being applied. Builds a new scratch
# database (stack_test_race_*) on a LOCAL Postgres from the migrations before it, then:
#   t=0s  sign-up A (early.<run>@gmail.com) starts and stays uncommitted for 2s
#   t=0.5 the migration starts (held open 3s after it finishes, as a slow migration would be)
#   t=3s  sign-up B (late.<run>@gmail.com), sign-up C (an alias of A's inbox) and an email change D start
# Expected: A gets its key (it committed before the migration could start), B gets its key through the trigger,
# C is refused (A owns the inbox), D's key follows its new address, and no account is left without a key.
#
#   [TABLES_EXIST=1] gmail_alias_migration_race.sh [migration file]      (needs PGHOST=<socket dir> PGPORT PGUSER; default file is
#                                                        supabase/migrations/20261126000000_gmail_alias_accounts.sql)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$here/../.."
mig="${1:-$repo/supabase/migrations/20261126000000_gmail_alias_accounts.sql}"
[[ "${PGHOST:-}" == /* ]] || { echo "refusing: set PGHOST to a local socket directory" >&2; exit 2; }
db="stack_test_race_$(date +%s)_$$"
run=$(date +%s%N | tail -c 9)
P=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$db")
psql -X -q -v ON_ERROR_STOP=1 -d postgres -c "create database $db"
"${P[@]}" -f "$repo/../docs/party-mode-audit/schema-compare/stubs.sql" >/dev/null
for f in "$repo"/supabase/migrations/*.sql; do
  [[ "$(basename "$f")" < "20261126000000" ]] || continue
  "${P[@]}" -f "$f" >/dev/null 2>&1
done
"${P[@]}" -c "insert into auth.users (id, email) values (gen_random_uuid(), 'pre.$run@company.test')"
# TABLES_EXIST=1: the private tables already exist (say, a retry after a partial run), so creating them takes no
# lock on auth.users. Only the migration's own lock then holds off sign-ups.
if [[ "${TABLES_EXIST:-0}" == 1 ]]; then
  "${P[@]}" -c "create schema private;
    create table private.account_email_keys (email_key text primary key, user_id uuid not null unique references auth.users (id) on delete cascade);
    create table private.email_key_collisions (email_key text not null, user_id uuid not null, email text not null, found_at timestamptz not null default now(), primary key (email_key, user_id));"
fi

tmp=$(mktemp -d)
wrapper="$tmp/migration.sql"
# Hold the migration's transaction open 3s before it commits. A file with its own begin/commit gets the pause
# inserted before its commit; one without is wrapped in a transaction.
if grep -q '^begin;' "$mig"; then
  sed 's/^commit;$/select pg_sleep(3);\ncommit;/' "$mig" > "$wrapper"
else
  printf 'begin;\n\\i %s\nselect pg_sleep(3);\ncommit;\n' "$mig" > "$wrapper"
fi

( "${P[@]}" -c "begin; insert into auth.users (id, email) values (gen_random_uuid(), 'early.$run@gmail.com'); select pg_sleep(2); commit;" >/dev/null 2>"$tmp/a.err" && echo 0 > "$tmp/a" || echo $? > "$tmp/a" ) &
sleep 0.5
( "${P[@]}" -f "$wrapper" >/dev/null 2>"$tmp/m.err" && echo 0 > "$tmp/m" || echo $? > "$tmp/m" ) &
sleep 2.5
( "${P[@]}" -c "insert into auth.users (id, email) values (gen_random_uuid(), 'late.$run@gmail.com')" >/dev/null 2>"$tmp/b.err" && echo 0 > "$tmp/b" || echo $? > "$tmp/b" ) &
( "${P[@]}" -c "insert into auth.users (id, email) values (gen_random_uuid(), 'earl.y.$run+x@gmail.com')" >/dev/null 2>"$tmp/c.err" && echo 0 > "$tmp/c" || echo $? > "$tmp/c" ) &
( "${P[@]}" -c "update auth.users set email = 'moved.$run@gmail.com' where email = 'pre.$run@company.test'" >/dev/null 2>"$tmp/d.err" && echo 0 > "$tmp/d" || echo $? > "$tmp/d" ) &
wait

q() { "${P[@]}" -c "$1"; }
key_of() { q "select coalesce((select k.email_key from private.account_email_keys k join auth.users u on u.id = k.user_id where u.email = '$1'), 'NONE')"; }
fails=0
expect() { if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (got: $2, expected: $3)"; fails=$((fails+1)); fi; }

expect "migration committed" "$(cat "$tmp/m")" "0"
expect "A (signed up just before the migration) committed" "$(cat "$tmp/a")" "0"
expect "A has its inbox key" "$(key_of "early.$run@gmail.com")" "early$run@gmail.com"
expect "B (signed up during the migration) committed after it" "$(cat "$tmp/b")" "0"
expect "B has its inbox key" "$(key_of "late.$run@gmail.com")" "late$run@gmail.com"
expect "C (an alias of A's inbox, during the migration) was refused" "$(cat "$tmp/c")$(grep -c 'another account already uses this email inbox' "$tmp/c.err" || true)" "11"
expect "D (email changed during the migration) has the key for its new address" "$(key_of "moved.$run@gmail.com")" "moved$run@gmail.com"
expect "no account is left without a key" "$(q "select count(*) from auth.users u where u.email is not null and u.email <> '' and not exists (select 1 from private.account_email_keys k where k.user_id = u.id)")" "0"
expect "one account per inbox" "$(q "select count(*) from (select private.email_key(email) from auth.users group by 1 having count(*) > 1) d")" "0"
rm -rf "$tmp"
echo "scratch database left in place: $db"
[[ $fails == 0 ]] && echo "all migration-race checks passed" || { echo "$fails migration-race checks failed"; exit 1; }
