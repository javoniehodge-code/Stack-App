#!/usr/bin/env bash
# Builds a clean database from web/supabase/migrations in a new, uniquely named scratch
# database on a LOCAL Postgres, and prints its fingerprints.
#
# It only connects through a local Unix socket. Set PGHOST to the socket directory (an
# absolute path) and PGPORT to the port; any remote connection setting is refused before
# any SQL runs. It never drops anything: each run creates a new scratch database and
# leaves it in place (its name is printed at the end; drop it yourself when done).
#
# Usage:
#   PGHOST=/tmp PGPORT=55432 PGUSER=postgres ./build-clean.sh > clean-fingerprints.txt
set -euo pipefail

fail() { echo "build-clean: $*" >&2; exit 2; }

# --- Connection checks (no SQL runs until all of these pass) -------------------------
[ -n "${PGHOSTADDR:-}" ] && fail "PGHOSTADDR is set; it forces a network connection. Unset it."
[ -n "${PGSERVICE:-}" ] && fail "PGSERVICE is set; a service file can point anywhere. Unset it."
[ -n "${PGDATABASE:-}" ] && fail "PGDATABASE is set; unset it so the helper chooses its own databases."
host="${PGHOST:-}"
[ -n "$host" ] || fail "set PGHOST to the local Postgres socket directory, for example PGHOST=/tmp."
case "$host" in
  /*) ;;
  *) fail "PGHOST='$host' is not an absolute socket directory; remote hosts are refused." ;;
esac
case "$host" in
  *,* | *\'* | *\\* | *" "*) fail "PGHOST must be a single socket directory without commas, quotes, backslashes or spaces." ;;
esac
port="${PGPORT:-5432}"
[[ "$port" =~ ^[0-9]+$ ]] || fail "PGPORT='$port' is not a port number."
[ -S "$host/.s.PGSQL.$port" ] || fail "no Postgres socket at $host/.s.PGSQL.$port; start a local Postgres first."

# Every connection names the socket explicitly, so nothing else in the environment can redirect it.
conn() { printf "host='%s' port=%s dbname=%s" "$host" "$port" "$1"; }

here="$(cd "$(dirname "$0")" && pwd)"
migrations="$here/../../../web/supabase/migrations"
db="stack_clean_$(date -u +%Y%m%d%H%M%S)_$$_$RANDOM"

# --- Build --------------------------------------------------------------------------
# CREATE fails if the name already exists, and ON_ERROR_STOP + set -e stop the script.
psql -q -X -v ON_ERROR_STOP=1 -d "$(conn postgres)" -c "create database $db" >&2 \
  || fail "couldn't create scratch database $db; stopping."
echo "created scratch database $db" >&2
psql -q -X -v ON_ERROR_STOP=1 -d "$(conn "$db")" -f "$here/stubs.sql" >&2
for f in "$migrations"/*.sql; do
  echo "applying $(basename "$f")" >&2
  psql -q -X -v ON_ERROR_STOP=1 -d "$(conn "$db")" -f "$f" >/dev/null
done
psql -At -X -v ON_ERROR_STOP=1 -d "$(conn "$db")" -f "$here/fingerprint.sql"
echo "done; scratch database left in place: $db" >&2
