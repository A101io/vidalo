# ADR-0008 — The order confirmation is its own mail, queued by the payment webhook for every plan

*2026-11-15 · status: accepted (architect, feature 003; folds F-001)*

## Context
ACM row R9 asks for a written confirmation on a durable medium right after payment, carrying
the order, the price, the terms and the company details. Between businesses art. 6:227c BW
still asks that receipt of an electronic order is confirmed without delay, unless the parties
agreed otherwise; Vidalo's terms do not. The brief (AC-14) put the order block in the welcome
mail. The welcome mail is the last step of the `setup` job (`apps/worker/src/jobs/setup.ts:48`),
and `setup` is a paid-only job that also waits for proven ownership
(`apps/worker/src/jobs/paid.ts:15`, `:65`). A buyer who has not connected Google gets no welcome
mail, possibly ever; a Monthly added later (`monitor_addon`) returns before `setup` is queued
(`packages/core/src/billing/index.ts:105-108`). Stripe can send its own receipt, but that is a
dashboard setting outside the repo, in Stripe's words, without the terms link or our renewal
terms.

## Decision
A separate mail kind, `order_confirmation`, is queued by `core/billing` when
`checkout.session.completed` arrives, for `setup`, `monitor` and `monitor_addon`, paid or still
processing, once per Checkout session id. It goes to the payer's address from the verified
event, is a required mail (no preference or unsubscribe stops it), and carries no marketing.
The amounts are the ones Stripe charged; the per-line split comes from `PRICES` and is shown
only when it adds up to Stripe's subtotal. The welcome mail stays as it is and remains the
set-up guide.

## Consequences
**Good:** the confirmation follows the order, not the set-up, for every plan; one place states
what was bought and on which terms; the mail lab and a unit test see it.
**Bad:** a buyer gets two mails within minutes (order, later welcome); the mail repeats terms
(start after proof, cancel any month) that must now change together with the terms.
**We can no longer:** add a checkout path that skips `queueOrderConfirmation` without the
billing test going red.

## Alternatives rejected
| Option | Why not |
|---|---|
| Order block inside `welcomeEmail` | Arrives only after ownership proof; never for an add-on |
| Send the welcome mail at payment and the set-up steps later | Changes the welcome mail's job and timing for every customer; larger than this feature |
| Rely on Stripe's receipt | Not in the repo, not testable, no terms link or renewal terms, can be switched off in a dashboard |
| Send from the `/welkom` success page | A page load is not proof of payment; a replayed URL would send mail (security SEC-01) |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
