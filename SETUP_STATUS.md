# SETUP_STATUS — Vidalo

Baseline v3 (project-setup-baseline) · last checked 26 Oct 2026 · a compliance aid, **not legal advice**.
Status: `✓verified` (observed, evidence + date) · `written` (code exists, not proven on real infrastructure) · `blocked` (names what it needs) · `open` · `n/a` (reason).

## Project facts
- Product: Vidalo (name under review, see go-live J1). Company: A101 B.V. (handelend als Vidalo), Factorij 80, 3071 AV Rotterdam, KvK 42057858, VAT NL869514192B01 (not shown on the site by design: footer has no btw-nummer).
- Domain: **`vidalo.io`**, registered by Julian 14 Oct 2026 (`vidalo.nl` and `vidalo.com` are held by others; go-live J2). Code, copy and config say `vidalo.io` since 14 Oct; zone on Cloudflare since 16 Oct; live as the coming-soon page since 23 Oct. Support: support@vidalo.io (mailbox does not exist yet).
- Audience: B2B (Dutch businesses). Languages: NL + EN.
- Stack: Next.js 16.4.2 (apps/web, since 22 Oct), worker (apps/worker), core (packages/core), Supabase `bbynmqvaxpjdnkaasutd` (eu-west-1). Hosting: Cloudflare Workers (decided 13 Oct 2026; account `37c9615a0d7d9629154eca03d7de59a6`).
- Accounts: yes (magic link + Google verification). Payments: Stripe, sandbox `acct_1UR4RAELCe3OOCe2` since 25 Oct (prices, tax, portal and webhook made; secrets on `vidalo-web`); no live account yet. AI: yes, as a tool to ask questions (OpenAI, Google, Perplexity, SerpAPI). Outbound email: Resend. Native app: no.
- Baseline reference files (`/mnt/project-files/setup/`, legal masters, `projects.md`): **not present in this environment**; this file was made from the skill's section 5.

## R. Required
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| R1 | Supabase | ✓verified | Project read back by ref: `vidalo`, eu-west-1, ACTIVE_HEALTHY. RLS on all 11 tables; advisors: only INFO "RLS enabled, no policy" on the 4 internal tables (intended). Transaction test, rolled back: anon sees 0 business, stranger 0, **control: owner 1** and own event 1. | 13 Oct |
| R2 | Legal pages + footer | written | Final terms, privacy and cookie statement in NL + EN, built from Sonable's counsel-reviewed texts (Julian decided 26 Oct: no outside counsel now); PR `claude/legal-final` awaits his approval. Evidence, local dev server 26 Oct 2026: `/voorwaarden`, `/privacy`, `/cookies`, `/en/terms`, `/en/privacy`, `/en/cookies` answer 200 with 18/20/6 sections, no "Concept" notice, no noindex, all three in `sitemap.xml`; footer links go to the same routes in each language; terms render as numbered articles (1.1, 6.3 a–e); no horizontal scroll at 375px; `pnpm -r typecheck`, `pnpm -r test` (315 core + 15 worker) and `pnpm e2e:mock` green. "Cookie-instellingen" appears once there is a choice (`OPTIONAL_CATEGORIES` is empty: necessary cookies only). Open: production check after deploy; the retention purge job. | 26 Oct |
| R3 | Fixed header | ✓verified | Playwright, 2000px scroll: header `top 0`, sticky, z 40, visible at 1280 and 390 (`out/screenshots/r3-header-*.png`). Mobile menu (`<details>`) opens, follows a link and closes (`r3-menu-390.png`). `[id]{scroll-margin-top:88px}`. | 13 Oct |

## A. Foundation
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| A1 | CLAUDE.md | written | Sections added: resuming work, how to write to Julian, things that cost an hour. | 13 Oct |
| A2 | Go-live checklist | written | `docs/go-live-checklist.md` | 13 Oct |
| A3 | Legal-compliance guidelines | written | `docs/legal-compliance-guidelines.md` (claims, never-use, VAT, cookies, DPIA, open questions) | 13 Oct |
| A4 | Secrets and keys | written | `docs/secrets-and-keys.md` | 13 Oct |
| A5 | Secret hygiene | ✓verified | `.env.example` complete; `pnpm scan:secrets` in CI; control: a planted `sk_live_…` made it exit 1. No service-role key in `NEXT_PUBLIC_*`. | 13 Oct |
| A6 | Project ref guard | ✓verified | CLAUDE.md lists Vidalo, Sitty and Sonable refs; every MCP call this session used `bbynmqvaxpjdnkaasutd`. | 13 Oct |

## B. Supabase hardening
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| B1 | Migrations really applied | written | Ledger `supabase_migrations.schema_migrations`. REST check (`/rest/v1/business?select=owner_verified_at`) not run: `*.supabase.co` blocked from this container. | 13 Oct |
| B2 | Functions locked down | open | Review `SECURITY DEFINER` functions and anon grants (anon has table grants; RLS returns 0, but revoke is cleaner). | |
| B3 | Auth settings | written | Site URL https://vidalo.io and Redirect URLs (https://vidalo.io/**, http://localhost:3000/**) set by Julian; magic-link sign-in verified on production 25 Oct 2026 (go-live A1). Open: custom SMTP through Resend (#37), rate limits. Leaked-password check n/a (magic link). | 25 Oct |
| B4 | Bot protection (Turnstile) | written | Turnstile on the free check (`/api/scan`, scan field and the pick step) and the sign-in link (`core/shared/turnstile.ts`, `lib/turnstile.ts`, `components/TurnstileWidget.tsx`), checked server-side before any lookup or mail. Off without keys in dev and mock; a production build with real engines and no keys refuses both forms. Seen 25 Oct on a dev server with Cloudflare's test keys: widget invisible, token filled; pass key → sign-in reaches `/app` and the check reaches the waiting room; fail key or no token → `/scan/druk?check=1`. `TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` are on `vidalo-web` (secret list, 26 Oct); the live widget has not been observed on vidalo.io (behind the gate). `GET /scan/kies` (the pick step, also a Places lookup) only looks up with a 10-minute token that `/api/scan` adds after a passed check (HMAC over q, place and expiry, signed with the Turnstile secret); without it the page shows the scan field with the widget. Seen 25 Oct with the test keys: direct `GET /scan/kies?q=Bakkerij` shows the field, through the form it lists the candidates; with keys off it looks up as before. | 25 Oct |
| B5 | Cron jobs | n/a | Cron runs in the worker, not pg_cron. | |

## D. Deploy, domain, headers
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| D1 | CI on every PR | ✓verified | `ci.yml`: secret scan, typecheck, tests, mock pipeline, Postgres. No linter configured yet. | 13 Oct |
| D2 | Deploy | ✓verified (preview) · written (production) | Cloudflare Workers (Julian, 13 Oct): `vidalo-web` via OpenNext, `vidalo-worker` for cron, the scan queue and facts pages; `deploy.yml` manual, preview or production, never Workers Builds. Verified locally in workerd against real Postgres: every route NL+EN, a free scan through the queue to its report, both crons, a facts page; one handle per request (control without it: every second request 500). Blocked on the Cloudflare token + account id on the GitHub environments. **14 Oct: preview deployed by hand from Julian's Mac** (local `wrangler login`): https://vidalo-web-preview.julian-devriend.workers.dev, `verify-deploy.mjs` 7/7; queue `vidalo-scans` created. Production: no Hyperdrive, no secrets, no custom domains possible (D5). **23 Oct 2026: first production deploy** (run 39949070125, success): `vidalo.io` serves the coming-soon page, `/api/health` `{"ok":true,"db":"pg","mock":false}` through Hyperdrive, `www.vidalo.io` 301 to `vidalo.io` (read back 25 Oct). Later production runs 23 Oct all green. **Secrets on the production Workers (26 Oct, `wrangler secret list`):** `vidalo-web` holds the preview key, OpenAI, Google Places, Resend, six Stripe sandbox values, Supabase URL/anon/service role, Turnstile site + secret, unsubscribe secret; `vidalo-worker` holds OpenAI, Resend, Supabase URL/service role, unsubscribe secret. Not set: Google OAuth, Gemini, Perplexity, SerpAPI, Anthropic. Stripe is the sandbox, so nothing can charge real money yet. **16 Oct: first run of `deploy.yml` from GitHub Actions** (run 38933068119, `preview`): all steps green, `verify-deploy.mjs` 9/9 against the preview host. | 25 Oct |
| D3 | No empty env overrides | ✓verified | Workflows set no `NEXT_PUBLIC_*`; live checkout refuses without `STRIPE_TAX_RATE_ID`; production without `DATABASE_URL`/Hyperdrive answers 503 instead of mock data (verified in workerd, and the deploy verifier fails on it). | 13 Oct |
| D4 | Verify deployed bundle | written | `scripts/verify-deploy.mjs` as the last deploy step: health, NL and EN landing, pricing, llms.txt, sitemap, 404; prints status and bytes for each. Passes on the local preview, fails (with the reason) on a database-less production. | 13 Oct |
| D5 | Domain | ✓verified | `vidalo.io` registered at one.com 15 Oct 2026; NS at the registry `zac`/`nucum.ns.cloudflare.com`; zone `5d39e2dacc81b8603d5dc69a163b6bca` active in account `37c9615a0d7d9629154eca03d7de59a6` (API read); no DNS records yet, so the Custom Domain can now bind at the first production deploy. SSL Full (strict) + Always Use HTTPS not readable with the local token: Julian. | 16 Oct |
| D6 | Launch gate | ✓verified | `VIDALO_COMING_SOON=1` on production: `https://vidalo.io/` title "Binnenkort · Vidalo" (25 Oct). Legal pages behind the gate use the coming-soon footer (#34); hidden preview page `/voorvertoning` (#50); the full site opens only with `VIDALO_PREVIEW_KEY`. | 25 Oct |
| D7 | Security headers + CSP | written | HSTS, nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy seen via `curl -I` on dev; CSP production-only (`next.config.ts`). | 13 Oct |
| D8 | Health endpoint | ✓verified | `/api/health` → `{"ok":true,"db":"mem"}` 200 on dev; 503 path when the db throws. | 13 Oct |

## E. Quality
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| E1 | Unit + e2e | written | Unit tests in core + worker, `e2e:mock`, `verify:pg`; Playwright suite (`e2e/`, merged 20 Oct) runs in CI in the Playwright image (#41); form and language-switch tests on both languages (#40, #41). | 25 Oct |
| E2 | Accessibility | open | Reduced motion honoured everywhere, scenes have labels, simulator buttons use aria-pressed + aria-live. No axe run yet. | |
| E3 | Daily checks | open | | |
| E4 | Dependency audit | open | | |

## F. Growth
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| F1 | i18n | written | NL at `/`, EN at `/en/...` with English slugs (`/en/pricing`, `/en/sectors/...`), hreflang alternates, NL·EN switch in header and footer (plain links, keeps the session). Verified 13 Oct: `/en`, `/en/pricing`, `/en/sectors/*`, `/en/r/voorbeeld`, `/en/terms` 200 with `<html lang="en">` and hreflang; no page errors. Still Dutch on English pages: question lines in the result table (`lib/questions.ts`), the sector questions (the scanner asks in Dutch), two joins in `lib/report.ts`, "Hercontrole" in the dashboard, demo report content, and all emails. | 13 Oct |
| F2 | SEO basics | written | Per page: title, description, canonical, hreflang, Open Graph/Twitter, generated share image. JSON-LD: Organization, WebSite, Service + Offers, FAQPage, BreadcrumbList, DefinedTermSet. Sitemap NL+EN with hreflang (32 URLs); robots names AI crawlers; `/llms.txt`. Seen on the dev server 13 Oct; not yet validated in Google Rich Results (needs a public URL). See `docs/landing-audit.md`. | 13 Oct |
| F3 | Brand assets | open | `app/icon.svg` only; name not final. | |
| F4 | Analytics | n/a for now | No analytics; add consent-gated first-party before any marketing. | |
| F5 | 404 page | ✓verified | `/bestaat-niet` → 404 with header and footer. | 13 Oct |

## G. Support and email
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| G1 | Support channel | open | hello@vidalo.io for contact, support@vidalo.io for support (was hallo@ until 19 Oct; split in `docs/mail.md`). Zone is on Cloudflare since 16 Oct; runbook `docs/mail.md` (Workspace secondary domain, aliases support@/hello@/julian@/controle@/inloggen@ on Julian's user, Send mail as, DNS records), check with `scripts/verify-mail-dns.sh`. **22 Oct:** Workspace secondary domain and the five aliases set up, `verify-mail-dns.sh` 5/5 green (MX, SPF, DKIM, DMARC, verification). **26 Oct, public DNS:** MX for `vidalo.io` points at Google Workspace, DMARC `p=none` with rua to julian@vidalo.io. Still: Start authentication in Google Admin, Send mail as; whether hello@ and support@ receive mail has not been tested (delivery test with a control). | 26 Oct |
| G2 | Transactional email | written | Resend code + one-click unsubscribe (RFC 8058) written; Vidalo branding in every mail (#47); mail lab `pnpm mail:lab` checks all 13 kinds, `pnpm mail:send` delivers one of each to one inbox (#42, #45); directory corrections one mail per change (#44). **26 Oct:** `RESEND_API_KEY` on both Workers; Resend's DNS is in public DNS (`resend._domainkey` DKIM, `send.vidalo.io` MX + SPF). `vidalo.io` verified in Resend and 14 test mails sent on 25 Oct (`docs/reality-check-2026-10-25.md` F4). Still open: the Supabase sign-in mail through Resend SMTP (#37). Open PRs: #37 sign-in mail, #38 DNS check, #48 mail redesign, #65 mails in English. | 26 Oct |

## H. Operations
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| H1 | Backups + restore drill | blocked | Paid Supabase plan: Julian. | |
| H2 | Error monitoring | open | | |
| H3 | Uptime | open | `/api/health` ready for it. | |
| H4 | Rate limiting | written | `FREE_SCANS_PER_DAY` caps live scans site-wide; per-IP limits open. | |
| H5 | Staging | written | 18 Oct 2026: `deploy.yml` target `staging`, `env.staging` in both wrangler.jsonc (own queue, own database slot, workers.dev only). Waits for its own database (Julian: $10/month) and the GitHub environment secrets. Meanwhile `scripts/local-prod.sh` runs the production build locally against the real database (go-live X7, verified). | 18 Oct |
| H6 | Rollback plan | written | `docs/RUNBOOK.md` §3–4: roll both Workers back to the pair from one earlier run (`wrangler deployments list`, `wrangler rollback`), verify, fix forward; migrations only forward. Drill on preview not run yet (go-live X5). | 25 Oct |
| H7 | Dependency updates | ✓verified | `.github/dependabot.yml` weekly, grouped; it opened PRs #10–#15 on 13 Oct. Majors ignored (Julian): #12–#15 closed; security updates still open regardless. | 13 Oct |
| H8 | Operator 2FA | blocked | Julian. | |
| H9 | Incident runbook | written | `docs/RUNBOOK.md`: first five minutes, switches without a deploy (gate, `FREE_SCANS_PER_DAY=0`, `queues pause-delivery`, cron triggers, provider keys, webhook), leaked secrets, datalek (72 h, register). | 25 Oct |
| H10 | security.txt | ✓verified | `/.well-known/security.txt` 200 with Contact, Expires, Canonical, Policy. | 13 Oct |
| H11 | Cost alerts | open | AI spend capped by `FREE_SCANS_PER_DAY`; provider budget alerts not set. | |

## P. Privacy
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| P1 | Processors | written | `docs/processors.md`; DPAs not yet accepted; hosting missing from the privacy text. | 13 Oct |
| P2 | Records of processing | written | `docs/records-of-processing.md` | 13 Oct |
| P3 | DPIA screening | written | Not indicated (guidelines doc). | 13 Oct |
| P4 | Proof of consent | written | Coming-soon list: each row stores the exact consent sentence shown, in its language, with the time (`waitlist.consent_text`, `created_at`; migration 0009). Terms version accepted at checkout: open. | 18 Oct |
| P5 | Retention runs | open | Retention periods await counsel. | |

## C. Conditional
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| C1 | Payments | written (sandbox) | Code done (`docs/PAYMENTS.md`, wrong-account guard). 25 Oct: `stripe:setup --apply` ran on the sandbox `acct_1UR4RAELCe3OOCe2` (prices, 21% tax, portal, webhook to vidalo.io); its values are secrets on `vidalo-web`. Needs: a live account, Terms/Privacy URLs, statement descriptor, iDEAL/SEPA, `--apply --live`, one real purchase refunded. | 26 Oct |
| C2 | Accounts + personal data | written | "Je gegevens" on `/app/account`: JSON download of everything under the business (`GET /api/account/export`, 401 without a session) and "Verwijder alles" (business with every child row, its unrun jobs, the Supabase login, the session), only once no subscription runs (`core/shared/my-data.ts`, `Db.deleteBusiness`, tested on MemDb and PgDb). Seen 25 Oct in mock mode: export 200 with 8 scans and 51 findings; delete on a trial business refused with the message. Not clicked: a successful delete in the browser; `SUPABASE_SERVICE_ROLE_KEY` is on `vidalo-web` since 25 Oct (secret list, 26 Oct). | 26 Oct |
| C3 | AI features | written | Vidalo asks AI providers; it does not chat with customers. Spend capped by `FREE_SCANS_PER_DAY`. | |
| C4 | B2C | n/a | B2B only. | |
| C5 | Native app | n/a | | |
| C6 | New brand | blocked | Trademark check before the domain; name under review. | |
| C7 | Accessibility statement | open | | |

## Legal review log
| Check | Result |
|---|---|
| GDPR art. 13/14 contents in privacy statement | pass (26 Oct): controller and contact, per activity the data, source (art. 14), purpose, basis and retention; recipients incl. Cloudflare hosting, Google Workspace, Turnstile; transfer safeguards (DPF/SCCs); rights incl. self-service export/delete; objection stated separately; AP complaint; whether data is required; no art. 22 decisions. Gap: retention periods are stated but no purge job enforces them yet |
| Cookie statement matches the browser | pass (26 Oct): the five cookies set by the code, no local storage, Turnstile named as the only third-party script; production `Set-Cookie` on `/` is empty (curl, 26 Oct) |
| Terms cover parties, service, prices + VAT, renewal, cancel/pause, liability, DSA notice-and-action, AI assistant, NL law | pass (26 Oct, 18 articles) |
| Company identity visible | pass (footer); the legal pages also carry the btw-nummer (BW 3:15d) |
| Deviations from masters | listed in the PR `claude/legal-final` (Sonable's July 2026 set used as the master) |

## Needs Julian
1. ~~Upload the De Boer Legal masters~~ replaced 26 Oct 2026: final texts built from Sonable's set; approve the PR `claude/legal-final`.
2. ~~`vidalo.io` as a zone in A101's Cloudflare account~~ done 16 Oct 2026 (zone `5d39e2dacc81b8603d5dc69a163b6bca`). Still: SSL Full (strict) + Always Use HTTPS in the dashboard; then D4–D6, G1–G2 and production D2 can proceed.
3. ~~The Supabase database password (for `DATABASE_URL`, go-live D3)~~ done 18 Oct, pipeline ran against the hosted project, ~~a Cloudflare API token plus the `preview`/`production` GitHub environments (X2)~~ done 16 Oct, ~~Vidalo's own Stripe account (B1)~~ created 16 Oct (its test secret key is still open), a Google OAuth client (A3), and one click on "Stuur inloglink" on the local sign-in page (A1).
