# Build log — 003 ACM rules on the site

*Unattended build run, night 1, 2026-11-16. Tickets: BE-01, FE-01, FE-02, BE-03. BE-02 (complex) is not in this night.*

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

## What is left
BE-02 (order confirmation from the webhook, F-001, F-009, F-020; mail lab; `order-mail.test.ts`) is for an Opus night. It uses `copy.mails.order` and `PRICES`, both present.
