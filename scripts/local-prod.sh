#!/usr/bin/env bash
# Production build of vidalo-web + vidalo-worker, run locally in workerd
# (wrangler dev, both configs, one process) against the database named in
# the root .env. Nothing is deployed; vidalo.io is not touched.
#
#   pnpm --filter @vidalo/web cf:build      # first; stop `next dev` before (both write apps/web/.next)
#   bash scripts/local-prod.sh              # then open http://localhost:8787
#
# The connection string goes to wrangler through the environment variable
# Hyperdrive reads locally, never into a file. VIDALO_ENV_FILE points at
# another .env (a worktree has none of its own).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVFILE="${VIDALO_ENV_FILE:-$ROOT/.env}"
read_env() { node --env-file="$ENVFILE" -e "process.stdout.write(process.env['$1']||'')"; }
URL="$(read_env DATABASE_URL)"
[ -n "$URL" ] || { echo "DATABASE_URL is missing in $ENVFILE"; exit 1; }
export CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="$URL"
VARS=(--var PUBLIC_BASE_URL:http://localhost:8787)
for k in SUPABASE_URL SUPABASE_ANON_KEY; do
  v="$(read_env "$k")"; [ -n "$v" ] && VARS+=(--var "$k:$v")
done
cd "$ROOT/apps/web"
exec ./node_modules/.bin/wrangler dev -c wrangler.jsonc -c ../worker/wrangler.jsonc --port 8787 "${VARS[@]}"
