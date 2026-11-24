#!/usr/bin/env bash
# Builds a clean database from web/supabase/migrations and prints its fingerprints.
# Needs a local Postgres you can create databases in (tested with Postgres 16).
# Usage: PGHOST=/tmp PGPORT=55432 PGUSER=postgres ./build-clean.sh > clean-fingerprints.txt
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
migrations="$here/../../../web/supabase/migrations"
db="${CLEAN_DB:-stack_clean}"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $db" -c "create database $db" >&2
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$here/stubs.sql" >&2
for f in "$migrations"/*.sql; do
  echo "applying $(basename "$f")" >&2
  psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$f" >/dev/null
done
psql -At -v ON_ERROR_STOP=1 -d "$db" -f "$here/fingerprint.sql"
