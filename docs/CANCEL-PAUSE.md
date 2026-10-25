# Cancel and pause

How an owner ends or pauses the monthly plan ("Goed houden", €49 per month), why it works this way, and what still needs counsel. Built 25 Oct 2026 (`packages/core/src/billing/lifecycle.ts`, `apps/web/app/app/abonnement/`, migration `0010_cancel_pause.sql`). Not legal advice.

## The flow

| Step | Where | What happens |
|---|---|---|
| Find it | `/app/abonnement`, section "Pauzeren of opzeggen" | Two plain buttons, one click from the account menu. Shown only for the monthly plan; "Goed zetten" was paid once and has nothing to end |
| Cancel | `/app/abonnement/opzeggen` | One page, one button "Zeg op per <date>". It says the end date, what stops, what stays, that it can be undone. A reason is asked, never required. The pause is offered once, as a plain link |
| At Stripe | `cancel_at_period_end: true`, reason in `cancellation_details` | The paid period runs out; nothing more is charged; no refund of the running period (none is owed: the service runs until the end) |
| Confirmation | mail `cancel_confirmed`, straight away | What was cancelled, the end date, what stops, what stays (facts page redirect, corrections at third parties, invoices, the free check after 90 days, retention), how to undo |
| Undo | "Toch doorgaan" on `/app/abonnement` until the end date | Stripe clears the cancel; mail `cancel_undone` |
| End | Stripe `customer.subscription.deleted` → `churned` | The worker closes it two days after the end date if that event never came (mock mode, a lost webhook) |
| Pause | `/app/abonnement/pauzeren` | 1, 2 or 3 months, the end date shown per option. Stripe `pause_collection` with `behavior: "void"` and `resumes_at`: invoices in the pause are voided, nothing is owed |
| During a pause | worker | No monthly check, no fixes, rechecks, syncs or publishing (`paidOnlyBlock`, `businessesDueForMonthlyScan`). The facts page stays online. Status stays `trial`/`active`; `paused` keeps meaning "payment failed", so the 60-day churn rule never touches an owner's pause |
| Confirmations | `pause_confirmed` straight away, `pause_ending` 7 days before, `pause_ended` on the day (cron, once each) | Each says the date and how to resume early or cancel |
| Resume early | "Nu hervatten" | Stripe clears `pause_collection`; mail `pause_ended` |
| Cancel while paused | allowed | Ends at the end of the current period |
| Failed payment (`paused`) | cancel allowed, pause not | A pause is not a way around a failed payment |
| Stripe portal | invoices and payment method only | Cancelling was switched off there (`stripe-setup.mjs`), so every cancel goes through the flow above and gets its confirmation |

All confirmations are service mails: they go out whatever the owner's mail preferences say (PR #61 treats every kind it does not list as optional as required). They are in the owner's language (NL/EN) and reply to support@.

## The rules it follows

Vidalo sells only to businesses (B2B confirmation at checkout, terms for businesses). Most consumer rules below do not bind it; the flow meets them anyway, because a small business owner experiences it like a consumer and the cost of meeting them is nil.

| Rule | Source | How the flow meets it |
|---|---|---|
| Taken out online, cancelled online; easy to find; no obstacles (no phone call, no repeated clicking) | ACM, "Online afgesloten abonnement moet je online kunnen opzeggen" | Two clicks from the account; one confirming button; reason optional; the retention offer (pause) shown once as a link, not as a step |
| Information about how to end the contract, before and during it | ACM checklist online verkoop (R8/R9); Checklist Informatieverplichtingen | Terms article "Opzeggen" and "Pauzeren", the FAQ, the page itself, every confirmation mail |
| Written confirmation on a durable medium | ACM checklist (R9), PRODUCT.md §8 | A mail right after each change, with company details in the footer |
| No dark patterns: declining as easy as accepting, no confirmshaming, no pre-ticked choices | ACM guidance on online influence (R7); DSA art. 25 and the UCP directive for consumers | Neutral wording; nothing pre-selected except the shortest pause; no "are you sure you want to lose..." |
| Withdrawal button (14-day withdrawal right) | Directive (EU) 2023/2673, new art. 6:230oa BW, from 19 June 2026 | Applies to consumer contracts with a withdrawal right; Vidalo's contracts are B2B. If Vidalo ever sells to consumers, this is a separate button, not this flow |
| Retention after the end matches the privacy statement | AVG art. 5(1)(e), privacy text "Hoe lang" | The cancel page and mail repeat it: data kept 90 days, one free check, then only invoices (fiscal retention 7 years) |

## For counsel (De Boer), before launch

1. The terms gain an article "Pauzeren" (NL + EN draft in `copy.legal.terms`) and "Opzeggen" now mentions the confirmation and the undo. Both are drafts like the rest of the terms.
2. Is a pause of up to 3 months, resuming by itself at the regular price, acceptable as written? The reminder a week before is our choice, not a known requirement.
3. Confirm that no refund of the running period is owed on cancellation (the service runs until the end date).
4. Confirm the B2B position: the withdrawal button of art. 6:230oa BW does not apply as long as checkout refuses consumers.

## Verified (25 Oct 2026)

- Unit tests (`packages/core/test/cancel-pause.test.ts`): who may do what, pause dates (month ends), cancel/undo/pause/resume against a Stripe stand-in, the reason without the comment in the event, the monthly check skipping a paused business, the reminder and end mail once each, the webhook echo of `cancel_at_period_end` and `pause_collection`, every mail in both languages.
- Worker tests: paid jobs skipped during a pause and running after it; the cron's reminder, end and close-after-end.
- Database: the two columns round-trip on MemDb and PgDb (`verify:pg`, migration 0010 applied to a fresh Postgres).
- Browser, mock mode, as the demo owner: pause 2 months → "Gepauzeerd tot 25 december 2026" → resume → cancel with a reason → "Opgezegd per 24 november 2026" → undo; each step wrote its confirmation mail.

Not verified: the Stripe calls against a real (test-mode) subscription, which needs the Stripe test key; the English pages in the browser; migration 0010 on the hosted project.
