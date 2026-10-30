# Runbook: incidents and rollback

For when something is wrong on `vidalo.io`. Baseline H6 (rollback) and H9 (incident runbook); go-live X5. Written 25 Oct 2026. Commands run from `apps/web` (or `apps/worker`) with a local `wrangler login`; every dashboard path is the Cloudflare account `37c9615a0d7d9629154eca03d7de59a6` unless said otherwise. Not legal advice.

Rule while it burns: **stop the damage first, find the cause second, fix forward through a pull request third.** A hand deploy from a laptop is the last resort, never the first.

## 1. The first five minutes

| Look at | How | Good looks like |
|---|---|---|
| Is the site up | `curl -s https://vidalo.io/api/health` | `{"ok":true,"db":"pg","mock":false}`; `503` means the database is unreachable |
| What changed last | GitHub → Actions → "Deploy to Cloudflare", and `wrangler deployments list --name vidalo-web` (and `--name vidalo-worker`) | The last run is green and its time matches the versions listed |
| Live errors | `wrangler tail vidalo-web` / `wrangler tail vidalo-worker`, or dashboard → Workers & Pages → the Worker → Logs | No repeated exceptions |
| Database | Supabase → project `bbynmqvaxpjdnkaasutd` (check the ref: Sitty and Sonable sit in the same org) → Logs, and status.supabase.com | Healthy, no auth or pooler errors |
| Providers | status.openai.com, status.cloudflare.com, resend-status.com, status.stripe.com | |

Write down the time you started, what you saw and every switch you flip. That note becomes the entry in `A101/_OS/LEARNINGS.md`.

## 2. Switches, fastest first

Each one stops one kind of damage without a deploy. Values in `wrangler.jsonc` `vars` come back at the next deploy, so a switch flipped in the dashboard holds only until then; put it in `wrangler.jsonc` through a PR if it has to stay.

| To stop | Do | Undo | Side effect |
|---|---|---|---|
| Everyone seeing the product | Dashboard → `vidalo-web` → Settings → Variables and Secrets → `VIDALO_COMING_SOON` = `1` → Deploy | Set it back to `0` | Marketing pages show `/binnenkort`; legal pages, reports, sign-in, account and facts pages keep working (`core/shared/gate.ts`) |
| New free checks (AI spend from strangers) | Same place: `FREE_SCANS_PER_DAY` = `0` | Remove it or set the old number | Visitors land on `/scan/druk` |
| Scans and jobs already queued | `wrangler queues pause-delivery vidalo-scans` | `wrangler queues resume-delivery vidalo-scans` | Messages wait in the queue; nothing is lost while paused |
| The minute and ten-minute crons (paid jobs, rechecks, facts hosts) | Dashboard → `vidalo-worker` → Settings → Triggers → remove both Cron Triggers | The next deploy puts them back (`apps/worker/wrangler.jsonc`) | Paid customers' jobs wait |
| All spend at one AI provider | Revoke the key at the provider (OpenAI → API keys; Google AI Studio; Perplexity; SerpAPI; Anthropic console) | New key → Worker secret | That system is skipped or its jobs fail and retry |
| Outgoing mail | Resend → API Keys → revoke the key | New key → `RESEND_API_KEY` on both Workers | Not tried: sends then fail with 401 and the job retries |
| Payments | Stripe → Developers → Webhooks → disable the endpoint (events queue at Stripe for up to 3 days) | Enable; Stripe retries what it held | Checkout still takes money; the service does not start until the webhook is back |

## 3. Roll back the code

Use this when the last deploy broke something and the switches are not enough. Both Workers go out in one run, so roll both back to the pair from the same earlier run.

1. Find the versions: `wrangler deployments list --name vidalo-web` and `--name vidalo-worker`. Pick the last pair that was good (times within a minute of each other, from one Actions run).
2. Roll back the background worker first, then the web Worker:
   ```
   wrangler rollback <worker-version-id> --name vidalo-worker -m "rollback: <what broke>"
   wrangler rollback <web-version-id> --name vidalo-web -m "rollback: <what broke>"
   ```
3. Prove it: `node scripts/verify-deploy.mjs https://vidalo.io`, then `--redirects https://vidalo.io www.vidalo.io`. Check `wrangler secret list --name vidalo-web` still shows what it showed before.
4. Fix forward: a PR with the fix, CI green, then "Deploy to Cloudflare" with target `production`. The rollback is a bandage, not the fix.

Limits: Cloudflare refuses a rollback to a version whose bindings point at something that no longer exists (a deleted queue or Hyperdrive config), and a rollback does not touch the database. If the bad deploy ran a migration, the old code may not fit the new schema; see 4.

## 4. The database

- **Migrations are never edited and never reversed by hand.** A bad migration gets a new, forward-fix migration through a PR (`supabase/migrations/`), applied the same way as the others.
- **Before a risky migration** (dropping or rewriting a column with data): dump the affected tables first, `pg_dump "$DATABASE_URL" -t <table> > out/backup-<table>-<date>.sql` (the root `.env` has the URL; `out/` is gitignored).
- **Backups**: daily backups and a restore drill need the Supabase paid plan (go-live D2, Julian). Until then there is no copy of the data except what you dump yourself.
- **Wrong rows written by a bug**: repair with a `DO` block that raises at the end on a first dry pass (as the RLS tests do), then once without the raise. Never `delete` or `update` without a `where` that was first run as a `select`.
- **Pooler errors after a password reset**: Supavisor needs a few seconds ("Validation secrets changed"); then update the Hyperdrive config `vidalo-db` in the dashboard.

## 5. A secret leaked

1. Revoke it at the source first, then set the new one (`docs/secrets-and-keys.md` says where each comes from and where it is set).
2. `DATABASE_URL`: reset the database password in Supabase, update `.env` and the Hyperdrive config `vidalo-db`. `STRIPE_WEBHOOK_SECRET`: roll it on the endpoint in Stripe. `UNSUBSCRIBE_SECRET`: a new value breaks the unsubscribe links in mails already sent; keep the old one unless it leaked.
3. Find how it leaked (a commit, a log line, a screenshot) and close that path; `pnpm scan:secrets` must catch the shape next time.

## 6. Personal data reached someone it should not (datalek)

Personal data at Vidalo: owner e-mail addresses, the coming-soon list, Stripe customers, business facts (mostly public), sign-in sessions.

1. Stop it (switches in 2), keep the evidence (logs, the rows involved, times).
2. Record it in the breach register whether or not it is reported (AVG art. 33(5)): what, when, how many people, what was done.
3. If it is likely to bring a risk to the people involved: report to the Autoriteit Persoonsgegevens within **72 hours** of finding out (autoriteitpersoonsgegevens.nl → Datalek melden). If the risk is high, tell the people themselves too (art. 34). Julian decides; counsel when unsure.
4. Processors that leak to us must tell us; their contacts are in `docs/processors.md`.

## 7. After

- An entry in `A101/_OS/LEARNINGS.md`: date, `[vidalo]`, what happened, the one rule that would have prevented it.
- A test that fails on the cause, in the same PR as the fix.
- Switches flipped in the dashboard are written back into `wrangler.jsonc` or undone, so the next deploy does not surprise anyone.

## Rollback drill (go-live X5)

Not tried yet. On the preview Worker, which serves mock data, so nothing real is at stake:

1. Run "Deploy to Cloudflare" with target `preview` twice (two versions).
2. `wrangler deployments list --name vidalo-web-preview`, then `wrangler rollback <older-version> --name vidalo-web-preview -m "drill"`.
3. `node scripts/verify-deploy.mjs https://vidalo-web-preview.julian-devriend.workers.dev` passes; note how long steps 2 and 3 took.
4. Run the preview deploy once more to roll forward. Record the date and the times in go-live X5.
