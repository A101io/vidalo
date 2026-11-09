# Domains: option B, "Laat Vidalo een domein registreren"

A paid add-on (9 Nov 2026). An owner without a domain of their own, or who rather not touch DNS, buys a domain on `/app/domein`; Vidalo registers it in the business's name through a registrar's API and puts the facts page on `feiten.{domain}`. Option A (one CNAME on the owner's own domain) stays the default and costs nothing extra.

Research: 9 Nov 2026, read-only; nothing was signed up. "NC" = not confirmed. Sources at the bottom.

## 1. Registrar choice

| | **Openprovider** | TransIP | Cloudflare Registrar | Realtime Register |
|---|---|---|---|---|
| .nl register / renew | Members pay cost price; the figure is behind login (NC). SIDN charges registrars €4.38/yr excl. VAT [1] | €0.49 first year, then **€16.50/yr** excl. VAT [4] | **not offered** [8] | partner pricing (NC) |
| .com register / renew | **$11.17 member, $12.17 non-member** (after Verisign's 1 Nov 2026 rise) [3] | €8.99, then €27.99 [4] | at cost, about $8.57 in Apr 2026 [7] | NC |
| .eu register / renew | NC (behind login) | €7.99, then €26.99 [4] | **not offered** [8] | NC |
| Membership | free tier; Basic S $4.16/mo, M $16.66, L $41.67 (billed yearly, excl. VAT) [2] | none; discount from 150 domains [5] | none | partner agreement |
| API | REST/JSON with an OpenAPI spec, `https://api.openprovider.eu/v1` [6] | REST/JSON v6 [9] | REST/JSON, **beta since 15 Apr 2026** [7] | REST/JSON [12] |
| Auth | username + password of an API contact → Bearer token, 48 h [6] | RSA-signed request → Bearer [9] | API token | API key [12] |
| IP allowlist | optional; empty = any IP [10] (a Worker has no fixed IP) | optional (`global_key`) [9] | none | NC |
| DNS for the domain | `POST /dns/zones`, records add/replace | yes | through Cloudflare DNS | yes (NC detail) |
| Transfer code | `GET /domains/{id}/authcode`, `.../authcode/reset` [11] | `GET /domains/{d}/auth-code` | **not in the API yet** [7] | NC |
| Auto-renew per domain | `autorenew: on/off/default` on `PUT /domains/{id}` [11] | no toggle found; cancel at end of term | not in the API yet | NC |
| Sandbox | yes: https://cp.sandbox.openprovider.nl/signup, API `http://api.sandbox.openprovider.nl:8480/v1beta` [13] | demo token or `test=1` | none | OT&E (URL NC) |
| Billing | **prepaid balance**, min. top-up 20; card, iDEAL, PayPal [14] | invoice per order | card on file | NC |
| Contract | company details at sign-up; sign the registry contracts under Account → Contracts [6b] | any account [5] | Domain Registration Agreement | partner agreement |

**Cloudflare Registrar is out**: its API only registers into the caller's own account (a version that platforms can resell is announced, not live), and .nl and .eu are not on its TLD list at all [7][8].

**Recommendation: Openprovider.**
- It fits a Cloudflare Worker: plain REST/JSON, a Bearer token, no IP allowlist required.
- Every operation Vidalo needs is in the API: check, register with the customer as holder, a DNS zone with one CNAME, the transfer code, auto-renew per domain.
- Cheapest at scale (members pay registry cost price), and the prepaid balance is a hard spending ceiling.
- Dutch, large on .nl, with a real sandbox.

TransIP is the fallback: also REST, but RSA signing, retail renewals (€16.50 .nl, €27.99 .com) and no auto-renew toggle. Realtime Register looks credible, but prices and the test environment sit behind a partner agreement.

### SIDN rules that shape the design (.nl)
- **The customer is the holder.** SIDN's registrant terms (1 Oct 2023, art. 1.2) forbid registering a .nl domain in a third party's name, a reseller included, except while the name is not active in DNS [15]. Vidalo is never the registrant.
- **Correct holder data.** Complete and correct, changes through the registrar (art. 11); wrong data can cost the registration [15]. Hence the holder form on `/app/domein`.
- **Transfer code within five days.** The current registrar hands the token over within five days of the holder asking; SIDN steps in otherwise [16]. Vidalo mails it at once on request.
- **No SIDN registrar status needed** when going through a reseller [1b].

## 2. Price and billing

| | |
|---|---|
| Price | **€25 per year excl. btw** (€30.25 incl. 21%), the same for .nl, .com and .eu. `PRICES.domainEurPerYear` in `packages/core/src/copy/index.ts`, read by `core/billing/domain.ts` and checked against `stripe:setup` by `test/domain.test.ts` |
| Cost to Vidalo | .nl about €4.38 (SIDN) plus Openprovider's member margin (NC); .com about $11.17; .eu NC; Basic S membership $4.16/month; Stripe about €0.30–0.75 per payment. Margin per domain €12–19 a year before support time |
| Display | Vidalo sells to businesses only, so prices are excl. btw like everything else; the domain page shows the amount incl. btw next to it. Two readings of the brief ("incl. for consumers, excl. for B2B"): Vidalo has no consumer checkout, so the excl. price leads and the incl. price is shown alongside |
| Stripe | its own **yearly subscription** (price `vidalo_domain_eur_25_year`, product "Vidalo Domein", `STRIPE_PRICE_DOMAIN`), separate from Vidalo Monthly: either can end without the other. Metadata `plan: "domain"`, `domain`, `businessId` on the session and the subscription |
| Who may buy | a proven owner (`ownerVerifiedAt`) of a paying business (trial/active) whose facts page is not already live on their own domain (`domainBuyRefusal`) |

**Who owns the domain: the owner's business, as registrant.** Vidalo is the reseller and the technical and billing contact (`OPENPROVIDER_TECH_HANDLE`); the business is holder and administrative contact. Why:
- SIDN requires it for .nl (above), and it is the honest default for .com/.eu.
- The owner can leave Vidalo without losing the name: the transfer code is theirs to ask for.
- Vidalo as tech contact is enough to set DNS and renew; holding the domain ourselves would make every churn a dispute.

**Renewal, non-payment, cancellation** (`core/billing/domain.ts`, webhook in `core/billing/index.ts`):
- Registered with auto-renew **on** at the registrar. Stripe charges the year on the subscription's anniversary; `invoice.paid` (`subscription_cycle`) moves `expiresAt` a year on.
- **Reminder 30 days before** each renewal, with the price and how to stop (cron step 10, `dueDomainReminder`, mail `domain_renewal`).
- **Renewal not paid** (`invoice.payment_failed`): auto-renew goes **off** at the registrar (job `domain_autorenew`) and the owner gets one mail (`domain_payment_failed`). Stripe's Smart Retries keep trying; paying turns auto-renew back on. Unpaid by the expiry date: the domain runs out (for .nl, SIDN's quarantine lets the holder restore it through a registrar for a while).
- **Not renewing** ("Niet verlengen" on `/app/domein`): cancel at period end at Stripe, auto-renew off, mail `domain_cancelled`. "Toch verlengen" undoes it until the end date. When Stripe ends the subscription (`customer.subscription.deleted`): status `ended`, mail `domain_ended`. The domain stays the holder's until it expires.
- **Transfer out**: "Mail me de verhuiscode" mails the code to the owner's address on record; it is never shown on the page or logged.
- The business's own status never changes because of the add-on, and Vidalo Monthly ending leaves the domain running.
- "Verwijder alles" on the account page waits until the add-on is stopped, like the subscription.

**Refunds.** A registered domain is not refundable: the registry charges for the year the moment it registers. This is said on the page before the form, again in Stripe Checkout above the pay button, ticked by the owner (terms article 19), and stored (`acceptedAt`, `termsConsent` on `domain.paid`). If the registrar refuses, nothing is registered and support refunds the whole amount (see "When it goes wrong").

## 3. How it works

```
/app/domein (RegisterDomain.tsx)
  suggestDomains(name, place) → registrar.check([...])      free? price, holder, refund, terms box
  POST /api/domain/checkout   → checks again, stores domainRegistration {status: checkout}
                              → Stripe Checkout, mode subscription, yearly price
Stripe webhook                → core/billing: plan "domain" → status paid, job domain_register
worker domain_register        → core/registrar/flow.ts runDomainRegistration
                                 holder handle → register (1 year, auto-renew on) → feiten.{name} CNAME → registered
                                 → mail domain_registered → re-queued every 10 min until feiten.{name} answers
                                 → facts host moves (verified, publish) → live
```

| Piece | Where |
|---|---|
| Interface, mock, Openprovider | `packages/core/src/registrar/` (`types.ts`, `mock.ts`, `openprovider.ts`, `current.ts` picks one: mock with `VIDALO_MOCK=1`, Openprovider when `OPENPROVIDER_*` is set, otherwise none and option B says it is not available) |
| Names, holder form | `registrar/names.ts`, `registrar/holder.ts` |
| Job logic | `registrar/flow.ts`; handlers `apps/worker/src/jobs/domain.ts` |
| Price, rules, webhook | `billing/domain.ts`, `billing/index.ts` (`isDomainObject`, `applyDomain`) |
| Storage | `business.domain_registration` jsonb, migration `0015_domain_registration.sql` |
| Mails | `reporter/domain-mails.ts`, words in `copy.mails.domain` (NL + EN, the owner's language) |
| Page | `apps/web/app/app/domein/RegisterDomain.tsx`, actions in `apps/web/app/app/actions.ts` |
| Tests | `packages/core/test/domain.test.ts`, `pnpm e2e:mock` ("domain add-on"), `pnpm mail:lab` (the seven domain mails + the support note) |

A retry never registers twice: the holder handle and the registrar's id are saved before the next step. The current facts host keeps serving until `feiten.{name}` answers, so nothing is offline in between.

Mock mode: a label containing `bezet` or `taken` is not free; `weiger` makes the registration refuse (to see the failure path).

## 4. When it goes wrong (support)

Each case reaches support@vidalo.io as a mail and an `operator_task` event:

| `reason` | What happened | What to do |
|---|---|---|
| `domain_register_refused` | Openprovider said no (data refused, name taken meanwhile, balance empty) | Refund the Stripe payment in full and cancel the domain subscription (Dashboard → Customers → the business → subscription "Domein …" → Cancel; Payments → Refund). Contact the owner about another name |
| `domain_register_stuck` | five attempts failed for a transient reason; status stays `paid` | Check Openprovider's status and our balance, then queue `domain_register` with `{ "businessId": "…" }` again |
| `domain_not_live` | registered, but `feiten.{name}` does not answer after 12 hours | Check the DNS zone in Openprovider's panel (record `feiten` CNAME → `feiten.vidalo.io`) and the Cloudflare custom hostname |
| `domain_paid_unmatched` | a paid session for a name that is not the one on file | Look at both; refund the one that should not exist |

## 5. Julian: accounts and secrets

Nothing below is created yet. Sandbox first, then production.

**Openprovider sandbox**
1. Open https://cp.sandbox.openprovider.nl/signup and sign up as A101 B.V. (KvK `42057858`, btw `NL869514192B01`, mail `support@vidalo.io`).
2. In the panel: Account overview → Contact persons → Add contact person. Name it `vidalo-api`. Open its **API** tab and click **Enable API access**. Leave **API access restrictions** empty (a Worker has no fixed IP).
3. Put in the root `.env` (gitignored), for a local run:
   ```
   OPENPROVIDER_API_URL=http://api.sandbox.openprovider.nl:8480/v1beta
   OPENPROVIDER_USERNAME=<the vidalo-api username>
   OPENPROVIDER_PASSWORD=<its password>
   OPENPROVIDER_TECH_HANDLE=<A101's own customer handle, Customers → A101 B.V., looks like AB123456-NL>
   ```
   The sandbox is plain http on port 8480; test it from local Node (`VIDALO_MOCK` unset), not from a Worker (NC whether a Worker reaches that port).

**Openprovider production**
1. https://cp.openprovider.eu/signup, same company details.
2. Account → Contracts: sign the **.nl (SIDN)** and **.eu** contracts.
3. Choose membership **Basic S** and top up the balance (minimum 20, iDEAL). Leave auto top-up off until a ceiling is decided.
4. Create the `vidalo-api` contact person as in the sandbox, step 2.
5. Push the secrets (names and targets are in `secrets.manifest.json`):
   ```bash
   cd /Users/a101/Vidalo && pnpm secrets:push --apply --only OPENPROVIDER_USERNAME,OPENPROVIDER_PASSWORD,OPENPROVIDER_TECH_HANDLE
   ```
   `OPENPROVIDER_API_URL` stays unset in production (it defaults to `https://api.openprovider.eu/v1`; a sandbox value is refused by `secrets:push`).

**Stripe**
1. Sandbox: `pnpm stripe:setup --apply` (as in `docs/setup/stripe-and-resend.md` §7) now also creates "Vidalo Domein", €25/year, and prints `STRIPE_PRICE_DOMAIN=price_…`. Put it in `.env` and push it to `vidalo-web`:
   ```bash
   cd /Users/a101/Vidalo && pnpm secrets:push --apply --only STRIPE_PRICE_DOMAIN
   ```
2. Live: the same with `--apply --live` when the live account is set up (go-live B2). The webhook needs no new events.

## 6. Not verified

- No call has been made to Openprovider, sandbox or live: the adapter follows the published OpenAPI spec (`developer.openprovider.com/data/swagger.spec.js`, read 9 Nov 2026), but field details (phone split, `.nl` holder rules, the DNS `replace` on an existing zone, `expiration_date` format) need one sandbox run.
- Openprovider's .nl and .eu member prices (behind login).
- A real Stripe test checkout of the add-on and the webhook round trip on the sandbox account.
- Whether Openprovider's own `.nl` registration needs extra data for a business without a KvK number.

## Sources (seen 9 Nov 2026)
[1] https://www.sidn.nl/en/our-prices · [1b] https://www.sidn.nl/en/nl-domain-name/becoming-a-registrar
[2] https://www.openprovider.com/nl/membership-plannen
[3] https://www.openprovider.com/blog/com-domain-renewal-price-openprovider
[4] https://www.transip.nl/domeinnaam/
[5] https://transip.co.uk/knowledgebase/1812-can-i-become-a-reseller
[6] https://developer.openprovider.com/ · [6b] https://developer.openprovider.com/api-keys.html, https://openprovider.help/books/api-integrations/page/getting-started-with-openprovider-api
[7] https://blog.cloudflare.com/registrar-api-beta · https://developers.cloudflare.com/registrar/registrar-api/
[8] https://www.cloudflare.com/tld-policies/
[9] https://api.transip.nl/rest/docs.html
[10] https://support.openprovider.eu/hc/en-us/articles/360015453220-How-to-enable-API-access
[11] https://support.openprovider.eu/hc/en-us/articles/360024780654, https://support.openprovider.eu/hc/en-us/articles/360025249113
[12] https://kb.realtimeregister.com/article/144-access-and-authentication
[13] https://support.openprovider.eu/hc/en-us/articles/8095671860114
[14] https://www.openprovider.com/blog/prepaid-system, https://support.openprovider.eu/hc/en-us/articles/216644258
[15] https://www.sidn.nl/en/nl-domain-name/general-terms-and-conditions-for-nl-registrants
[16] https://www.sidn.nl/en/nl-domain-name/transferring-your-domain-name
