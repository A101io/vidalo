# Vidalo: what is left for a working product (25 Oct 2026)

Today: vidalo.io is live as the coming-soon page (23 Oct, Hyperdrive, db:pg). Stripe account `acct_1UR4QnEKzmvgQ7J9` exists (test mode). On the production Workers the only secret is `VIDALO_PREVIEW_KEY`: no AI, mail or payment key is there yet.

## Where keys go
- **Local**: one line `NAME=value` in `/Users/a101/Vidalo/.env`. Then tell Claude "X is in .env", by name. Never paste a value in chat.
- **Production**: Cloudflare dashboard → Workers & Pages → `vidalo-web` (W) or `vidalo-worker` (K) → Settings → Variables and Secrets → Add → type **Secret**. The column says which Worker(s).

## Julian: keys (longest lead time first)
| # | Key | Where to get it | Name | Worker |
|---|---|---|---|---|
| K1 | Google Business Profile API access (days to weeks) | https://developers.google.com/my-business/content/prereqs → access request form, project "Vidalo" | (no key, approval) | |
| K2 | Google OAuth client | console.cloud.google.com → project Vidalo → Google Auth Platform → Branding (Vidalo, support@vidalo.io, vidalo.io) → Clients → Create → Web application; redirect URIs `https://vidalo.io/api/google/callback` and `http://localhost:3000/api/google/callback` | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | W |
| K3 | Google Places | same project → APIs & Services → enable "Places API (New)" → Credentials → Create API key → restrict to Places API | `GOOGLE_PLACES_API_KEY` | W |
| K4 | Stripe test secret key | dashboard.stripe.com → account Vidalo, Test mode → Developers → API keys → Secret key `sk_test_…` | `STRIPE_SECRET_KEY` and `VIDALO_STRIPE_ACCOUNT=acct_1UR4QnEKzmvgQ7J9` | W |
| K5 | Resend | resend.com → Domains → Add `vidalo.io` (EU) → copy the DNS records into Cloudflare → DNS; API Keys → Create, permission "Sending access", domain vidalo.io | `RESEND_API_KEY` | W + K |
| K6 | Turnstile (bot check) | dash.cloudflare.com → Turnstile → Add widget "Vidalo", hostnames `vidalo.io`, `localhost` | `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | W |
| K7 | OpenAI (already in `.env`) | platform.openai.com → Settings → Limits: set a hard monthly budget | `OPENAI_API_KEY` | W + K |
| K8 | Gemini | aistudio.google.com/apikey | `GEMINI_API_KEY` | K |
| K9 | Perplexity | perplexity.ai/account/api/keys | `PERPLEXITY_API_KEY` | K |
| K10 | SerpAPI (Google AI answers) | serpapi.com/manage-api-key | `SERPAPI_KEY` | K |
| K11 | Anthropic (Claude, PR #52) | console.anthropic.com → API keys | `ANTHROPIC_API_KEY` | K |
| K12 | KvK (optional) | developers.kvk.nl | `KVK_API_KEY` | W |

Set a monthly budget at every AI provider (K7–K11) when you create the key.

## Julian: dashboard clicks
1. Stripe → Settings → Public details: Terms `https://vidalo.io/voorwaarden`, Privacy `https://vidalo.io/privacy`, statement descriptor `VIDALO`. Settings → Payment methods: iDEAL and SEPA Direct Debit on.
2. Supabase (`bbynmqvaxpjdnkaasutd`) → Authentication → URL Configuration: Site URL `https://vidalo.io`, Redirect URLs `https://vidalo.io/auth/callback`, `http://localhost:3000/auth/callback`. Then → SMTP through Resend (steps in PR #37).
3. Supabase → Billing: Pro plan (daily backups, go-live D2).
4. Cloudflare → vidalo.io → SSL/TLS: Full (strict); Edge Certificates: Always Use HTTPS on.
5. Click "Stuur inloglink" once on the local sign-in page (A1, D4).

## Julian: decisions and content
1. Upload the De Boer Legal masters to `/Users/a101/Vidalo/docs/legal-masters/` (not iCloud). Terms and privacy block checkout (L1, B3).
2. Confirm Vidalo's own facts: address, hours, phone, payment methods, name clashes (W2, W3).
3. Facts host scheme: `{slug}-feiten.vidalo.io` (free) or `{slug}.feiten.vidalo.io` (+$10/month) (D5).
4. Staging database: yes ($10/month) or keep `local-prod.sh` only (X6).
5. Copy: Copilot out of the paid-plan copy; the eight sector "eigen steekproef" figures (run or delete); price for 2–10 locations.
6. Approve the first real scan: 20 businesses in one town with ChatGPT, about 200 calls (P3).
7. Review and merge the open PRs: #37 sign-in mail, #38 DNS check, #48 mails, #49 support replies, #51 owner area, #52 Claude, #53 free check behind the gate.
8. Launch day: the gate to 0, Stripe live keys, one real purchase refunded (B4), mail the waiting list.

## Claude: no key needed (starts 09:01 today, one PR each)
1. Bring `go-live-checklist.md` and `SETUP_STATUS.md` up to date (production deploy, Stripe account, Next 16, PRs since 20 Oct).
2. Launch-mail tool for the waiting list: dry run by default, `--send` only with an approval file, never deletes (P8).
3. Turnstile on the free check and sign-in, with Cloudflare's test keys; fails closed in production without a secret (B4).
4. Incident runbook and rollback plan, rollback tried once on preview (H9, X5).
5. Export and delete my data on `/app/account` (C2, GDPR).

## Claude: after your key or your yes
- K4 in → `pnpm stripe:setup --apply` (prices, 21% btw, webhook), then a test checkout end to end.
- Your yes on decision 6 → the first real scan and a reading of the results.
- K5 in → `pnpm mail:send` to one inbox of yours.
- K3 + K2 in → `/scan/kies` and ownership proof up to the Google step.
- `UNSUBSCRIBE_SECRET` and `INDEXNOW_KEY`: I generate them and set them on both Workers, on your yes.
