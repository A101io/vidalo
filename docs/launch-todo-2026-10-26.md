# Vidalo: open topics and keys (26 Oct 2026, 23:00)

Replaces `launch-todo-2026-10-25.md` and `keys-todo-2026-10-25.md`. Status in `docs/go-live-checklist.md` and `SETUP_STATUS.md`.

Today: vidalo.io runs on Cloudflare behind the coming-soon gate, on the hosted database. Merged today: #74, #70, #76 (ownership by phone code). Merging does not deploy; production changes only with a manual `deploy.yml` run.

## Where keys go
- **Local**: one line `NAME=value` in `/Users/a101/Vidalo/.env` (TextEdit; no spaces, no quotes). Tell Claude the **name** only.
- **Production**: Claude pushes from `.env` with `pnpm secrets:push --apply --only NAME` (names only on screen), or by hand: Cloudflare → Worker → Settings → Variables and Secrets → Add → Type **Secret** → Deploy.
  - W = `vidalo-web`: https://dash.cloudflare.com/37c9615a0d7d9629154eca03d7de59a6/workers/services/view/vidalo-web/production/settings
  - K = `vidalo-worker`: https://dash.cloudflare.com/37c9615a0d7d9629154eca03d7de59a6/workers/services/view/vidalo-worker/production/settings

## Keys on the Workers (read back by name, 26 Oct)
- W: `VIDALO_PREVIEW_KEY`, `OPENAI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `RESEND_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_SETUP`, `STRIPE_PRICE_MONITOR`, `STRIPE_TAX_RATE_ID`, `STRIPE_PORTAL_CONFIGURATION`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `UNSUBSCRIBE_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`
- K: `OPENAI_API_KEY`, `RESEND_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `UNSUBSCRIBE_SECRET`

## Keys still missing
| # | Key | From | To | Why | Who |
|---|---|---|---|---|---|
| K1 | `SERPAPI_KEY` | https://serpapi.com/manage-api-key | `.env` → K | Google AI answers; the site promises them | Julian |
| K2 | `GEMINI_API_KEY` | https://aistudio.google.com/apikey | `.env` → K | Gemini answers | Julian |
| K3 | `PERPLEXITY_API_KEY` | https://www.perplexity.ai/account/api/keys | `.env` → K | Perplexity answers | Julian |
| K4 | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ZONE_ID` | https://dash.cloudflare.com/profile/api-tokens → Create Custom Token `vidalo-runtime (facts hosts)`: Zone · SSL and Certificates · Edit, Zone · DNS · Edit, zone `vidalo.io` only (`docs/secrets-and-keys.md`, runtime token); zone id `5d39e2dacc81b8603d5dc69a163b6bca` | `.env` → K | Cloudflare for SaaS hostnames for facts pages; the fallback origin on `vidalo-worker` (D6) is still to be built by Claude before pages have an address | Julian |
| K5 | `INDEXNOW_KEY` | `openssl rand -hex 16` | `.env` → K | Tells Bing about new facts pages | Claude, on a yes |
| K6 | `GOOGLE_SERVICE_ACCOUNT_JSON` | https://console.cloud.google.com/iam-admin/serviceaccounts (project Vidalo) → Create → key JSON; add it as owner in Search Console | `.env` → K | Google index check of facts pages | Julian |
| K7 | `TWILIO_VERIFY_WHATSAPP=1` | after the WhatsApp sender is Online and linked (T2) | `.env` → W | Shows the WhatsApp button | Claude, after T2 |
| K8 | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | https://console.cloud.google.com/auth/clients (project Vidalo) → Create → Web; redirect URIs `https://vidalo.io/api/google/callback`, `http://localhost:3000/api/google/callback` | `.env` → W | Google route of ownership proof; useful once G1 is granted | Julian |
| K9 | `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys | `.env` → K | Claude as sixth AI system; needs #52 merged first | Julian |
| K10 | `STRIPE_SECRET_KEY` live (`sk_live_`) + live price ids, tax rate, portal, webhook | https://dashboard.stripe.com/apikeys after the live account exists (S1); Claude runs `pnpm stripe:setup --apply --live` | `.env` → W | Real payments; today the Workers hold the sandbox values | Julian + Claude |
| K11 | `KVK_API_KEY` (optional) | https://developers.kvk.nl | `.env` → W | KvK lookup as a second source | Julian |

Set a monthly budget at every AI provider when you create the key.

## Open topics
### Twilio (ownership by phone code, merged as #76)
| # | What | Where | Who |
|---|---|---|---|
| T1 | SMS geo permission: tick Netherlands | https://console.twilio.com/us1/develop/sms/settings/geo-permissions | Julian |
| T2 | WhatsApp sender: Create new sender → number (a Twilio number is fine) → Continue with Facebook → display name `Vidalo` → wait for Online → link it under Verify → Vidalo → WhatsApp | https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders · https://console.twilio.com/us1/develop/verify/services | Julian |
| T3 | One real test code to Julian's mobile through the production code path | Claude, needs the number | Claude |

### Google
| # | What | Where | Who |
|---|---|---|---|
| G1 | Business Profile API access: form "Application for Basic API Access", sent from the owner address of an A101 profile that is verified for 60+ days; text in the chat of 26 Oct | https://developers.google.com/my-business/content/prereqs | Julian |
| G2 | Google Business Profile for Vidalo itself (starts its own 60 days; gives the place id for W4) | https://business.google.com/create | Julian |

### Stripe
| # | What | Where | Who |
|---|---|---|---|
| S1 | Live account for Vidalo in the organisation (A101 B.V., KvK 42057858, bank account) | https://dashboard.stripe.com/account/onboarding | Julian |
| S2 | Public details: statement descriptor `VIDALO`, Terms `https://vidalo.io/voorwaarden`, Privacy `https://vidalo.io/privacy` (after #75 is merged) | https://dashboard.stripe.com/settings/public | Julian |
| S3 | Say whether the key in `.env` is `sk_live_` or `sk_test_`; then K10 | chat | Julian |
| S4 | One live purchase on a real card, refunded (B4) | after K10 | Julian + Claude |

### Mail
| # | What | Where | Who |
|---|---|---|---|
| M1 | Sign-in mail through Resend: request a link on https://vidalo.io/inloggen; if it comes from supabase.io, fill in SMTP (host `smtp.resend.com`, port `465`, user `resend`, password = a Resend key, sender `inloggen@vidalo.io`) | https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/smtp | Julian |
| M2 | Mailboxes hello@, support@, inloggen@, controle@ as aliases on Julian's Workspace user; send one test mail to hello@vidalo.io | https://admin.google.com/ac/users | Julian |

### Legal
| # | What | Where | Who |
|---|---|---|---|
| L1 | Review and merge #75 (terms, privacy, cookies NL+EN); add Meta next to Twilio in the privacy text for WhatsApp codes | https://github.com/A101io/vidalo/pull/75 | Julian |

### Operations
| # | What | Where | Who |
|---|---|---|---|
| O1 | Supabase Pro ($25/month): daily backups, then one restore drill | https://supabase.com/dashboard/org/_/billing | Julian |
| O2 | Uptime checks on `/`, `/privacy`, `/api/health` (Better Stack, free) | https://betterstack.com/uptime | Julian |
| O3 | 2FA on GitHub, Cloudflare, Supabase, Stripe, Google, Resend, Twilio, one.com | each account | Julian |
| O4 | Workers logs on; error alerts | `wrangler.jsonc` observability | Claude, on a yes |
| O5 | Rollback drill on preview (X5) | Claude, on a yes | Claude |

### Product
| # | What | Who |
|---|---|---|
| P1 | 20-business test scan (≈ €10), every finding checked by hand before reporting | Claude, on a yes |
| P2 | Copy that promises more than the product does (`docs/reality-check-2026-10-25.md`): fix before launch | Claude |
| P3 | Open PRs to review: #37 sign-in mail, #38 DNS check, #48 mails, #49 support replies, #51 owner area, #52 Claude, #65 mails in English, #73 research S2 | Julian |

### Decisions (suggestion after each)
1. Copilot in the paid-plan copy → out until it works.
2. Sector "eigen steekproef" figures with no data → delete.
3. Hero example → keep, labelled fictional.
4. Price for 2–10 locations → Julian's number.
5. KvK 42057858 → check against the uittreksel.
6. Facts host scheme → `{slug}-feiten.vidalo.io` (free).
7. Supabase Pro → yes.
8. Staging database ($10/month) → not yet.
9. Which A101 Google profile for G1 → Julian.

## Launch (one-way door, Julian's yes)
Deploy `production` from `deploy.yml`, gate `VIDALO_COMING_SOON=0`, live Stripe (K10, S4), legal pages live (L1), then `pnpm launch:mail` to the waiting list and `delete from waitlist;` by hand (P8).

## Spending caps (27 Oct 2026)
"Cap" = the provider stops or alerts by itself. Vidalo's own brakes: `FREE_SCANS_PER_DAY=25` (site-wide, live engines; 0 stops free scans), 3 phone codes per business per day, waitlist 5 posts per IP per 10 min. Only Twilio was read by API; the others Julian checks.

| Account | Cap possible | Set? | Where |
|---|---|---|---|
| OpenAI | hard monthly budget (stops) + alert | unknown; credit topped up 26 Oct | https://platform.openai.com/settings/organization/limits |
| Google Cloud (Places, later Gemini) | budget **alert** only; Places API quota per day can be capped | unknown | https://console.cloud.google.com/billing/budgets · quota: https://console.cloud.google.com/apis/api/places.googleapis.com/quotas |
| Twilio | prepaid balance **$20.00** (stops at 0 unless auto-recharge is on); usage trigger alert | balance yes; **no trigger** (read 27 Oct); auto-recharge unknown | https://console.twilio.com/us1/billing/manage-billing/usage-triggers · https://console.twilio.com/us1/billing/manage-billing/auto-recharge |
| Resend | plan limit (free 3,000 mails/month, then refuses) | plan unknown | https://resend.com/settings/billing |
| Cloudflare Workers | Workers Paid $5/month + usage; no hard cap, billing alerts only | plan unknown (Queues need Paid) | https://dash.cloudflare.com/37c9615a0d7d9629154eca03d7de59a6/billing |
| Supabase | Free: no spend. Pro: spend cap toggle (on by default) | Free today | https://supabase.com/dashboard/org/_/billing |
| Stripe | no spend; fees per payment | n/a | |
| SerpAPI, Perplexity, Anthropic | per-plan or monthly limit | no key yet | set when the key is made |
