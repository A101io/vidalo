# Security review — round 1 — 003 ACM rules on the site

*security · 2026-11-17 (unattended verify run) · `ead862e` (PR #136) · against `checklists/security.md` (SEC-01…17). "Observed" means run in this container tonight; "read" means read in the code at this commit.*

## Verdict for this lane
No P0, no P1. Both P0-if-observed items of the build (SEC-10 / F-009, SEC-11 / F-020) were tried on a real route against Postgres and were refused. One P2 confirmed (F-022), one P2 pre-existing found (F-023), one P3 (F-027).

## Items

| ID | Result | Evidence |
|---|---|---|
| SEC-01 order mail only from the verified webhook or the mock branch | **pass** | grep of callers: `queueOrderConfirmation` only in `billing/index.ts:164`, the mock branch of `route.ts:94` (after `!stripe`, which outside mock now returns early), `scripts/mail-lab.mts`, tests; `sendOrderConfirmation` only in `apps/worker/src/jobs/misc.ts:90` and tests. Observed: three `/welkom` replays (`session_id=cs_test_…`, `mock=1`, `/en/welcome?session_id=mock_…`) on a non-mock server: events 4 → 4, jobs 0 → 0 |
| SEC-02 recipient from the event, validated, injection refused | **pass** (no test pins it: F-027) | Observed in a throwaway test (not committed): `"a@b.nl\r\nBcc: x@y.nl"`, `"a@b.nl, x@y.nl"`, `"a@b.nl\nx@y.nl"`, `"a@b.nl;x@y.nl"` → `no_address`, 0 jobs. `"<a@b.nl>"` → `queued` (normalised to one address; no injection). Read: `deliverTo` passes `job.to` unchanged, never `ownerEmail` |
| SEC-03 one mail per session | **pass** | `billing.test.ts` and `order-mail.test.ts` rows green; observed: replay of the same event → `duplicate`, 1 job |
| SEC-04 amounts from Stripe, split only when it adds up | **pass** | read `order-mail.ts` (amounts from the session; `cents()` rejects non-numbers); `order_mail.amount_mismatch` test green; the mock path's amounts come from `mockCheckoutSession` only, no form field read |
| SEC-05 no bearer token in the mail | **pass** | observed: six mails (3 plans × NL/EN) rendered with session ids `cs_test_abc…`; grep of the `.eml` files for `cs_test`, `session_id`, `stripe.com`, `/auth/`: 0 hits. Event payload carries the session id (internal, not mailed) |
| SEC-06 escaping | **pass** | template test green; mail lab hostile business produces `order_confirmation`, 0 problems |
| SEC-07 no address in BE-02's own logs/events | **pass**, with F-022 | observed: `order_confirmation.queued` log and event, `email.order_confirmation` event (`to:"payer"`) carry no address. The shared `mail.sent` / `mail.mock` line (`reporter/mail.ts:96`, `:107`) logs `to` for every mail (F-022, P2 confirmed) |
| SEC-08 required, no unsubscribe, no sales block | **pass** | `REQUIRED_MAIL_KINDS` contains it; lab rule `order mail carries List-Unsubscribe` exists (`mail-lab.mts:323`) and is green; mail read: no button, no offer |
| SEC-09 failure leaves no half-state | **pass** | observed in the throwaway test: `enqueueJob` throws → `handleStripeEvent` rejects, no `stripe.event` logged; retry → `activated`, third call `duplicate`, exactly 1 email job. Read: a failure between `enqueueJob` and the `order_confirmation.queued` event would queue twice on retry; the send-side dedupe stops the second send when the jobs run one after the other. Not a finding (window is one statement, outcome is at worst two identical receipts) |
| SEC-10 no Stripe key outside mock → refuse (F-009) | **pass, observed** | `POST /api/checkout` with `plan=setup` and `plan=monitor`, `mock:false`, no key: `303 ?betaling=fout`, `checkout.refused {reason:"no_stripe"}`, status unchanged, 0 jobs. Note: `env.mock` is also true when `DATABASE_URL` is empty; the Worker sets it from Hyperdrive (CLAUDE.md), and without it the data is an in-memory store, so nothing persists. No finding |
| SEC-11 add-on only with a running Scan (F-020) | **pass, observed** | verified owner, `none/scanned`, `plan=monitor_addon`: `303 /app/abonnement`, `checkout.refused {reason:"addon_without_scan"}`, no Stripe call reached. Control `setup/active` passes this check |
| SEC-12 consent required, B2B text | **pass** | `checkout-consent.test.ts` green; read `route.ts` |
| SEC-13 no new host, script, cookie, storage | **pass** | added URLs in the diff: only `https://vidalo.ai` in tests and lab fixtures; `legal.lock.json` not in the diff; `legal.test.ts` green |
| SEC-14 `COMPANY` public data only | **pass** | read: legal name, trade name, business address, KvK, btw |
| SEC-15 static reminder sentence and complaint text | **pass** | read: copy strings with a static privacy link, no interpolation of input |
| SEC-16 source-reading tests stay in the repo, offline | **pass** | read: `readFileSync` under `join(__dirname, "../../..")`; no `fetch` |
| SEC-17 no control/bidi/zero-width characters | **pass** | grep over every changed file: 0 hits |

## Pre-existing, found while reading a file this feature edits
- **F-023 (P2)**: `activate()` logs `checkout.completed` with `email` (`billing/index.ts`, last line of `activate`). Not introduced by 003; the event log is exported to the owner (`my-data.ts`), and COMP-38 / SEC-07 ask for no address in events. Fix: drop the field or log `emailChanged: boolean` (10 min).

## Out of scope, noted only
- Every `next dev` start in this container printed a Next.js notice about a security advisory for the installed version. Not checked tonight, not part of this diff, nothing changed. Julian may want a separate look.

## Findings (security lane, ordered)
1. F-022 P2 — shared `mail.sent` / `mail.mock` log lines carry the recipient (confirmed; all mail kinds).
2. F-023 P2 — `checkout.completed` event carries the buyer's address (pre-existing).
3. F-027 P3 — SEC-02's injection cases are not pinned by a test (behaviour correct tonight).
