#!/usr/bin/env bash
# Prove PgDb against a real Postgres: a fresh database, the auth shim, every
# migration in order, then the db tests and the whole mock pipeline on it.
#
#   PG_ADMIN_URL=postgresql://postgres:postgres@localhost:5432/postgres pnpm verify:pg
set -euo pipefail
cd "$(dirname "$0")/.."

ADMIN="${PG_ADMIN_URL:-postgresql://postgres:postgres@localhost:5432/postgres}"
NAME="vidalo_verify"
URL="${ADMIN%/*}/$NAME"

psql "$ADMIN" -qX -v ON_ERROR_STOP=1 -c "drop database if exists $NAME" -c "create database $NAME" 2>&1 | grep -v NOTICE || true
psql "$URL" -qX -v ON_ERROR_STOP=1 -f scripts/local-auth-shim.sql
for f in supabase/migrations/*.sql; do
  echo "migrate: $f"
  psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$f"
done

(cd packages/core && TEST_DATABASE_URL="$URL" npx vitest run test/db.test.ts)

psql "$URL" -qX -c "truncate claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist restart identity cascade"
VIDALO_DB=pg DATABASE_URL="$URL" pnpm e2e:mock | grep -E '^(==|OK|free scan|latest scan|findings:)'

rows=$(psql "$URL" -tAX -c "select count(*) from sample")
[ "$rows" -gt 0 ] || { echo "FAIL: the pipeline wrote no samples to Postgres ($URL)"; exit 1; }
echo "OK verify:pg — $rows samples in Postgres"
