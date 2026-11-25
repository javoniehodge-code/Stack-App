#!/usr/bin/env bash
# Two sign-ups for the same Gmail inbox at the same moment: exactly one account may be created. Runs two database
# sessions against a disposable stack_test_* database (local socket only) and removes its test accounts after.
#   gmail_alias_concurrency.sh "host=/tmp port=55433 dbname=stack_test_x user=postgres"
set -euo pipefail
DB=$1
[[ "$DB" =~ host=/ && "$DB" =~ dbname=stack_test_[a-z0-9_]+ ]] || { echo "refusing: not a local stack_test_* database" >&2; exit 2; }
P=(psql -X -q -At "$DB")
run=$(date +%s%N)
a="race.$run@gmail.com"; b="race$run+b@gmail.com"; key="race$run@gmail.com"
cleanup() { "${P[@]}" -c "delete from auth.users where email in ('$a','$b')" >/dev/null; }
trap cleanup EXIT

# Session A holds its new account uncommitted for 3 seconds; session B tries the same inbox meanwhile.
( "${P[@]}" -c "begin; insert into auth.users (id, email) values (gen_random_uuid(), '$a'); select pg_sleep(3); commit;" >/dev/null 2>&1 && echo "A committed" || echo "A failed" ) > /tmp/race-a.$run &
sleep 1
start=$(date +%s)
if "${P[@]}" -c "insert into auth.users (id, email) values (gen_random_uuid(), '$b')" >/dev/null 2>/tmp/race-b-err.$run; then resB="B committed"; else resB="B refused: $(grep -o 'another account already uses this email inbox' /tmp/race-b-err.$run || cat /tmp/race-b-err.$run)"; fi
waited=$(( $(date +%s) - start ))
wait
resA=$(cat /tmp/race-a.$run); rm -f /tmp/race-a.$run /tmp/race-b-err.$run
n=$("${P[@]}" -c "select count(*) from auth.users u join private.account_email_keys k on k.user_id = u.id where k.email_key = '$key'")
total=$("${P[@]}" -c "select count(*) from auth.users where email in ('$a','$b')")
echo "$resA; $resB (waited ${waited}s for A); accounts for the inbox: $total"
[[ "$resA" == "A committed" && "$resB" == B\ refused:* && "$total" == 1 && "$n" == 1 && "$waited" -ge 1 ]] && echo "PASS concurrent sign-ups: one account" || { echo "FAIL"; exit 1; }
