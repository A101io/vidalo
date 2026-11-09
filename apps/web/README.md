# @vidalo/web

Next.js 15 (app router) front-end for Vidalo: landing page, free scan, result
page, Stripe checkout, magic-link login and the owner dashboard.

## Run

```sh
pnpm install                                  # at the repo root
VIDALO_MOCK=1 pnpm --filter @vidalo/web dev   # http://localhost:3000
```

With `VIDALO_MOCK=1` (or no `DATABASE_URL`) the app runs fully offline on
core's own mock mode (`MemDb` + deterministic mock engines):

- a demo owner business is seeded on first request (login
  `eigenaar@bakkerijdevries.nl`; result page `/r/bakkerij-de-vries-haarlem`),
  see `lib/demo.ts`;
- the free scan runs core's real pipeline with mock engines (about a second);
- checkout simulates success and redirects to `/welkom?mock=1`;
- login signs you in immediately as the e-mail you enter (it must own a
  business: run a free scan, leave your e-mail on the result page, buy);
- Google login is simulated; DNS verification does a real CNAME lookup.
- Jobs the web app enqueues (`setup`, `publish`, `sync`, `scan`, `email`,
  `operator_task`) are processed by `apps/worker`, which has its own MemDb in
  mock mode; `pnpm e2e:mock` at the repo root runs web actions + worker in one
  process.

Try it: type `Fietsenmaker Jansen, Utrecht` (name, place) or a website in the
hero field.

## Checks

```sh
pnpm --filter @vidalo/web typecheck
VIDALO_MOCK=1 pnpm --filter @vidalo/web build
```

Both pass without any API keys. Every external SDK (Stripe, Supabase,
Google OAuth) is loaded lazily behind an env check in `lib/env.ts`.

## Environment

See `.env.example` (web subset) and the root `.env.example`. Relevant keys:
`PUBLIC_BASE_URL`, `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PRICE_SETUP`, `STRIPE_PRICE_MONITOR`, `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, `FACTS_CNAME_TARGET`.

Stripe webhook (local): `stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## Routes

| Route | What |
|---|---|
| `/` | Landing page (sections and copy from `docs/MESSAGING.md`) |
| `POST /api/scan` | `resolveBusiness` → `prepareBusiness` → `runScan({kind:'free'})` after the response |
| `/scan/kies?q=` | Confirmation step when several businesses match (or the place is unknown) |
| `/scan/[token]` | Waiting room, polls `GET /api/scan/[token]/status` every 2 s (progress kept in memory and as `scan.progress` events) |
| `/r/[scanRunId]` | Public result page (30 days); a business slug/id shows its latest scan |
| `POST /api/report-email` | Stores owner e-mail, enqueues `email` `{template:'baseline', scanRunId}` |
| `POST /api/checkout` | Stripe Checkout (`plan=setup` or `plan=monitor`) |
| `POST /api/stripe/webhook` | `checkout.session.completed` → status trial, enqueues `setup` |
| `/welkom` | Four owner steps after checkout |
| `/inloggen`, `/auth/callback`, `POST /auth/uitloggen` | Supabase magic-link auth (mock cookie without Supabase) |
| `/app` | Dashboard: status, setup checklist, findings, proof cards, channels, invoices, "Controleer nu" (`scan` `{kind:'ondemand', then:['fixes']}`) |
| `/app/gegevens` | Facts form → new verified facts version + `publish` then `sync` jobs |
| `/app/domein`, `POST /api/domain/verify`, `POST /api/domain/checkout` | CNAME instructions and DNS check; or option B, the domain add-on: availability, holder details, Stripe Checkout for the yearly subscription, then the status requested → registered → live (docs/DOMAINS.md) |
| `/app/google`, `/api/google/start`, `/api/google/callback` | Google Business Profile OAuth: refresh token in `channel.meta.refreshToken`, location in `externalId`, then `sync` |
| `POST /api/billing/portal` | Stripe customer portal |
| `/feiten/[slug]` | Owner preview of the facts page |

## Where things live

- `lib/core.ts` is the only seam to `packages/core` (`db`, `resolveBusiness`,
  `prepareBusiness`, `runScan`, `buildReport`, `renderFactsPage`,
  `setBusinessStatus`). It keeps one `Db` per process on `globalThis` so
  `next dev` (one module graph per route) shares the mock database.
- `lib/reads.ts` dashboard reads (user's Supabase client + RLS; mock fallback).
- `lib/factsPage.tsx` wraps the core publisher's `renderFactsPage` for the preview.
- `components/FindingCard.tsx` the one report component shared by the landing page and the product.
- All customer-facing Dutch strings: `packages/core/src/copy/index.ts`.
