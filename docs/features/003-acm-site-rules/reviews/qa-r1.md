# QA review — round 1 — 003 ACM rules on the site

*qa · 2026-11-17 (unattended verify run, 03:30 slot stand-in) · branch `claude/build-2026-11-16-003-acm-site-rules` at `ead862e` (PR #136) · every line below was observed in this run, in this container.*

## Gate (observed counts)

| Command | Observed |
|---|---|
| `pnpm install` | exit 0 |
| `pnpm -r typecheck` | 0 errors |
| `pnpm -r test` | core: 107 files, **1518 passed / 23 skipped**; worker: 7 files, **52 passed** (same as night 2's claim) |
| `pnpm e2e:mock` | `OK e2e-mock`; three `order_confirmation.queued` lines (setup, monitor, monitor), no address in them |
| `pnpm mail:lab` | 86 mails, **36/36 kinds**, `✓ order_confirmation nl 2 en 1`, online business 0 with problems, `OK mail-lab` |
| Playwright `company-details.spec.ts` + `forms.spec.ts` (mock, desktop) | **19 passed** |
| Playwright `company-details.spec.ts`, `E2E_MODE=gate` | **3 passed** (`/binnenkort`, `/en/coming-soon`, 375 px) |
| Playwright `a11y.spec.ts` | 11 passed, 1 failed (`/voorwaarden`) on the full run; `/voorwaarden` alone: **passed**. The page is not in this diff; cold-compile flake as CLAUDE.md describes (F-026) |

Playwright ran with the container's Chromium through a local config (`executablePath`), not committed. Each dev server start halted once on a Next.js notice and continued on the second start; nothing was upgraded or changed.

## Acceptance criteria

| AC | Verdict | Evidence observed |
|---|---|---|
| AC-1 footer company line + btw, NL/EN | met | `footer.legal` (`copy/index.ts:695`) built from `COMPANY`, carries KvK and `btw NL869514192B01`; e2e footer test on `/`, `/en`, `/prijzen`, `/en/pricing`, `/contact`, `/en/contact` passed |
| AC-2 /contact email, phone, hours, company line | met | e2e `/contact` and `/en/contact` passed (footer + complaint paragraph) |
| AC-3 coming-soon email, phone, footer | met | gate-mode e2e 3 passed |
| AC-4 complaints article in the terms | **gate (J-1)** | legal text, not edited; `legal.lock.json` unchanged in the diff |
| AC-5 dispute committee / ConsuWijzer n/a | met (condition) | B2B clauses unchanged; no ConsuWijzer/ODR text in copy outside `legal` |
| AC-6 no popularity chip | met | grep `Meest gekozen\|Most chosen\|populair\|popular\|bestseller` over `copy/*.ts`: 0 hits; chip is "Voor wie elke maand wil controleren" / "For checking every month" |
| AC-7 sentence under both email fields, privacy link | met | `scanField.reminders` NL/EN (wording per F-003); rendered in `ScanField.tsx:115` and `EmailCapture.tsx:39`; e2e scan form + report page NL/EN passed |
| AC-8 "10.000 bedrijven" names VS/US | met | grep: all 6 occurrences carry `(VS)` / `(US)` |
| AC-9 no pre-ticked box | met | `no-preticked-boxes.test.ts` in the green suite; the build's control (defaultChecked → red) not re-run tonight |
| AC-10 gratis/free list | met (Julian reads) | snapshot in `copy-claims.test.ts`, green; Julian reads the list once in the PR |
| AC-11 Monthly card total | met | `monitor.total` built from `PRICES`: "€149 eenmalig + €49 per maand, excl. btw" / "€149 once + €49 per month, excl. VAT"; e2e price card NL/EN passed |
| AC-12 terms consent required, B2B text | met | `checkout-consent.test.ts` green; route reads `consent_collection: { terms_of_service: "required" }` |
| AC-13 withdrawal n/a | met (condition) | clause unchanged |
| AC-14 order block in the confirmation | met | rendered mails read (Scan + Monthly NL and EN, below); all three plans × two languages sent through `sendOrderConfirmation` in a throwaway test (not committed) |
| AC-15 mail lab asserts it, both languages and plans; control | met, one gap | lab: `order_confirmation nl 2 en 1` (Monthly NL + EN, Scan NL via the hostile business); Scan EN only in `order-mail.test.ts`, not in the lab (F-025). The terms-link control is the build's claim, not re-run |
| AC-16 pay button text | **gate (J-6)** | Stripe's wording; real test order |
| AC-17 claims test | met | `copy-claims.test.ts` green |
| AC-18 gate green, `legal.test.ts` | met | counts above |

## The two P0-if-observed cases, tried on a real route

Web app on a local Postgres 16 (all migrations applied), `VIDALO_MOCK` unset, no `STRIPE_SECRET_KEY`, so `/api/health` answered `{"db":"pg","mock":false}`. Three businesses inserted by hand; the add-on calls carry a mock-auth cookie of a verified owner with a live `auth_session` row (dev build only).

| Case | Request | Observed |
|---|---|---|
| **F-009**, no Stripe key outside mock | `POST /api/checkout plan=setup` and `plan=monitor`, fresh business, no session | `303 → /r/x?betaling=fout` both; event `checkout.refused {reason:"no_stripe"}`; business stays `none/scanned`; **0 jobs** |
| **F-020**, add-on without a Scan | verified owner, `plan none / status scanned`, `plan=monitor_addon` | `303 → /app/abonnement`; event `checkout.refused {reason:"addon_without_scan"}`; no status change |
| control: add-on with a running Scan | verified owner, `plan setup / status active` | passes the F-020 check, then refused by F-009 (`no_stripe`, `?betaling=fout`): the order of checks is right |
| SEC-01 replay | `GET /welkom?session_id=cs_test_abc…`, `/welkom?mock=1…`, `/en/welcome?session_id=mock_abc…` | 200 each; events 4 → 4, jobs 0 → 0 |

Neither P0 was observed.

## The order mail as rendered (Scan + Monthly)

NL: "Je bestelling … Vidalo Scan, eenmalig: € 149,00 excl. btw / Vidalo Monthly, per maand: € 49,00 excl. btw / Samen: € 198,00 excl. btw / Btw (21%): € 41,58 / Betaald: € 239,58"; renewal and cancelling as terms art. 9; start after proof with the 30-day dissolution (terms `index.ts:895`); terms with version date, privacy, invoice from Stripe; support address and phone; company line with KvK and btw. EN the same with `/en/terms`, `/en/privacy`, `/en/app/abonnement` (a valid URL: `app` keeps its name under `/en`).

One defect: the EN mail reads "Terms and conditions (version of 17 **n**ovember 2026)": `mails.order.terms` (EN, `en.ts:3134`) lowercases the whole `legal.updated` string, month included (F-024).

## Findings (qa lane, ordered)

1. F-024 P3 — EN order mail lowercases the month in the terms version.
2. F-025 P3 — mail lab has no English Vidalo Scan order mail (unit test covers it).
3. F-026 P3 — `a11y.spec.ts /voorwaarden` failed once on a full cold run, passed alone.

No P0, no P1.
