# Vidalo

**Je klanten vragen het aan ChatGPT. Wij zorgen dat het antwoord klopt.**

Vidalo checks what AI assistants (ChatGPT, Gemini, Perplexity, Google AI Overviews, Copilot, Claude) say about a Dutch business, finds the wrong facts and the source each one came from, publishes an authoritative facts page on the business's own domain, syncs directories, and fixes errors at the source — with proof.

## Layout

```
apps/web        Next.js 15 site: landing, free scan, result page, Stripe checkout, dashboard
apps/worker     Job loop + cron + facts-page HTTP server (publisher, fixer, reporter)
packages/core   Domain logic: db, prompts, scanner, publisher, fixer, reporter, copy (all Dutch strings)
supabase/       SQL migrations (Postgres schema, RLS)
docs/           CONTRACT.md (module rules), ARCHITECTURE.md, MESSAGING.md, DESIGN_RESEARCH.md
scripts/        e2e-mock.mts (whole pipeline in one process, no keys needed)
```

## Run it in 2 minutes (mock mode, no keys)

```bash
pnpm install
cp .env.example .env            # leave keys empty; VIDALO_MOCK=1 is the default
pnpm -r typecheck && pnpm -r test
pnpm verify:pg                  # same pipeline on a real local Postgres (needs psql + PG_ADMIN_URL)
pnpm e2e:mock                   # scan → checkout → setup → publish → fixes → mails, asserts the result
VIDALO_MOCK=1 pnpm scan --name "Bakkerij De Vries" --place Haarlem --kind free
VIDALO_MOCK=1 pnpm scan --list packages/core/examples/businesses.csv --kind free --out out/scans   # 20 businesses
VIDALO_MOCK=1 pnpm dev          # http://localhost:3000  (demo owner: eigenaar@bakkerijdevries.nl)
VIDALO_MOCK=1 pnpm worker       # job loop + cron + facts pages on :8787
```

Mock mode uses deterministic fake engine answers (≈35 % contain an injected wrong fact), an in-memory database, `.eml` files in `out/mail/` and rendered facts pages in `out/pages/`.

## Preview site (GitHub Pages)

`.github/workflows/site.yml` builds the web app in mock mode, saves every page as static HTML with `scripts/site/snapshot.mjs`, and deploys it to GitHub Pages on every push to `main` (pull requests only build and check it). The site root is the landing page as the app renders it; `pages.html` lists every page. The copy has no JavaScript and saves nothing: links work, forms go to the page a visitor would land on, and every page is `noindex`. Locally: start the web app with `VIDALO_MOCK=1 PUBLIC_BASE_URL=http://localhost:3000`, then `pnpm site` and serve `out/site` with any static server.

## Going live — what needs real keys

| Capability | Env | Notes |
|---|---|---|
| Database | `DATABASE_URL`, `SUPABASE_*` | run `supabase/migrations/0001_init.sql`; set `VIDALO_MOCK=0` |
| ChatGPT | `OPENAI_API_KEY` | Responses API + web search; also used for claim extraction (`EXTRACTION_MODEL`) |
| Gemini | `GEMINI_API_KEY` | Google Search grounding |
| Perplexity | `PERPLEXITY_API_KEY` | sonar |
| Claude | `ANTHROPIC_API_KEY` | Messages API + web search; model from `CLAUDE_MODEL` (default `claude-opus-5-5`) |
| Google AI Overviews | `SERPAPI_KEY` | nl-NL SERP, parses the AI overview block |
| Copilot | `COPILOT_ENABLED=1` + a Playwright adapter (`setCopilotAdapter`) | no API; lowest priority, skipped on failure |
| Business lookup | `GOOGLE_PLACES_API_KEY`, `KVK_API_KEY` | otherwise one synthetic candidate |
| Billing | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SETUP`, `STRIPE_PRICE_MONITOR` | iDEAL, card, SEPA; btw-id collection |
| Auth | `SUPABASE_URL`, `SUPABASE_ANON_KEY` | magic links; RLS reads in the dashboard |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | all templates in `packages/core/src/reporter/templates.ts` |
| Facts pages on customer domains | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID`, `FACTS_CNAME_TARGET` | Cloudflare for SaaS custom hostnames; fallback `{slug}.feiten.vidalo.io` |
| Google Business Profile sync | `GOOGLE_OAUTH_CLIENT_ID/SECRET` | owner connects once in `/app/google` |
| IndexNow | `INDEXNOW_KEY` | pings Bing/Yandex on publish |

Bing Places, Apple Business Connect and form-based Dutch directories are stubbed behind a common `syncChannel` interface and land in the operator queue (`out/operator/queue.jsonl`) until an adapter exists.

## Build order that was followed

1. Scanner core (prompts, 5 engines, extraction, comparison, source attribution, CLI) — validate on 20 businesses in one town first.
2. Landing + free scan + result page + Stripe checkout.
3. Facts store + publisher (facts page, JSON-LD, llms.txt, CNAME, GBP sync, IndexNow).
4. Fixer (one path per source type, re-checks, proof cards, operator queue).
5. Reporter + monthly cron + billing lifecycle.
6. Next: directory breadth (Bing, Apple, browser agent for form directories), Copilot adapter, WordPress plugin, quarterly plan.

See `docs/ARCHITECTURE.md` for the workflows and `docs/MESSAGING.md` for every customer-facing rule.
