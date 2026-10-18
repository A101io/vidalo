# Go-live checklist (baseline A2)

The launch gate. "continue" resumes from the first row that is not ✓. Status key: `✓verified` (observed, with evidence and date) · `written` (code exists, not proven against real infrastructure) · `blocked` (names what it needs) · `open` · `n/a`. Not legal advice.

## Decisions for Julian first
| # | Decision | Status |
|---|---|---|
| J1 | Product name: **Vidalo** (Julian, 13 Oct 2026; was Maicro). Web search found no Vidalo brand; nearest: Vidado (AI data extraction), Vidyo (video calls). Formal TMview check (EUIPO + BOIP) and the domains are Julian's. | decided; TMview + domains open |
| J2 | Domain: **`vidalo.nl` is the main domain**; `vidalo.com` and `vidalo.io` redirect to it (Julian, 13 Oct 2026). `.com` and `.io` at Cloudflare Registrar, `.nl` at a Dutch registrar with DNS on Cloudflare. **Checked 14 Oct 2026 (whois + DNS from Julian's Mac): `vidalo.nl` is taken** (registered 14 Jun 2026 by a third party, registrar Internationale Domeinregistratie Nederland, DNSSEC on, A record 37.97.254.29); **`vidalo.com` is taken** (since 2003, German registrant, alfahosting DNS); `vidalo.io` is free, as are `vidalo.ai` and `vidalo.co`; `vidalo.app` is taken. **Decided 14 Oct 2026: `vidalo.io` is the site** (registered by Julian that day); only `www.vidalo.io` redirects to it; `.nl` and `.com` are out of code, copy and config. | decided. 16 Oct 2026: one.com holds `vidalo.io`; its zone is active in A101's Cloudflare account (Domains D1) |
| J3 | Hosting: **all on Cloudflare** (Julian, 13 Oct 2026): `vidalo-web` (OpenNext) and `vidalo-worker` (cron, scan queue, facts pages), A101's account. | decided |
| J4 | Launch gate: the GitHub Pages preview (`a101io.github.io/vidalo`, mock data) stays **public until there is a domain** (Julian, 13 Oct 2026). **Built 14 Oct 2026:** `VIDALO_COMING_SOON=1` shows `/binnenkort` on the marketing routes (legal, cookies, reports, sign-in, account, unsubscribe, facts keep working; `core/shared/gate.ts`, tested); `VIDALO_PREVIEW_BUTTON=1` adds the temporary "Bekijk de site alvast" button that opens the whole site with a preview bar. Production `wrangler.jsonc` has both on. **Before launch: set the button to 0** (then only `VIDALO_PREVIEW_KEY` opens the preview), and at launch set the gate to 0. | decided; built |

## Product
| # | Item | Status |
|---|---|---|
| P1 | Landing, scenes, simulator, Straks section, pricing, sector pages, result pages | written (mock mode), screenshots in `out/screenshots/` |
| P2 | NL + EN with `/en/...` URLs, hreflang, language switch | written |
| P3 | First real scan (`docs/FIRST-REAL-SCAN.md`) on 20 businesses | blocked: `OPENAI_API_KEY` |
| P4 | Content check against primary sources (`docs/content-check.md`, 14 Oct 2026): 60 claims checked, 8 wrong and 5 outdated fixed in copy, e-mail and docs (Eurostat/Adyen/KPMG statistics, BrightLocal source mix, the Ohio bookshop, ten samples not twenty, 2 to 4 weeks for third-party fixes, Copilot out of the free-check copy, btw-id and a named person in the footer, free reports expire after 30 days in code) | done; **Julian decides:** ship the Copilot adapter or keep Copilot out of the paid-plan copy too; the eight sector "eigen steekproef" figures have no data behind them (run them or delete the blocks); a real 100-business sample for the hero or keep it labelled fictional; what 2 to 10 locations cost; confirm KvK 42057858 against the uittreksel |
| P5 | Cookies: statement at `/cookies` (inventory), notice, "Cookie-instellingen" in every footer (`lib/consent.ts`, LEGAL-NL §6) | written, observed 14 Oct 2026 on the dev server: cookie set on "Begrepen", notice reopens from the footer |
| P6 | Account page `/app/account`: owner, business details, latest report, checks, plan | written, observed 14 Oct 2026 in mock mode |
| P7 | Website assistant (`/api/chat`, `core/chat`): answers from the FAQ copy without a key, OpenAI with `OPENAI_API_KEY`; says it is an AI, never claims control, points to hallo@vidalo.io | written, observed 14 Oct 2026 without a key; **not observed with a model** |

## Database
| # | Item | Status |
|---|---|---|
| D1 | Supabase `bbynmqvaxpjdnkaasutd`, migrations 0001–0005, RLS on all 11 tables | ✓verified 13 Oct 2026: anon 0, stranger 0, owner 1 (control), rolled back |
| D2 | Paid plan, daily backups, one restore drill | blocked: Julian (billing) |
| D3 | `DATABASE_URL` as a secret on `vidalo-web` and `vidalo-worker`, `/api/health` says `"db":"pg"` | blocked: Julian: the pooler URL from Supabase → Connect, which carries the database password (set at project creation; Project Settings → Database → Reset if lost). Nothing else is missing: URL and anon key are known and in the local `.env` |
| D4 | Merge Dependabot #11 (`@supabase/ssr` 0.5 → 0.12, breaking for a 0.x package) after trying the magic-link sign-in on its branch against the real project | blocked: D3 |

## Accounts (sign-in)
| # | Item | Status |
|---|---|---|
| A1 | Magic-link sign-in with Supabase Auth, from the local dev server | written, partly observed 14 Oct 2026: with `SUPABASE_URL` + `SUPABASE_ANON_KEY` in the root `.env` the sign-in page drops the mock hint and `/api/health` keeps `"db":"mem"`; scan → mock checkout → `/welkom` → `/inloggen?business=…` now links the business to the e-mail before the link is sent (`apps/web/app/inloggen/actions.ts`; before this the real-auth path dropped the business and the first sign-in after paying landed on "geen bedrijf"). **Not observed:** the link itself (sending it mails Julian; the browser pane was left on that page), `/auth/callback`, `/app` |
| A2 | Supabase Auth settings: Site URL and Redirect URLs for the real host, custom SMTP (Resend), rate limits | blocked: domain (J2). Local sign-in works on the default `http://localhost:3000` |
| A3 | Google sign-in for ownership (`GOOGLE_OAUTH_CLIENT_ID/SECRET`), redirect URI `<site>/api/google/callback` | blocked: Julian creates the OAuth client in Google Cloud (as Vidalo), with the Business Profile API scope |

## Billing
| # | Item | Status |
|---|---|---|
| B1 | Vidalo's own Stripe account, id pinned as `VIDALO_STRIPE_ACCOUNT` | blocked: Julian creates it; `api.stripe.com` must be allowed for the session |
| B2 | `pnpm stripe:setup --apply` (prices, 21% tax rate, webhook) | blocked: B1 |
| B3 | Terms and Privacy URLs set in Stripe settings. **Checkout now requires them** (14 Oct 2026: terms checkbox, B2B confirmation with legal links, btw-nummer, origin-derived return URLs, as for Sonable; `docs/PAYMENTS.md`). Proof: a completed session whose `checkout.completed` event reads `termsConsent: "accepted"` | blocked: B1 + legal pages |
| B4 | One live purchase on a real card, refunded | blocked: B2 |

## Deploy
| # | Item | Status |
|---|---|---|
| X1 | CI on every PR: secret scan, typecheck, tests, mock pipeline, Postgres | ✓verified (GitHub Actions green on PR #8) |
| X2 | Deploy workflow, manual (`workflow_dispatch`, `preview` or `production`), `.github/workflows/deploy.yml`, ends with `scripts/verify-deploy.mjs` | written: verified locally in workerd (preview passes; a production without database fails with the reason). **Preview is live** (14 Oct 2026): deployed by hand from Julian's Mac (`wrangler login`, `pnpm cf:build`, `wrangler deploy --env preview`) to https://vidalo-web-preview.julian-devriend.workers.dev; `verify-deploy.mjs` passed all 7 checks against it. Queue `vidalo-scans` created (id `63360eff236a4a29baaeb59d272916c3`), account `37c9615a0d7d9629154eca03d7de59a6`. **✓verified 16 Oct 2026 from GitHub Actions:** environments `preview` and `production` exist with `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (token `vidalo-deploy (GitHub Actions)`, permission set in `docs/secrets-and-keys.md`); run 38933068119 (target `preview`) deployed `vidalo-web-preview` version `3e4574f2`, `verify-deploy.mjs` 9/9. GitHub first blocked the run as "may be malicious" because of the `toJSON(secrets)` name dump; Julian approved it, PR #24 removes the pattern. Production has not run yet (needs `DATABASE_URL`, X2b) |
| X2b | Hyperdrive for Supabase (`wrangler hyperdrive create vidalo-db`), id into both wrangler.jsonc files | blocked: D3 (`DATABASE_URL`) |
| X3 | Security headers + CSP | written: headers seen on the dev server 13 Oct; CSP only in production builds |
| X4 | Error monitoring (EU), uptime checks on `/`, `/privacy`, `/api/health` | open |
| X5 | Rollback: previous deployment + forward-fix migration, tried once | open |

## Practise what we preach (Vidalo as its own first customer)
What the site promises a customer exists for Vidalo itself, from one record: `packages/core/src/shared/own.ts` (`OWN_FACTS`, `OWN_BUSINESS`). The web app renders it at `/feiten`, in the structured data of every page and in `/llms.txt`; the worker upserts Vidalo as a business at every start and runs setup, publish, directory sync and the monthly scan for it (`ensureOwnBusiness`). The guard test `packages/core/test/own.test.ts` fails when a criterium goes unanswered that is not on its open list.

| # | Item | Status |
|---|---|---|
| W1 | Own facts page in three forms (HTML, schema.org, llms.txt), dated, on our own site | written: `/feiten`, `organizationLd`, `/llms.txt` |
| W2 | Facts confirmed by the owner (`OWN_FACTS_VERIFIED_AT`); until then the page says "nog niet bevestigd" | blocked: Julian confirms address, hours (now ma–vr 09:00–17:00), what we do and do not do |
| W3 | Phone number, payment methods, name clashes ("niet te verwarren met"), erkenningen | blocked: Julian (the four open items in `own.test.ts`) |
| W4 | Vidalo in the directories, Google Business Profile, Bing, Apple (the `sync` job, same as a customer) | blocked: the first production deploy and a Google Business Profile for Vidalo (gives the place id) |
| W5 | Monthly scan of Vidalo itself: "Wat zegt AI over Vidalo?" | blocked: `OPENAI_API_KEY` (P3) and the first production deploy |
| W6 | `feiten.vidalo.io` as the own facts host, DNS at Cloudflare | blocked: the vidalo.io zone in A101's Cloudflare account (J2) |

## Legal
| # | Item | Status |
|---|---|---|
| L1 | Terms, privacy, cookie statement from the De Boer Legal masters, NL + EN, at `/legal/*` | blocked: masters not in this environment (upload) + counsel review |
| L2 | Processors, records of processing, DPIA screening | written (`docs/processors.md`, `docs/records-of-processing.md`, `docs/legal-compliance-guidelines.md`) |

## Domains (J2)
Written as if the three domains exist (Julian, 13 Oct 2026: "ga er even van uit"). Nothing is bound until a production deploy runs.

| # | Item | Status |
|---|---|---|
| D1 | `vidalo.io` registered at one.com 15 Oct 2026 (whois: created 2026-10-15, status ACTIVE). **✓verified 16 Oct 2026:** nameservers at the registry are `zac.ns.cloudflare.com` and `nucum.ns.cloudflare.com`; zone `5d39e2dacc81b8603d5dc69a163b6bca` is `active` in A101's account `37c9615a0d7d9629154eca03d7de59a6` (Cloudflare API, read with the local wrangler OAuth token); Cloudflare answers the SOA; no A/AAAA records in public DNS (the production deploy creates them as Custom Domains). **Not verified** (the wrangler token has no zone scope): DNS records list, SSL Full (strict), Always Use HTTPS. Julian checks those two settings in the dashboard | ✓verified (registrar → zone); SSL settings: Julian
| D2 | `vidalo-web` binds `vidalo.io` and `www.vidalo.io` as Custom Domains (`apps/web/wrangler.jsonc`); `www` answers 301 to the same path on `vidalo.io` (`apps/web/worker.ts`, `packages/core/src/shared/canonical.ts`) | written; the earlier six-host version was proven in workerd with a Host header; re-proven by the unit test after the rename |
| D3 | Deploy check: production verifies `https://vidalo.io`, then `--redirects` for `www.vidalo.io` (`scripts/verify-deploy.mjs`) | written |
| D4 | Cloudflare token gains **Zone · Workers Routes · Edit** on the zone `vidalo.io` (docs/secrets-and-keys.md) | blocked: D1 |
| D5 | Fallback facts hosts `{slug}.feiten.vidalo.io` are two levels deep: Universal SSL covers only `*.vidalo.io`, so they need Advanced Certificate Manager (about $10/month) or a one-level scheme such as `{slug}-feiten.vidalo.io` | decision: Julian |
| D6 | `feiten.vidalo.io` as the CNAME target for customers' own domains (Cloudflare for SaaS, fallback origin on `vidalo-worker`) | open |

⚠ With D2 in place, the first production deploy puts the product on `vidalo.io`. There is no coming-soon gate yet (J4). That deploy is the one-way door below, not a routine step.

## The one-way door
Pointing the real domain at production, with live Stripe prices, is the launch. It waits for Julian's explicit yes, and for every row above to be ✓ or consciously accepted.
