# SETUP_STATUS — Vidalo

Baseline v3 (project-setup-baseline) · last checked 13 Oct 2026 · a compliance aid, **not legal advice**.
Status: `✓verified` (observed, evidence + date) · `written` (code exists, not proven on real infrastructure) · `blocked` (names what it needs) · `open` · `n/a` (reason).

## Project facts
- Product: Vidalo (name under review, see go-live J1). Company: A101 B.V. (handelend als Vidalo), Factorij 80, 3071 AV Rotterdam, KvK 42057858, VAT NL869514192B01 (not shown on the site by design: footer has no btw-nummer).
- Domain: **`vidalo.io`**, registered by Julian 14 Oct 2026 (`vidalo.nl` and `vidalo.com` are held by others; go-live J2). Code, copy and config say `vidalo.io` since 14 Oct; DNS not yet on Cloudflare. Support: hallo@vidalo.io (mailbox does not exist yet).
- Audience: B2B (Dutch businesses). Languages: NL + EN.
- Stack: Next.js 15 (apps/web), worker (apps/worker), core (packages/core), Supabase `bbynmqvaxpjdnkaasutd` (eu-west-1). Hosting: Cloudflare Workers (decided 13 Oct 2026; account `37c9615a0d7d9629154eca03d7de59a6`).
- Accounts: yes (magic link + Google verification). Payments: Stripe (account not created). AI: yes, as a tool to ask questions (OpenAI, Google, Perplexity, SerpAPI). Outbound email: Resend. Native app: no.
- Baseline reference files (`/mnt/project-files/setup/`, legal masters, `projects.md`): **not present in this environment**; this file was made from the skill's section 5.

## R. Required
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| R1 | Supabase | ✓verified | Project read back by ref: `vidalo`, eu-west-1, ACTIVE_HEALTHY. RLS on all 11 tables; advisors: only INFO "RLS enabled, no policy" on the 4 internal tables (intended). Transaction test, rolled back: anon sees 0 business, stranger 0, **control: owner 1** and own event 1. | 13 Oct |
| R2 | Legal pages + footer | blocked | Drafts at `/voorwaarden`, `/privacy` with a "Concept" banner; footer identity line present. Needs: De Boer Legal masters uploaded, `/legal/terms|privacy|cookies` NL + EN, "Cookie settings" link, counsel review. | 13 Oct |
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
| B3 | Auth settings | blocked | site_url, redirect URLs, custom SMTP (Resend), leaked-password n/a (magic link). Needs domain + Resend. Since 14 Oct the local dev server signs in against the real project (URL + anon key in the root `.env`, loaded by `next.config.ts`); the link send itself is Julian's click (go-live A1). | 14 Oct |
| B4 | Bot protection (Turnstile) | open | Free-scan form and sign-in send email / spend AI calls; `FREE_SCANS_PER_DAY` caps cost but is not a captcha. | |
| B5 | Cron jobs | n/a | Cron runs in the worker, not pg_cron. | |

## D. Deploy, domain, headers
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| D1 | CI on every PR | ✓verified | `ci.yml`: secret scan, typecheck, tests, mock pipeline, Postgres. No linter configured yet. | 13 Oct |
| D2 | Deploy | ✓verified (preview) · written (production) | Cloudflare Workers (Julian, 13 Oct): `vidalo-web` via OpenNext, `vidalo-worker` for cron, the scan queue and facts pages; `deploy.yml` manual, preview or production, never Workers Builds. Verified locally in workerd against real Postgres: every route NL+EN, a free scan through the queue to its report, both crons, a facts page; one handle per request (control without it: every second request 500). Blocked on the Cloudflare token + account id on the GitHub environments. **14 Oct: preview deployed by hand from Julian's Mac** (local `wrangler login`): https://vidalo-web-preview.julian-devriend.workers.dev, `verify-deploy.mjs` 7/7; queue `vidalo-scans` created. Production: no Hyperdrive, no secrets, no custom domains possible (D5). **16 Oct: first run of `deploy.yml` from GitHub Actions** (run 38933068119, `preview`): all steps green, `verify-deploy.mjs` 9/9 against the preview host. Production waits for `DATABASE_URL`/Hyperdrive. | 16 Oct |
| D3 | No empty env overrides | ✓verified | Workflows set no `NEXT_PUBLIC_*`; live checkout refuses without `STRIPE_TAX_RATE_ID`; production without `DATABASE_URL`/Hyperdrive answers 503 instead of mock data (verified in workerd, and the deploy verifier fails on it). | 13 Oct |
| D4 | Verify deployed bundle | written | `scripts/verify-deploy.mjs` as the last deploy step: health, NL and EN landing, pricing, llms.txt, sitemap, 404; prints status and bytes for each. Passes on the local preview, fails (with the reason) on a database-less production. | 13 Oct |
| D5 | Domain | ✓verified | `vidalo.io` registered at one.com 15 Oct 2026; NS at the registry `zac`/`nucum.ns.cloudflare.com`; zone `5d39e2dacc81b8603d5dc69a163b6bca` active in account `37c9615a0d7d9629154eca03d7de59a6` (API read); no DNS records yet, so the Custom Domain can now bind at the first production deploy. SSL Full (strict) + Always Use HTTPS not readable with the local token: Julian. | 16 Oct |
| D6 | Launch gate | open | Julian, 13 Oct: the GitHub Pages preview (mock data) stays public until there is a domain. The gate (coming-soon on `/`, `/legal/*` reachable, invariant test) comes with the production deploy. | 13 Oct |
| D7 | Security headers + CSP | written | HSTS, nosniff, Referrer-Policy, X-Frame-Options, Permissions-Policy seen via `curl -I` on dev; CSP production-only (`next.config.ts`). | 13 Oct |
| D8 | Health endpoint | ✓verified | `/api/health` → `{"ok":true,"db":"mem"}` 200 on dev; 503 path when the db throws. | 13 Oct |

## E. Quality
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| E1 | Unit + e2e | written | 152 core + 8 worker tests, `e2e:mock`, `verify:pg`. No Playwright suite in the repo yet (checks run ad hoc). | 13 Oct |
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
| G1 | Support channel | blocked | hallo@vidalo.io used everywhere; needs the domain and a real mailbox. | |
| G2 | Transactional email | blocked | Resend code + one-click unsubscribe (RFC 8058) written; DNS (SPF/DKIM/DMARC) needs the domain. | |

## H. Operations
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| H1 | Backups + restore drill | blocked | Paid Supabase plan: Julian. | |
| H2 | Error monitoring | open | | |
| H3 | Uptime | open | `/api/health` ready for it. | |
| H4 | Rate limiting | written | `FREE_SCANS_PER_DAY` caps live scans site-wide; per-IP limits open. | |
| H5 | Staging | open | | |
| H6 | Rollback plan | open | In go-live X5. | |
| H7 | Dependency updates | ✓verified | `.github/dependabot.yml` weekly, grouped; it opened PRs #10–#15 on 13 Oct. Majors ignored (Julian): #12–#15 closed; security updates still open regardless. | 13 Oct |
| H8 | Operator 2FA | blocked | Julian. | |
| H9 | Incident runbook | open | | |
| H10 | security.txt | ✓verified | `/.well-known/security.txt` 200 with Contact, Expires, Canonical, Policy. | 13 Oct |
| H11 | Cost alerts | open | AI spend capped by `FREE_SCANS_PER_DAY`; provider budget alerts not set. | |

## P. Privacy
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| P1 | Processors | written | `docs/processors.md`; DPAs not yet accepted; hosting missing from the privacy text. | 13 Oct |
| P2 | Records of processing | written | `docs/records-of-processing.md` | 13 Oct |
| P3 | DPIA screening | written | Not indicated (guidelines doc). | 13 Oct |
| P4 | Proof of consent | n/a for now | No consent-based processing yet (no non-essential cookies). Terms version accepted at checkout: open. | |
| P5 | Retention runs | open | Retention periods await counsel. | |

## C. Conditional
| # | Step | Status | Evidence | Date |
|---|---|---|---|---|
| C1 | Payments | blocked | Code done (`docs/PAYMENTS.md`, wrong-account guard). Needs Vidalo's own Stripe account. | |
| C2 | Accounts + personal data | open | Export / delete my data not built. | |
| C3 | AI features | written | Vidalo asks AI providers; it does not chat with customers. Spend capped by `FREE_SCANS_PER_DAY`. | |
| C4 | B2C | n/a | B2B only. | |
| C5 | Native app | n/a | | |
| C6 | New brand | blocked | Trademark check before the domain; name under review. | |
| C7 | Accessibility statement | open | | |

## Legal review log
| Check | Result |
|---|---|
| GDPR art. 13/14 contents in privacy draft | partial: controller, purposes, basis, recipients, retention, rights, AP complaint present; EEA transfer safeguards named generally; hosting processors missing |
| Cookie statement matches the browser | fail: no cookie statement page yet (inventory is in the guidelines doc) |
| Terms cover parties, service, prices + VAT, renewal, liability, NL law | pass (draft) |
| Company identity visible | pass (footer) |
| Deviations from masters | n/a: masters not available here |

## Needs Julian
1. Upload the De Boer Legal masters (B2B, July 2026) so R2 can be built from them.
2. ~~`vidalo.io` as a zone in A101's Cloudflare account~~ done 16 Oct 2026 (zone `5d39e2dacc81b8603d5dc69a163b6bca`). Still: SSL Full (strict) + Always Use HTTPS in the dashboard; then D4–D6, G1–G2 and production D2 can proceed.
3. The Supabase database password (for `DATABASE_URL`, go-live D3), ~~a Cloudflare API token plus the `preview`/`production` GitHub environments (X2)~~ done 16 Oct, Vidalo's own Stripe account (B1), a Google OAuth client (A3), and one click on "Stuur inloglink" on the local sign-in page (A1).
