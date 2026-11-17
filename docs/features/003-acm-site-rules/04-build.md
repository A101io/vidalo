# Build log — 003 ACM rules on the site

*Unattended build runs. Night 1, 2026-11-16: BE-01, FE-01, FE-02, BE-03. Night 2, 2026-11-17: BE-02 (section at the end).*

Every claim below was observed in this run. "Red" means the test failed on the old string
or code put back; "green" means it passed again with the change.

## BE-01 — Copy keys, one company source, the claims test

Built: `COMPANY` in `core/shared/contact.ts`; every key of `02-architecture.md` §5 in
`copy/index.ts` and `copy/en.ts` (incl. `mails.order`, used by BE-02); `PRICES` moved to
`copy/prices.ts` and re-exported from `copy/index.ts` (so EN can build strings from it
without an import cycle: `index.ts` imports `en.ts`); `packages/core/test/copy-claims.test.ts`.

| Claim | Evidence |
|---|---|
| Rule 1, no popularity claim | old chip `Meest gekozen` put back: red (`['nl:landing.prijs.monitor.chip']`), green with the new chip |
| Rule 2, "10.000 bedrijven" names its country | `10.000 bedrijven klopte` put back in `snippers.body`: red (`['nl:landing.snippers.body']`) |
| Rule 3, €49 per month names the €149 | the old `dashboard.scanOnly.bodyNone` (no €149) put back: red (1 hit) |
| Rule 4, company line complete | footer without ` · btw ${COMPANY.vat}`: red (`footer.legal lacks NL869514192B01`) |
| Rule 5, gratis/free list | the word `gratis` added to the new chip: red (snapshot differs); the snapshot holds 71 key paths, NL and EN, for Julian to read once |
| `legal.lock.json` unchanged | nothing under `copy.legal` edited; `legal.test.ts` green; `git status` shows no change to `copy/legal.lock.json` |
| Gate | `pnpm -r typecheck` green; core 94 files, 1425 passed / 23 skipped; worker 7 files, 52 passed; `pnpm e2e:mock` OK |

Deviations from the ticket text, for the PR reader:
- The complaint and order-mail strings use `CONTACT.support` and `CONTACT.phone` (so `support@vidalo.ai`), not the `support@vidalo.io` the architecture table still shows; the repo moved to vidalo.ai on 15 Nov (CLAUDE.md). FE-01's e2e therefore expects `CONTACT.email`, not `hello@vidalo.io`.
- `mails.order.termsMonthly` EN says ‘Subscription’ (the real EN name of the page, `billing.h1`), the architecture draft said ‘Plan’.
- The ticket's control for rule 3 ("the old `monitor.limit`") would not go red: the old limit already contained €149. The old `bodyNone` is the real old string that does.

## FE-01 — Company details on every page and on /contact

Built: complaint heading and paragraph on `/contact` (`apps/web/app/contact/page.tsx`, h2.h3 + paragraph, no new button or colour); `e2e/company-details.spec.ts`. The footer needed no code change: the BE-01 copy flows through `SiteFooter` and `ComingSoonFooter`.

| Claim | Evidence |
|---|---|
| Spec fails without the change | with `main`'s copy and contact page put back: 8 of 9 desktop tests red (6 footer pages, 2 complaint pages); the 375 px test passes there too, as it guards against widening |
| Spec passes with it | normal mode, desktop: 9 passed; `E2E_MODE=gate`: 3 passed (`/binnenkort`, `/en/coming-soon` footer fields and contact details, 375 px) |
| axe still green | `e2e/a11y.spec.ts`: 12 passed |

Deviations: the spec expects `CONTACT.email` (`hello@vidalo.ai`) where the ticket says `hello@vidalo.io`; the gate tests were not run against `main` separately (same footer string). The btw number is asserted in the footer, not in `main` of `/contact`: the page text points to the footer ("staan onderaan"), which is what AC-2 needs to be true. Not done: the 375/1280 px footer screenshots (needs eyes; Julian's J-7 clean-browser check covers the live page). The sandbox browser is the pre-installed Chromium; the repo's pinned Playwright needed `executablePath` (local config, not committed).

## FE-02 — Monthly total, the sentence under the email fields, no pre-ticked box

Built: `PriceBlock.tsx` renders `monitor.total` (15 px bold, white) under the figure; `ScanField.tsx` and `EmailCapture.tsx` render `scanField.reminders` with a privacy link under the email field, wired by `aria-describedby` (`{id}-email-note`, `report-email-note`); `packages/core/test/no-preticked-boxes.test.ts`; three spec pairs added to `e2e/forms.spec.ts` (scan form, report page, price card; NL and EN).

| Claim | Evidence |
|---|---|
| Checkbox test red with `defaultChecked` on the marketing box | on the real `ScanField.tsx`: 1 failed, violation names `ScanField.tsx … name="marketing" value="ja" defaultChecked`; green again after restoring. Also red on a literal tick in an allow-listed file (`defaultChecked`, `defaultChecked={true}`); stored-choice expression passes |
| Scan is not empty | test asserts at least 3 checkboxes found (found 5) |
| e2e fails on `main` components | with the three components put back: 6 failed (sentence ×4, price total ×2) |
| e2e passes with the change | `forms.spec.ts` desktop: 10 passed (4 old + 6 new) |
| axe | `a11y.spec.ts` desktop: 12 passed; the field points at the sentence via `aria-describedby` (asserted in the spec) |
| One primary button per view | no button added; link only |

Not done: the price band / scan form / report field screenshots (need eyes; the sandbox can reach only the local server).

## BE-03 — Monthly priced with its start fee everywhere; checkout consent pinned

Built: assistant price reply (`chat/index.ts`) uses `monitor.total`; `/llms.txt` line built from `PRICES` ("€149 eenmalig (Vidalo Scan) + €49 per maand, excl. btw, maandelijks opzegbaar."); own facts record `unit` names the start; JSON-LD Monthly `Offer` gets a `description` (NL and EN, from `PRICES`); `price-surfaces.test.ts`, `checkout-consent.test.ts`.

| Claim | Evidence |
|---|---|
| price-surfaces red on each old surface | `chat/index.ts` from `main`: 2 red (NL, EN reply); `own.ts` from `main`: 1 red; `llms.txt/route.ts` from `main`: 1 red; all green restored (7 passed) |
| checkout-consent red on its control | `"required"` → `"none"`: 1 red; restored: green |
| Gate | typecheck 0 errors; core 1436 passed / 23 skipped / 1 todo; worker 52 passed; `e2e:mock` OK; `mail:lab` OK |

Deviations:
- The first version of the chat check passed on the old code (the Scan sentence before it already holds 149). It now reads the Monthly sentence only; that is the version that went red.
- The ticket's EN assertion `not for consumers` does not match the real copy (`en.checkout.consentSubmit` says "not consumers"); the test asserts the real string.
- The `env.mock` assertion is an `it.todo` until BE-02 (F-009), as the ticket allows.
- The llms.txt output is pinned by reading the route source (the route imports `@/` aliases core cannot resolve), not pasted from a running server.
- `own.test.ts` and the facts-page render need no snapshot change (no snapshots touched).

## What is left (night 1)
BE-02 was left for an Opus night; built in night 2 below.

## Night 2 (2026-11-17): BE-02 — Order confirmation from the payment webhook

*Unattended build run (stopgap for the 01:30 slot). First merged `origin/main` (vidalo#137):
two conflicts in `copy/index.ts` and `copy/en.ts` (`mails.order` from BE-01 next to main's new
`mails.scanConfirm`), both kept; `copy-claims.test.ts` rule 5 (a BE-01 test) then listed main's
two new `scanConfirm` keys that say gratis/free (`nl:`/`en:mails.scanConfirm.subject()` and
`.intro()`), so its inline list was extended by those four paths. Merge commit `05e7e02`;
core 1495 passed / 23 skipped / 1 todo, worker 52.*

Built:
- `packages/core/src/billing/order-mail.ts` (new): `queueOrderConfirmation(business, session)`
  (dedupe on the `order_confirmation.queued` event per session id; payer address validated with
  `parseFreeCheckRequest`; `no_address` + `log.warn("order_mail.no_address")` otherwise; enqueues
  the `email` job of §4; event and log `{ sessionId, plan, paid, jobId }`, no address);
  `mockCheckoutSession(plan, lang, email)`; `OrderConfirmationJob`, `orderLines`, `orderSubtotal`,
  `PAID_STATUSES` (moved here from `index.ts` so both share it without a cycle).
- `billing/index.ts`: `checkout.session.completed` calls `queueOrderConfirmation` first, paid
  and processing alike; `async_payment_succeeded` does not call it. Re-exports `order-mail.ts`.
- `reporter/templates.ts`: `OrderData`, `orderProduct`, `orderConfirmationEmail` (intro → card
  "Je bestelling" → card "Looptijd en opzeggen" → card "Wat er geldt" → note; no button).
- `reporter/index.ts`: private `deliverTo` (recipient is `to`, event says `to: "payer"`) and
  `sendOrderConfirmation(job)` (send-side dedupe on `email.order_confirmation` + sessionId;
  per-line split only when Stripe's subtotal equals `PRICES`, else `order_mail.amount_mismatch`).
- `reporter/links.ts`: `voorwaarden → terms` in `EN_SEGMENTS`, so the terms link is `/en/terms`
  in an English mail (same slug as `apps/web/lib/lang-paths.ts`).
- `shared/mail-prefs.ts`: `order_confirmation` in `REQUIRED_MAIL_KINDS`.
- `apps/worker/src/jobs/types.ts` (union member = `OrderConfirmationJob` from core) and
  `jobs/misc.ts` (`case "order_confirmation"`).
- `apps/web/app/api/checkout/route.ts`: F-009 (no key outside mock mode → `checkout.refused
  {reason:"no_stripe"}`, `?betaling=fout`, before any status change); mock path queues
  `queueOrderConfirmation(business, mockCheckoutSession(plan, lang, ownerEmail ?? session email))`;
  F-020 (`monitor_addon` needs `plan === "setup"` and status `trial`/`active`, else
  `checkout.refused {reason:"addon_without_scan"}` → `/app/abonnement`).
- `scripts/mail-lab.mts`: kind `order_confirmation`; the paid journey (NL, EN) and the hostile
  name each get one through `mockCheckoutSession`; rules of AC-15.
- Tests: `packages/core/test/order-mail.test.ts` (new, 15), `billing.test.ts` (+5),
  `checkout-consent.test.ts` (BE-03's `it.todo` for F-009 replaced by 3 route tests, as the
  todo said it would be: "arrives with BE-02").

| Claim | Evidence |
|---|---|
| Webhook queues one order mail: paid → 1; processing → 1 with `paid:false`; then `async_payment_succeeded` → still 1; replayed event and same session in a new event → 1; `monitor_addon` → 1; no address → 0, no throw, payment still handled | `billing.test.ts` new block, written first: red before the code (4 failed, `AssertionError: expected [] to have a length of 1 but got +0`; the no-address case passed trivially), green after (16/16 in the file) |
| Dedupe control | `if (events.some(... ORDER_QUEUED_EVENT ...)) return "duplicate"` commented out: 2 red (`billing.test.ts` "a replayed event…", `order-mail.test.ts` "…a second call is a duplicate"); restored: green |
| Template, 3 plans × 2 languages: product in subject, lines excl. btw, subtotal, btw with "21%", total, ordered-on date, renewal (Monthly) or no renewal (Scan), start sentence, terms with version + link in the buyer's language, privacy link, invoice, questions, company line with KvK and btw in text and HTML, no button, no Stripe id | `order-mail.test.ts` red before the code (module missing), then 6 red on the first build: the text part had no company line (`expected 'Hoi,…' to contain 'A101 B.V.'`); fixed by appending `landing.footer.legal` to this mail's text part; green |
| AC-15 control, terms link removed from the template | `order-mail.test.ts`: 6 failed (`…to contain 'Algemene voorwaarden (versie van 17 n…'`); `pnpm mail:lab`: `✗ order_confirmation: order mail without a link to the terms` ×3, `FAIL: 0 kinds missing, 3 mails with problems`; restored: green / `OK mail-lab` |
| Control, `cs_test_…` / `session_id=` in the text | 6 failed (`…not to match /cs_(test\|live)_\|session_id…/`); restored: green |
| Send-side dedupe, recipient, no address in events | `order-mail.test.ts` "sends once per session": second `sendOrderConfirmation` → null, one `email.order_confirmation` with `to: "payer"`, payload has no `@` |
| Amount mismatch | subtotal 9900 for `setup`: event `order_mail.amount_mismatch {expected:14900, charged:9900}`; the mail has no per-line split (template test "without the per-line split…") |
| Required mail | `REQUIRED_MAIL_KINDS` contains it, `OPTIONAL_MAIL_KINDS` does not (test); lab: no `List-Unsubscribe` |
| Hostile name escaped | template test (`&lt;b&gt;Music&lt;/b&gt;`, no `<b>Music`); mail lab sends one to the `HOSTILE` business (in `hostileMissing`), 0 problems |
| F-009 and F-020 in the route | `checkout-consent.test.ts` (source-reading, as BE-03's file does; apps/web has no unit runner): on the old route 3 failed, on the new 6/6 green |
| No address in logs | `grep -E 'order_confirmation\|order_mail'` over the full `pnpm -r test` output: 0 lines with `@` |
| Gate | `pnpm -r typecheck` green; `pnpm -r test`: core 107 files, 1518 passed / 23 skipped (was 1495 + 1 todo: +15 order-mail, +5 billing, +3 route, −1 todo), worker 7 files, 52 passed; `pnpm e2e:mock`: `OK e2e-mock`; `pnpm mail:lab`: 86 mails, 36/36 kinds, `order_confirmation nl 2 en 1`, `OK mail-lab` |
| `legal.lock.json` unchanged | nothing under `copy.legal` edited (the mail reads `legal.updated`); `legal.test.ts` green |

Deviations from the ticket text, for the PR reader:
- **Scan + Monthly gets only `termsMonthly`, not `termsSetup` too.** The ticket says "termsSetup
  and/or termsMonthly by plan"; `termsSetup` ends "Er verlengt niets", which next to "Vidalo
  Monthly verlengt elke maand vanzelf" contradicts itself. The order lines already say the Scan
  is once. Julian decides (state.md J-10).
- **The plain-text part carries the company line** (`landing.footer.legal`) after the sign-off,
  for this mail only. `renderMail` puts it only in the HTML footer; AC-14 needs it in the mail.
  Other mails are unchanged.
- **The `monitor` subject product** is built from existing keys: `Vidalo Scan + Vidalo Monthly`
  (`landing.prijs.setup.name` + `monitor.name`); no new string.
- **`links.accountUrl` is printed under `termsMonthly`** (the ‘Abonnement’ page the sentence
  names); the block list in the ticket names the link in the contract but not its place.
- **The online-wording checks of the mail lab skip `order_confirmation`** (it says "21%" and
  "Google-account", which those checks treat as a score and local wording); the escaping check
  for the hostile name still runs on it.
- **A missing session id** is treated as `no_address` (nothing to dedupe on); Stripe always sends one.
- Known, not changed: `sendMail` (`reporter/mail.ts:96`) logs `to` in its `mail.sent` line when
  Resend is on, for every mail kind. BE-02 adds no such line of its own. Raised as F-022.

## What is left
Nothing of the build: BE-02 was the last ticket. Next: verify round 1 (phase 4), then the
Julian items in `state.md` (J-6 is the real test order that proves the mail end to end).
