# Stripe and Resend: setup brief

Started 16 Oct 2026. The record of how Vidalo's payments (Stripe) and email (Resend) were set up: what was decided and why, what was done, where every key lives, and what is still open. Update the status table when a step lands, with the proof.

## Summary

| Step | Status | Proof |
|---|---|---|
| Stripe account "Vidalo" in the A101 B.V. organisation | done | `acct_1UR4QnEKzmvgQ7J9` |
| Onboarding choices (no Managed Payments, no Stripe Tax, invoices on) | done | wizard, 16 Oct |
| Stripe connected to Claude (Vidalo account only, test mode) | done | connector lists Vidalo and Vidalo sandbox, nothing else |
| Integration reviewed against Stripe's planner; 3 bugs fixed | done, not committed | tests 191 + 8 green, `e2e:mock` OK |
| Customer portal configuration | done (test) | `bpc_1UR8MDEKzmvgQ7J9sXzbS8S0` |
| Terms URL, Privacy URL, statement descriptor | **open, Julian** | |
| iDEAL and SEPA Direct Debit switched on | **open, Julian** | both read `off` on 16 Oct |
| Test secret key in `.env` | **open, Julian** | |
| Prices, btw rate, webhook (`pnpm stripe:setup --apply`) | open, after the key | |
| A real test checkout end to end | open | |
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

The Stripe connector (`mcp.stripe.com`) was added in the Claude desktop app (Code tab) and granted to the Vidalo account only. It lists two contexts: `acct_1UR4QnEKzmvgQ7J9` (Vidalo, test mode) and `acct_1UR4RAELCe3OOCe2` (Vidalo sandbox). We use the first: it has the same account id as live, which is what the setup script pins. The sandbox is not used.

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

How to add the Stripe test key:
1. https://dashboard.stripe.com/test/apikeys → **Secret key** → Reveal → copy (starts with `sk_test_`).
2. Open the file: `open -e /Users/a101/Vidalo/.env` (hidden in Finder).
3. Add at the bottom, no quotes, no spaces around `=`:
   ```
   STRIPE_SECRET_KEY=sk_test_...
   VIDALO_STRIPE_ACCOUNT=acct_1UR4QnEKzmvgQ7J9
   STRIPE_PORTAL_CONFIGURATION=bpc_1UR8MDEKzmvgQ7J9sXzbS8S0
   ```
4. Save as plain text (⌘S).

The account id and the portal id are not secrets; the key is.

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

The code is ready: `packages/core/src/reporter/mail.ts` sends through Resend when `RESEND_API_KEY` is set and `VIDALO_MOCK` is not `1`; every template is in `packages/core/src/reporter/templates.ts`. E-mails are Dutch only for now.

Proof: a report mail and a sign-in mail arrive at Julian's address, and Resend's log shows both as delivered.

**Open decision: `hallo@vidalo.io` cannot receive mail.** `vidalo.io` has no MX record, and that address is the reply-to on our mail and the contact for ownership questions. Cheapest fix: Cloudflare Email Routing forwarding it to Julian's A101 address.

## 10. Live mode and production

At launch, not before:
1. The same dashboard settings in live mode (the `test/` links without `test/`).
2. Live key, then `PUBLIC_BASE_URL=https://vidalo.io` and `--apply --live`; the script refuses a live key without `--live`. This creates the live prices, tax rate, portal and the webhook for `https://vidalo.io/api/stripe/webhook`.
3. Every `STRIPE_*`, `RESEND_API_KEY` and `EMAIL_FROM` value on the Worker: `wrangler secret put NAME --name vidalo-web` (and `RESEND_API_KEY`, `EMAIL_FROM` on `vidalo-worker` too).
4. Proof: a real €149 payment, refunded afterwards; the webhook shows 200 in the Stripe dashboard; the business moves to `trial`.

## Reference

| Thing | Value |
|---|---|
| Stripe account | Vidalo, `acct_1UR4QnEKzmvgQ7J9`, in organisation A101 B.V. |
| Stripe sandbox (unused) | `acct_1UR4RAELCe3OOCe2` |
| Other A101 accounts, never touch | Sitty `acct_1UA8rHEGTq7D30VV`, Sonable `acct_1TyIM8EQK4LIWEDd` |
| Portal configuration (test) | `bpc_1UR8MDEKzmvgQ7J9sXzbS8S0` |
| Webhook path | `/api/stripe/webhook`, events in `STRIPE_WEBHOOK_EVENTS` (`packages/core/src/billing/index.ts`) |
| Billing rules and tests | `packages/core/src/billing/index.ts`, `packages/core/test/billing.test.ts` |
| Payments doc | `docs/PAYMENTS.md` |
| Secrets list | `docs/secrets-and-keys.md` |
| Supabase project | `bbynmqvaxpjdnkaasutd` |
