#!/usr/bin/env bash
# A real Stripe test-mode checkout against the local app, webhooks included.
#
#   pnpm e2e:stripe
#
# Reads the Stripe lines from the root .env of the main checkout (or
# E2E_ENV_FILE), refuses anything but a test key, forwards webhooks with
# `stripe listen` (the Stripe CLI, `brew install stripe/stripe-cli/stripe`),
# runs the @stripe browser tests, then checks that every webhook delivery
# was answered 200. Nothing here touches live mode.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${E2E_ENV_FILE:-$(git rev-parse --path-format=absolute --git-common-dir)/../.env}"
[ -f "$ENV_FILE" ] || { echo "✗ no env file at $ENV_FILE"; exit 1; }
command -v stripe >/dev/null || { echo "✗ Stripe CLI missing: brew install stripe/stripe-cli/stripe"; exit 1; }

# Only the Stripe lines, never echoed. (A loop, not `source <(...)`: macOS's bash 3.2 reads nothing from that.)
while IFS= read -r line; do
  key="${line%%=*}"; value="${line#*=}"; value="${value%\"}"; value="${value#\"}"
  export "$key=$value"
done < <(grep -E '^(STRIPE_SECRET_KEY|STRIPE_PRICE_SETUP|STRIPE_PRICE_MONITOR|STRIPE_TAX_RATE_ID|STRIPE_PORTAL_CONFIGURATION|VIDALO_STRIPE_ACCOUNT)=' "$ENV_FILE")
case "${STRIPE_SECRET_KEY:-}" in
  sk_test_*|rk_test_*) ;;
  *) echo "✗ STRIPE_SECRET_KEY must be a test key"; exit 1 ;;
esac
for v in STRIPE_PRICE_SETUP STRIPE_PRICE_MONITOR STRIPE_TAX_RATE_ID; do
  [ -n "${!v:-}" ] || { echo "✗ $v is not set (pnpm stripe:setup --apply prints it)"; exit 1; }
done

PORT="${E2E_PORT:-3100}"
mkdir -p out
LOG=out/stripe-listen.log
STRIPE_WEBHOOK_SECRET="$(stripe listen --api-key "$STRIPE_SECRET_KEY" --print-secret)"
export STRIPE_WEBHOOK_SECRET
# The events the app handles, read from the billing module so the two cannot drift.
EVENTS="$(sed -n '/STRIPE_WEBHOOK_EVENTS = \[/,/\]/p' packages/core/src/billing/index.ts | grep -oE '"[a-z_.]+"' | tr -d '"' | paste -sd, -)"
[ -n "$EVENTS" ] || { echo "✗ could not read STRIPE_WEBHOOK_EVENTS"; exit 1; }
stripe listen --api-key "$STRIPE_SECRET_KEY" --events "$EVENTS" --forward-to "localhost:$PORT/api/stripe/webhook" >"$LOG" 2>&1 &
LISTEN=$!
trap 'kill $LISTEN 2>/dev/null || true' EXIT
until grep -q "Ready!" "$LOG"; do
  kill -0 $LISTEN 2>/dev/null || { echo "✗ stripe listen stopped:"; cat "$LOG"; exit 1; }
  sleep 1
done

status=0
E2E_MODE=stripe npx playwright test "$@" || status=$?

sleep 5 # the last deliveries
kill $LISTEN 2>/dev/null || true
delivered=$(grep -cE '\[200\] POST' "$LOG" || true)
failed=$(grep -E '\[(4|5)[0-9]{2}\] POST' "$LOG" || true)
echo "webhooks answered 200: $delivered"
grep -oE '(checkout\.session\.[a-z_]+|invoice\.[a-z_]+|customer\.subscription\.[a-z_]+) \[evt_[A-Za-z0-9]+\]' "$LOG" | sort | uniq -c | sed 's/^/  /' || true
if [ -n "$failed" ]; then echo "✗ webhook deliveries that failed:"; echo "$failed"; status=1; fi
if [ "$status" -eq 0 ] && ! grep -q 'checkout.session.completed' "$LOG"; then echo "✗ no checkout.session.completed reached the app"; status=1; fi
exit $status
