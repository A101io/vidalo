# Stripe and Resend: setup brief

Started 16 Oct 2026. The record of how Vidalo's payments (Stripe) and email (Resend) were set up: what was decided and why, what was done, where every key lives, and what is still open. Update the status table when a step lands, with the proof.

## Summary

| Step | Status | Proof |
|---|---|---|
| Stripe account "Vidalo" in the A101 B.V. organisation | done (sandbox only) | sandbox `acct_1UR4RAELCe3OOCe2`; no live account yet |
| Onboarding choices (no Managed Payments, fixed 21% rate, invoices on) | done | wizard, 16 Oct |
| Integration reviewed against Stripe's planner; 4 fixes | done, merged | §3 |
| Prices, btw rate, portal, webhook (`pnpm stripe:setup --apply`) | done in the sandbox | 25 Oct; ids on `vidalo-web` (`wrangler secret list`, 26 Oct) |
| iDEAL and SEPA Direct Debit | done per Julian, 26 Oct (sandbox; not read back) | |
| Cancel and pause in the app; portal without cancelling | done, mock + local Postgres | `docs/CANCEL-PAUSE.md` |
| A real sandbox checkout end to end | **open** | §8 |
| **Live account, live settings, live key, one refunded purchase** | **open: §10 L1–L10** | |
| Stripe Tax for businesses abroad | open: accountant first | §10 L11, `docs/PAYMENTS.md` |
| Resend account, `vidalo.io` domain verified | open, Julian | |
| Resend API key in `.env` | open, Julian | |
| Supabase sign-in mail through Resend (SMTP) | open, Julian | |
| An inbox for `hallo@vidalo.io` (no MX record yet) | open, decision | |
| Live mode and Cloudflare secrets | open, at launch | |

## 1. Stripe account

**Decision: an account inside the A101 B.V. organisation**, not a separate one. It keeps its own keys, customers, products and payouts; it shares the login, team and reporting with Sitty and Sonable. The setup script pins the account id, so living next to the other two cannot mix anything up.

Business description given to Stripe:

> Vidalo makes Dutch businesses ready for AI agents: correct facts, published in a format every AI assistant can read and trust.

**Decision: "Pick what you need", not Managed Payments.** Managed Payments cannot be combined with the custom text Checkout shows above the pay button (the B2B confirmation and the terms and privacy links), so every checkout would fail; it also costs 3.5% extra per transaction. The code sets `managed_payments: { enabled: false }` for the same reason.

**Decision: no Stripe Tax.** We only sell to Dutch businesses at 21% btw. The setup script creates one fixed, exclusive 21% tax rate and checkout puts it on every line. Stripe Tax would cost 0.5% per transaction and clash with the fixed rate.

**Decision: "Send invoices" on.** The €149 one-time checkout creates an invoice; business customers need it for their books.

**Decision: the pricing wizard was closed.** It creates a product and price of its own; the setup script creates the ones the code looks for (by lookup key, with the tax rate). Wizard products would only be duplicates.

## 2. Stripe connected to Claude

The Stripe connector (`mcp.stripe.com`) was added in the Claude desktop app (Code tab) and granted to the Vidalo account only. It lists two contexts: `acct_1UR4QnEKzmvgQ7J9` (Vidalo, test mode) and `acct_1UR4RAELCe3OOCe2` (Vidalo sandbox). **Changed 25 Oct 2026 (Julian): only the sandbox exists for Vidalo, so the sandbox is what we use** (`VIDALO_STRIPE_ACCOUNT=acct_1UR4RAELCe3OOCe2`). `stripe:setup --apply` ran against it that day: prices €149 and €49/month, BTW 21% exclusive, portal "Vidalo" without cancelling, webhook `we_1UUPzEELCe3OOCe2Z48U08Sn` → `https://vidalo.io/api/stripe/webhook`; every id and the webhook secret went straight into `.env` and on to `vidalo-web` (`pnpm secrets:push`). The statement descriptor needs a live account. Going live means a live account in the organisation, `--apply --live`, and pinning that account.

What the connector can and cannot do, found out on 16 Oct:
- It can read and write products, prices, payment method configurations and portal configurations.
- It cannot read or change account-level settings (public details, branding, statement descriptor). Those stay in the dashboard.
- It does not hand out a secret key. The app and the setup script need their own key in `.env`.

## 3. The integration, reviewed

The integration already existed (see `docs/PAYMENTS.md`): hosted Checkout, two plans plus the later add-on, a webhook that hands every event to `packages/core/src/billing`, the customer portal, and `apps/web/scripts/stripe-setup.mjs`. Stripe's implementation planner was run with Vidalo's context. Its recommendations match: hosted Checkout, flat-rate prices, the hosted customer portal with cancel at period end, Smart Retries and failed-payment emails, the invoice from Checkout. Where we differ on purpose: our own tax rate instead of Stripe Tax, and payment methods listed in the code (card, iDEAL, SEPA for subscriptions) instead of letting Stripe choose, so customers only see methods that suit a Dutch business.

Fixed during the review:

1. **Every webhook would have failed on Cloudflare.** On Workers the Stripe SDK loads its `worker` build, which checks signatures with Web Crypto; the synchronous `constructEvent` throws there ("SubtleCryptoProvider cannot be used in a synchronous context"). The route caught that as "bad signature" and answered 400, so no payment would ever have started the service. Now `constructEventAsync` (`apps/web/app/api/stripe/webhook/route.ts`). Proven with `node --conditions=worker`: the old call throws, the new one accepts a valid signature and rejects a wrong secret.
2. **A failed attempt could lose a payment.** The event id was recorded as handled before the work ran; if the work threw, Stripe's retry was treated as a duplicate. It is now recorded after the work succeeds (`packages/core/src/billing/index.ts`).
3. **Webhook API version pinned** to the SDK's (`2025-02-24.acacia`) when the setup script creates the endpoint, so events arrive in the shape the billing code reads rather than the account's default version.
4. **Portal configuration.** Stripe does not make an API-created configuration the default, so the portal route now passes `STRIPE_PORTAL_CONFIGURATION`, and the setup script finds or creates the configuration named "Vidalo".

The lesson from fix 1 is in `A101/_OS/LEARNINGS.md` (16 Oct). Sitty and Sonable do not use the synchronous call.

## 4. Customer portal

Created in test mode through the connector: `bpc_1UR8MDEKzmvgQ7J9sXzbS8S0`, named "Vidalo".

- Invoice history: on
- Update payment method: on
- Update name, email, address, btw-nummer: on
- Cancel: at the end of the period, no proration, asks for a reason
- Change plan: off (there is one plan)
- Headline "Vidalo: je facturen, betaalmethode en abonnement"; terms `https://vidalo.io/voorwaarden`, privacy `https://vidalo.io/privacy`; return to `https://vidalo.io/app/abonnement` (each session sets its own return URL on the visitor's host)

## 5. Dashboard settings (by hand)

The connector cannot set these; each one needs the account switcher (top left) on **Vidalo**.

| Setting | Value | Where |
|---|---|---|
| Terms of service URL | `https://vidalo.io/voorwaarden` | https://dashboard.stripe.com/settings/public |
| Privacy policy URL | `https://vidalo.io/privacy` | same page |
| Statement descriptor | `VIDALO` | same page |
| iDEAL (and Wero, if offered) | on | https://dashboard.stripe.com/test/settings/payment_methods |
| SEPA Direct Debit | on | same page |
| Failed payments | Smart Retries, email the customer, then **mark the subscription as unpaid** (not cancel) | https://dashboard.stripe.com/test/settings/billing/automatic |
| Invoice branding | logo, A101 B.V. KvK and btw-nummer | https://dashboard.stripe.com/settings/branding |

Why these matter: without the Terms URL Stripe rejects every Checkout session (we ask for terms consent); without iDEAL and SEPA switched on, Checkout refuses the payment methods the code asks for. "Unpaid" rather than "cancel" lets a late payer resume instead of churning (`docs/PAYMENTS.md`).

## 6. Saving keys

Rules:
- A key goes in a file or a secret store, **never in a chat**, an email, a commit or a screenshot.
- Locally: the root `.env` (`/Users/a101/Vidalo/.env`). It is gitignored and read by the web app too (`apps/web/next.config.ts`). `pnpm scan:secrets` fails CI if anything key-shaped lands in a tracked file.
- In production: Cloudflare Worker secrets (step 10). GitHub only holds the Cloudflare deploy token.
- The full list of every secret, where it comes from and how to prove it landed: `docs/secrets-and-keys.md`.

How the sandbox key was added (done 25 Oct; kept for a new machine):
1. Account switcher (top left) on **Vidalo sandbox** → Developers → API keys → **Secret key** → Reveal → copy (starts with `sk_test_`).
2. Open the file: `open -e /Users/a101/Vidalo/.env` (hidden in Finder).
3. Add at the bottom, no quotes, no spaces around `=`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   VIDALO_STRIPE_ACCOUNT=acct_1UR4RAELCe3OOCe2
   ```
4. Save as plain text (⌘S).

The account id is not a secret; the key is. `pnpm stripe:setup` prints the portal id and the rest.

## 7. Prices, tax rate and webhook

Run from `apps/web`, loading the root `.env`:

```bash
cd /Users/a101/Vidalo/apps/web && node --env-file=../../.env scripts/stripe-setup.mjs
```

The first run checks only. It prints the key's account and stops if it is not `VIDALO_STRIPE_ACCOUNT` (or is Sitty's or Sonable's). Then with `--apply` it creates what is missing and prints the env lines to add:

| Line | What |
|---|---|
| `STRIPE_PRICE_SETUP` | "Vidalo Goed zetten", €149 once, excl. btw (lookup `vidalo_setup_eur_149`) |
| `STRIPE_PRICE_MONITOR` | "Vidalo Goed houden", €49/month, excl. btw (lookup `vidalo_monitor_eur_49`) |
| `STRIPE_TAX_RATE_ID` | BTW 21% NL, exclusive |
| `STRIPE_PORTAL_CONFIGURATION` | the portal above |
| `STRIPE_WEBHOOK_SECRET` | only when `PUBLIC_BASE_URL` is set; shown once, at creation |

Running it twice creates nothing twice. Checkout refuses to start without the tax rate.

## 8. A real test checkout

Locally, the webhook comes in through the Stripe CLI rather than a public URL:

```bash
brew install stripe/stripe-cli/stripe
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

`stripe listen` prints a `whsec_...` for this machine; that goes in `.env` as `STRIPE_WEBHOOK_SECRET`. Then start `vidalo-dev`, run a free check, choose a plan and pay with test card `4242 4242 4242 4242` (any future date, any CVC), and once with iDEAL and SEPA.

Proof, not the dashboard: the business's event log has `checkout.completed` with `termsConsent: "accepted"`, the business is `trial`, and the setup job is queued (it waits for proven ownership). A SEPA test payment shows `payment.processing` first and only starts on `async_payment_succeeded`.

## 9. Resend

1. Sign up with julian.devriend@a101.io: https://resend.com/signup
2. Add the domain `vidalo.io`, region **Ireland (eu-west-1)**, next to Supabase: https://resend.com/domains. DNS for `vidalo.io` is on Cloudflare (`nucum`/`zac.ns.cloudflare.com`, checked 16 Oct), so use Resend's **Auto configure with Cloudflare**. Wait for "Verified".
3. API key with **Sending access** for `vidalo.io` only: https://resend.com/api-keys. Add to `.env`:
   ```
   RESEND_API_KEY=re_...
   EMAIL_FROM=Vidalo <controle@vidalo.io>
   ```
4. Sign-in mail through Resend too. Supabase's built-in mailer sends only a few mails per hour, from Supabase's own address. https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/smtp, Custom SMTP: host `smtp.resend.com`, port `465`, user `resend`, password the same `re_` key, sender `inloggen@vidalo.io`, name `Vidalo`.
5. Branded sign-in mail. https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/templates → Magic link: subject `Je inloglink voor Vidalo`, body the whole of `docs/brand/supabase-magic-link.html`.

The code is ready: `packages/core/src/reporter/mail.ts` sends through Resend when `RESEND_API_KEY` is set and `VIDALO_MOCK` is not `1`; every template is in `packages/core/src/reporter/templates.ts`, and every mail goes out in the brand's shell with the logo attached inline (`textToHtml`; logo rebuilt by `node scripts/brand/email-logo.mjs`). E-mails are Dutch only for now.

Proof: a report mail and a sign-in mail arrive at Julian's address, and Resend's log shows both as delivered.

**Open decision: `hallo@vidalo.io` cannot receive mail.** `vidalo.io` has no MX record, and that address is the reply-to on our mail and the contact for ownership questions. Cheapest fix: Cloudflare Email Routing forwarding it to Julian's A101 address.

## 10. Going live on Stripe, step by step

Live money needs a live account. Today Vidalo has only the sandbox, so every step below is still open. **J** = Julian in the dashboard, **C** = Claude in the repo. Do them in order; each ends with how we know it worked.

Values used throughout:

| Field | Value |
|---|---|
| Legal entity | `A101 B.V.` |
| KvK | `42057858` |
| btw-nummer | `NL869514192B01` |
| Registered address | `Factorij 80`, `3071 AV`, `Rotterdam`, Netherlands |
| Public name and statement descriptor | `Vidalo` / `VIDALO` |
| Website | `https://vidalo.io` |
| Terms / Privacy | `https://vidalo.io/voorwaarden` / `https://vidalo.io/privacy` |
| Support e-mail | `support@vidalo.io` (needs the mailbox from launch-todo M2 first) |

**Before you start, know this about review.** Stripe looks at the website during activation. Terms, privacy and contact pass the coming-soon gate (checked 1 Nov 2026), but the prices page does not: a reviewer sees "Binnenkort". The product description in L1 therefore carries the prices. If Stripe still asks, the answer is to send them the preview link or to open `/prijzen` in the gate; that is your call when it happens.

### L1 (J) Activate a live account for Vidalo
https://dashboard.stripe.com/account/onboarding, with the account switcher (top left) on **Vidalo**. If the switcher shows only "Vidalo sandbox", choose **+ New account** inside the A101 B.V. organisation, name `Vidalo`, then activate it.

| Field | Value |
|---|---|
| Type of business | `Company` → `Private company` (B.V.) |
| Legal business name | `A101 B.V.` |
| Company registration number | `42057858` |
| VAT number | `NL869514192B01` |
| Registered address | `Factorij 80`, `3071 AV`, `Rotterdam` |
| Industry | `Software` → `Software as a service (SaaS)` |
| Website | `https://vidalo.io` |
| Product description | the block below |
| Representative, owner, bank account (IBAN of A101 B.V.) | your own details; only you enter these |
| Statement descriptor / shortened | `VIDALO` / `VIDALO` |

Product description:
```
Vidalo checks what AI assistants say about a Dutch business, finds wrong facts and their sources, and corrects them. Two plans for businesses (B2B only): a one-time setup at EUR 149 and a monthly check at EUR 49, both excluding 21% VAT. The site is in pre-launch; terms at https://vidalo.io/voorwaarden, privacy at https://vidalo.io/privacy, contact at https://vidalo.io/contact.
```
Done when: the dashboard no longer shows "Activate payments" and the top left shows **Vidalo** without the word sandbox.

### L2 (J) Public details
https://dashboard.stripe.com/settings/public

| Field | Value |
|---|---|
| Public business name | `Vidalo` |
| Statement descriptor | `VIDALO` |
| Shortened descriptor | `VIDALO` |
| Support e-mail | `support@vidalo.io` |
| Business website / Support website | `https://vidalo.io` / `https://vidalo.io/contact` |
| Terms of service | `https://vidalo.io/voorwaarden` |
| Privacy policy | `https://vidalo.io/privacy` |

Why: Checkout asks for terms consent, and Stripe refuses every session while the Terms URL is empty. The visitor would see "Afrekenen lukt nu even niet".

### L3 (J) Payment methods
https://dashboard.stripe.com/settings/payment_methods: **Cards** on, **iDEAL** on, **SEPA Direct Debit** on. The code asks for exactly these (card and iDEAL for the one-time plan, SEPA as well for the subscription); Checkout refuses a method that is off. SEPA may ask for extra details before it turns on.

### L4 (J) Branding and invoices
https://dashboard.stripe.com/settings/branding

| Field | Value |
|---|---|
| Icon | `/Users/a101/Vidalo/docs/brand/social/avatar/vidalo-avatar-blue.png` |
| Logo | `/Users/a101/Vidalo/apps/web/public/logo-512.png` |
| Brand colour | `#2563EB` |
| Accent colour | `#111827` |

https://dashboard.stripe.com/settings/billing/invoice → **Default footer**:
```
A101 B.V. · Factorij 80, 3071 AV Rotterdam · KvK 42057858 · btw NL869514192B01 · support@vidalo.io
```
Do **not** switch on Stripe Tax: the setup script creates a fixed, exclusive 21% rate and Checkout puts it on every line (decision 16 Oct; abroad comes later, L11).

### L5 (J) Failed payments
https://dashboard.stripe.com/settings/billing/automatic

| Setting | Value |
|---|---|
| Smart Retries | on (Stripe's default schedule) |
| E-mail customers when a payment fails | on |
| If all retries for a payment fail | **Mark the subscription as unpaid** (not cancel) |

Why "unpaid": the app pauses the business and a late payer resumes, instead of losing their facts page (`docs/PAYMENTS.md`).

### L6 (J) Live secret key, into its own file
The live key stays out of the root `.env`, so local development keeps using the sandbox. `.env.live` is gitignored like `.env`.

1. In Terminal: `touch /Users/a101/Vidalo/.env.live && open -e /Users/a101/Vidalo/.env.live`
2. https://dashboard.stripe.com/apikeys (live, account **Vidalo**) → **Secret key** → Reveal → copy (starts with `sk_live_`).
3. Paste into the file, no quotes, no spaces around `=`, and save (⌘S):
   ```
   STRIPE_SECRET_KEY=sk_live_...
   PUBLIC_BASE_URL=https://vidalo.io
   ```
4. Tell Claude: "live key in .env.live". Never paste the key in the chat.

### L7 (C) Prices, tax rate, portal and webhook on the live account
```bash
cd /Users/a101/Vidalo/apps/web && node --env-file=../../.env.live scripts/stripe-setup.mjs
```
The first run prints the key's account and stops. C checks it is not the sandbox (`acct_1UR4RAELCe3OOCe2`), Sitty or Sonable, adds `VIDALO_STRIPE_ACCOUNT=acct_...` to `.env.live`, then runs again with `--apply --live` (the script refuses a live key without `--live`). It creates "Vidalo Goed zetten" €149 once, "Vidalo Goed houden" €49/month, BTW 21% exclusive, the portal "Vidalo" without cancelling, and the webhook to `https://vidalo.io/api/stripe/webhook` with the seven events the billing code handles. C writes the printed `STRIPE_*` lines into `.env.live` without showing them; the webhook secret is shown only this once. A second check run must report nothing missing.

### L8 (C) Live values onto the web Worker, then deploy
```bash
cd /Users/a101/Vidalo && pnpm secrets:push --env .env.live --apply --live --only STRIPE_SECRET_KEY,STRIPE_WEBHOOK_SECRET,STRIPE_PRICE_SETUP,STRIPE_PRICE_MONITOR,STRIPE_TAX_RATE_ID,STRIPE_PORTAL_CONFIGURATION
```
`VIDALO_STRIPE_ACCOUNT` stays in `.env.live`: only the setup script reads it, no Worker does.
Then `deploy.yml` → `production`. Done when `wrangler secret list` on `vidalo-web` shows all six names and the deploy's checks pass. From here the sandbox webhook (`we_1UUPzEELCe3OOCe2Z48U08Sn`) also still points at vidalo.io and will fail its signature check; **J** disables it: account switcher → **Vidalo sandbox** → Developers → Webhooks → that endpoint → **Disable**.

### L9 (J) One real purchase, then refund
1. Open the full site behind the gate: https://vidalo.io/voorvertoning, key `VIDALO_PREVIEW_KEY` from your root `.env`.
2. Run a free check on a business, choose **Goed zetten** (one-time, so no subscription is left behind), pay with iDEAL: `€149,00 + €31,29 btw = €180,29`.
3. Refund it: https://dashboard.stripe.com/payments → that payment → **Refund** → full amount.
4. Tell Claude the business name you used.

### L10 (C) Read back the proof
- The business's event log has `checkout.completed` with `termsConsent: "accepted"`, and the business moved to `trial` (Supabase, project `bbynmqvaxpjdnkaasutd`).
- https://dashboard.stripe.com/webhooks → the Vidalo endpoint shows `200` for `checkout.session.completed`.
- The invoice carries the 21% line and the footer from L4.
- C then stops the test business's queued setup job and records the test, so nothing runs for a business that did not buy.

Only after L10 is Stripe live. Update this file's status table and go-live B1–B4 with the proof.

### L11 Later: businesses outside the Netherlands
Checkout refuses a business abroad today. When the accountant has confirmed the rules (go-live B6): Stripe Tax on with the origin address above and the NL registration, `VIDALO_STRIPE_TAX=1` on `vidalo-web`, VAT FAQ updated. Details in `docs/PAYMENTS.md`.

## Reference

| Thing | Value |
|---|---|
| Stripe account in use | Vidalo sandbox, `acct_1UR4RAELCe3OOCe2`, in organisation A101 B.V.; live account: after §10 L1 |
| Former test account | `acct_1UR4QnEKzmvgQ7J9` (16 Oct; replaced by the sandbox 25 Oct) |
| Other A101 accounts, never touch | Sitty `acct_1UA8rHEGTq7D30VV`, Sonable `acct_1TyIM8EQK4LIWEDd` |
| Portal configuration | id printed by `pnpm stripe:setup`, per account |
| Webhook path | `/api/stripe/webhook`, events in `STRIPE_WEBHOOK_EVENTS` (`packages/core/src/billing/index.ts`) |
| Billing rules and tests | `packages/core/src/billing/index.ts`, `packages/core/test/billing.test.ts` |
| Payments doc | `docs/PAYMENTS.md` |
| Secrets list | `docs/secrets-and-keys.md` |
| Supabase project | `bbynmqvaxpjdnkaasutd` |
