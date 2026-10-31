# Payments (Stripe)

Two plans, both excl. 21% btw:

| Plan | What | Stripe |
|---|---|---|
| Goed zetten | €149 once | Checkout `mode=payment`, invoice created |
| Goed zetten en houden | €149 once + €49/month | Checkout `mode=subscription`, setup as a one-time first line |
| Goed houden (later) | €49/month | `plan=monitor_addon`, from `/app/abonnement`, verified owner only |

Every line carries the 21% NL tax rate (`STRIPE_TAX_RATE_ID`). A live checkout
without it is refused and the visitor sees "Afrekenen lukt nu even niet":
charging €149 flat for a price shown excl. btw would cost 21% on every sale.

### Businesses outside the Netherlands (26 Oct 2026)

A business has a country (`business.country`, migration 0014). For a business
abroad the fixed 21% is wrong (an EU business with a valid VAT number gets
reverse charge, one outside the EU no Dutch VAT), so:

- `VIDALO_STRIPE_TAX` unset (today, decision 16 Oct stands): checkout for a
  business outside NL is refused before Stripe, logged as
  `checkout.refused` / `abroad_no_tax`, and the page says to mail
  support@vidalo.io. Dutch businesses pay as before.
- `VIDALO_STRIPE_TAX=1`: `automatic_tax` on every session and no tax rate on
  the lines; Stripe Tax works it out from the billing address and the VAT
  number Checkout already collects. Needs, in the Stripe dashboard: Stripe Tax
  on, the origin address (Factorij 80, Rotterdam), the NL registration, and the
  prices' `tax_behavior: exclusive` and tax code (`pnpm stripe:setup` already
  sets both). Stripe charges a fee per transaction for Tax. Switch it on only
  after the accountant confirms the rules (go-live B6), then update the VAT
  FAQ (`copy.subscription.faq`, NL and EN) and the abroad answer in the landing FAQ.

## What a payment does to a business

All of it is in `packages/core/src/billing/index.ts`, tested in
`packages/core/test/billing.test.ts`. The webhook route only verifies the
signature and hands the event over.

- Paid checkout → `trial`, Stripe ids stored, setup job queued (it waits for
  proven ownership; the Google callback queues it again once proven).
- SEPA debit (and slow iDEAL): the session completes unpaid; nothing starts
  until `checkout.session.async_payment_succeeded`. A failed debit starts nothing.
- First renewal (`invoice.paid`, `subscription_cycle`) → `active`.
- Stripe gives up collecting (subscription `unpaid`) → `paused`; paid again → `active`.
- Subscription ended → `churned` (facts page redirects, see publisher/serve.ts).
- Each Stripe event id is handled once per business; retries are no-ops.

Dunning itself is Stripe's: set **Settings → Billing → Subscriptions and
emails → Manage failed payments** to retry (Smart Retries), email the
customer, and then **mark the subscription as unpaid** (not cancel), so a
late payer resumes instead of churning.

## What Checkout asks, as for Sonable (playbook/STRIPE.md)

- **Terms checkbox** (`consent_collection.terms_of_service: "required"`) with
  the B2B confirmation and the links to `/voorwaarden` and `/privacy` above
  the pay button (`copy.checkout.consentSubmit` / `consentAccept`, in the
  visitor's language). 🔴 This needs the **Terms of Service URL and Privacy
  Policy URL on the Stripe account** (Settings → Public details); without
  them Stripe rejects every session and the visitor sees "Afrekenen lukt nu
  even niet". Proof is not the settings page: the `checkout.completed` event
  in our log carries `termsConsent: "accepted"` once a real session completed.
- **Billing address** required, **btw-nummer** collected (`tax_id_collection`,
  required when supported); it lands on the invoice.
- **Return URLs follow the host the visitor is on** (`lib/origin.ts`, from
  the Origin/Referer, our hosts only, else `PUBLIC_BASE_URL`), so a domain
  change or the workers.dev preview never sends a customer to a dead host.
- `managed_payments` off: it cannot be combined with the custom text above.
- Customer portal: `return_url` explicit on every session (the subscription
  page, same host rule), locale from the page the button was on.

## Setting it up

1. A Stripe account that is Vidalo's (not Sitty's `acct_1UA8rHEGTq7D30VV`,
   not Sonable's `acct_1TyIM8EQK4LIWEDd`; the script refuses both).
   Account settings before the first test checkout: Terms URL and Privacy URL
   (above), VAT registered with the NL rate and the Rotterdam address,
   statement descriptor "VIDALO", invoice branding with A101 B.V.'s KvK and
   btw-nummer.
2. Test mode first:
   ```bash
   STRIPE_SECRET_KEY=sk_test_... PUBLIC_BASE_URL=https://<site> pnpm stripe:setup
   ```
   The first run prints the key's account and stops. If it is Vidalo's, add
   `VIDALO_STRIPE_ACCOUNT=acct_...` and run again to see what is missing;
   add `--apply` to create it. It prints the env lines for the web app:
   `STRIPE_PRICE_SETUP`, `STRIPE_PRICE_MONITOR`, `STRIPE_TAX_RATE_ID`,
   `STRIPE_WEBHOOK_SECRET` (shown once, at creation).
3. Dashboard, by hand: enable iDEAL and SEPA Direct Debit (Payment methods),
   the Customer portal (cancel at period end, invoice history, update
   payment method), invoice branding with A101 B.V.'s KvK and btw-nummer,
   and the failed-payment settings above.
4. Live: the same with the live key and `--apply --live`.

## Checked here, and not

Checked: the billing rules (10 tests, with a control that fails if an
unpaid SEPA checkout starts the service); every page in mock mode.
Not checked: a real Stripe Checkout, webhook delivery and the portal. This
container cannot reach Stripe, and there is no Vidalo key yet.
