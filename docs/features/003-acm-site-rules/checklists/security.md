# Security checklist — 003 ACM rules on the site

*security · phase 1 (shape) · 2026-11-15 · written against `02-architecture.md` (contract 003.1,
Amendment 1), ADR-0008, ADR-0009, tickets BE-01…BE-03, FE-01, FE-02, the standing lists
`docs/process/checklists/security.md` and `_OS/playbook/templates/pipeline/checklists/security.md`.
Code read to confirm claims: `apps/web/app/api/checkout/route.ts`, `apps/web/lib/{stripe,env}.ts`,
`packages/core/src/billing/index.ts`, `reporter/{index,templates,layout}.ts`,
`shared/{mail-prefs,contact,own}.ts`, `apps/worker/src/jobs/{setup,paid,misc,types}.ts`,
`apps/worker/src/cron.ts`, `apps/web/app/app/abonnement/page.tsx`, `scripts/mail-lab.mts`.*

This is the list phase 4 verifies, item by item, with evidence. "P0 if observed" marks an item
whose failure has a named victim and a path to them, so the foreseeability cap does not apply.

## P0 against the design

**None.** The feature adds no route, no table, no outside host and no stored data. The one new
moving part, the order mail, is triggered only by a Stripe-signed event and addressed only from
it. Two pre-existing defects in a file this feature edits were found and are folded into BE-02
(F-009 no-key checkout, F-020 add-on without a Scan); both are P0 if observed in phase 4 on the
production configuration, because each hands out or takes money without the service behind it.

## The order mail (BE-02)

| ID | What must be true | How it is checked | Sev if it fails |
|---|---|---|---|
| SEC-01 | An order mail is queued only from `billing.apply` on a signature-verified `checkout.session.completed`, or from the checkout route when `env.mock` is true. No page, GET, form field or success URL (`/welkom?session_id=…`) can queue or send one | grep for callers of `queueOrderConfirmation` and `sendOrderConfirmation`: exactly `billing/index.ts`, the mock branch of `route.ts`, the worker `email` handler, tests; replaying `/welkom?session_id=…` in mock mode queues nothing (events before = after) | **P0 if observed** (an unauthenticated way to send branded mail to any address) |
| SEC-02 | The recipient is `customer_details.email` from that event (or the mock session in mock mode), validated by `parseFreeCheckRequest`; never `business.ownerEmail` swapped in silently, never a request parameter; CR/LF or a second address in it is refused | unit: session with `"a@b.nl\r\nBcc: x@y.nl"` and `"a@b.nl, x@y.nl"` → `no_address`, no job; `deliverTo` receives the job's `to` unchanged | **P0 if observed** (header injection or attacker-chosen recipient) |
| SEC-03 | One mail per Checkout session: `order_confirmation.queued` dedupe at queue time, `email.order_confirmation` dedupe at send time; `async_payment_succeeded` does not queue | `billing.test.ts` rows (paid; processing → succeeded; replayed event); the job handler run twice → one `sendMail` call | P1 |
| SEC-04 | Amounts are Stripe's integers in minor units from the event (`amount_subtotal`, `total_details.amount_tax`, `amount_total`); the per-line split comes from `PRICES` and appears only when it sums to the subtotal; nothing from the browser reaches the mail | `order-mail.test.ts` with a session whose subtotal ≠ `PRICES` → no lines, `order_mail.amount_mismatch` event; grep the mock path: amounts from `mockCheckoutSession` only | P1 (**P0 if observed** that a client-supplied value reaches an amount) |
| SEC-05 | The mail carries no bearer token: no Checkout session id (`cs_…`, which `claimBusiness` accepts as proof of payment, `apps/web/lib/stripe.ts:19-26`), no `session_id=` URL, no Stripe hosted invoice or receipt URL, no sign-in link | `order-mail.test.ts` asserts none of `cs_`, `session_id`, `invoice.stripe.com`, `pay.stripe.com`, `/auth/` in text and HTML; mail lab grep of the rendered files | **P0 if observed** (a forwarded mail becomes a claim on the business, standing item "proof of payment that grants access") |
| SEC-06 | The business name and every interpolated value are escaped in the HTML part (`renderMail` escapes; the template adds no raw HTML) | mail lab `HOSTILE` journey produces an order mail; the S-34 check (`mail-lab.mts`, hostile name) passes for kind `order_confirmation` | P1 |
| SEC-07 | No address in logs or events: `order_confirmation.queued`, `order_mail.no_address`, `order_mail.amount_mismatch`, `email.order_confirmation` carry ids and counts only; the job payload holds the address (the `job` table has no policies, like every mail job) | grep test output and the lab's event dump for `@`; read the four payloads in code | P1 |
| SEC-08 | `order_confirmation` is in `REQUIRED_MAIL_KINDS` and not in `OPTIONAL_MAIL_KINDS`; it has no `List-Unsubscribe`, no marketing block, no CTA to buy | `mail-prefs.test.ts` row; mail lab rule (no `List-Unsubscribe` for this kind); read the template | P2 (a required mail that carries marketing would be an abuse of "required"; P1 if a sales block appears) |
| SEC-09 | A failed send does not leave a half-state: the job fails and retries; the queue event is written in the same handler run as the enqueue; an exception in `queueOrderConfirmation` makes the webhook answer 500 (Stripe retries) without having marked the event `seen` | `billing.test.ts`: `enqueueJob` throws → handler throws, `stripe.event` not logged; retry → one job | P1 |

## The checkout route (BE-02, BE-03)

| ID | What must be true | How it is checked | Sev if it fails |
|---|---|---|---|
| SEC-10 | With no Stripe key and `VIDALO_MOCK` unset, `POST /api/checkout` refuses (`?betaling=fout`, `checkout.refused {reason:"no_stripe"}`), changes no status and queues no job. Today it sets `trial` and queues `setup` (`route.ts:67-77`; `getStripe()` is null whenever `STRIPE_SECRET_KEY` is absent, `lib/stripe.ts:14`, `env.ts:97`) — F-009 | `checkout-consent.test.ts` source assertion that the branch tests `env.mock`; a route run with no key and no mock flag → 303 to `?betaling=fout`, business status unchanged | **P0 if observed** on the production config (a free plan for anyone who posts the form) |
| SEC-11 | `monitor_addon` is accepted only for a verified member of a business with `plan === "setup"` and status `trial` or `active`, as the page's `canAdd` (`app/app/abonnement/page.tsx:44`). Today the route checks only verified ownership (`route.ts:52-55`); `activate` then returns early for an add-on (`billing/index.ts:105-108`) and the business keeps a status in which every paid job is skipped (`jobs/paid.ts:34-47`) — the buyer pays €49 a month for nothing — F-020 | route run: verified owner, `plan: "none"`, `status: "scanned"`, `plan=monitor_addon` → refused, no Stripe session created | **P0 if observed** (a customer charged monthly with no service) |
| SEC-12 | `consent_collection.terms_of_service` stays `"required"` and `custom_text` keeps the B2B sentences (`route.ts:121-125`) | `checkout-consent.test.ts` with its control | P1 |
| SEC-13 | No new outside host, script, cookie or browser storage; CSP unchanged; `legal.test.ts` recipient and cookie scans green unchanged | `legal.test.ts` green with `legal.lock.json` unchanged; `git diff` shows no new host in `apps/web` | P1 |

## Copy, pages and tests (BE-01, FE-01, FE-02)

| ID | What must be true | How it is checked | Sev if it fails |
|---|---|---|---|
| SEC-14 | `COMPANY` and `footer.legal` hold public company data only; no personal phone, no private address, no internal id | read `contact.ts` diff | P2 |
| SEC-15 | The reminder sentence's privacy link and the contact complaint text are static: no user input is interpolated into them; the e2e checks run on mock data | read FE-02 diff | P2 |
| SEC-16 | The source-reading tests (`no-preticked-boxes`, `checkout-consent`, `copy-claims`) read only files inside the repo, resolve paths under the repo root, and make no network call | read the tests; they run offline in CI | P2 |
| SEC-17 | No literal control, bidi or zero-width character in any changed file (the `·` separators are U+00B7, allowed) | `grep -rP '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x{200b}-\x{200f}\x{202a}-\x{202e}\x{2066}-\x{2069}\x{feff}]'` over the diff | P2 |

## Not in scope (looked at, nothing to check)
- Authentication, sessions, RLS: untouched.
- The Stripe webhook route's signature check: untouched; SEC-01 relies on it as it is.
- The `/welkom` page: untouched; SEC-01 asserts it gains no mail path.
