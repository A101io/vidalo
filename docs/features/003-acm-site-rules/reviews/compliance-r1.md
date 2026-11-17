# Compliance review — round 1 — 003 ACM rules on the site

*compliance · 2026-11-17 (unattended verify run) · `ead862e` (PR #136) · against `checklists/compliance.md` (COMP-01…42). I am not a lawyer; items marked **lawyer** stay with counsel. Legal-text items that wait for Julian or counsel are **gates**, not findings (run rules). Sources as in the checklist: `[known]`, `[row]`.*

## Verdict for this lane
No hard stop observed in the code as shipped. No new P0 or P1. The launch hard-stop candidates stay where phase 1 put them: F-004 (J-3, **lawyer**) and F-021 (J-4, trade name). Neither gates this merge; both gate launch.

## Items

| ID | Result | Evidence (observed tonight unless "read") |
|---|---|---|
| COMP-01 terms exclude consumers | pass | `copy.legal` not in the diff; `legal.lock.json` unchanged; `legal.test.ts` green |
| COMP-02 tick box + B2B sentence | pass (code); screenshot = gate J-6 | `checkout-consent.test.ts` green; route read |
| COMP-03 no consumer-directed copy | pass | grep of added lines for `particulier\|voor thuis\|consument`: 0 hits outside the B2B sentences |
| COMP-04 Stripe tax-id refusal | gate J-6 / J-9 | not observable here (F-008) |
| COMP-05 company details on every page | pass (code); live check = gate J-7 | e2e footer 6 pages + gate pages passed |
| COMP-06 KvK on site and mail | pass | footer line; order mail text and HTML carry `KvK 42057858` |
| COMP-07 registered trade name | **gate J-4** (HARD STOP if not registered) | not provable from the repo (F-021) |
| COMP-08 6:227b information | gate J-6 | Stripe pages |
| COMP-09 order confirmed without delay | **pass** | queued at `checkout.session.completed` for paid and processing, all three plans (`billing.test.ts` green; e2e:mock and lab queue it); the worker sends it as a required mail. Time to inbox = J-6 |
| COMP-10 terms available, storable | pass (F-007 accepted) | mail links `/voorwaarden` (`/en/terms`) with "versie van 17 november 2026" |
| COMP-11 services-directive info | pass | via COMP-05, 10, 14 |
| COMP-12 no untrue statement | pass | no popularity chip; all "10.000 bedrijven" carry (VS)/(US) |
| COMP-13 nothing pre-ticked | pass | `no-preticked-boxes.test.ts` green |
| COMP-14 neutral chip | pass | "Voor wie elke maand wil controleren" / "For checking every month" |
| COMP-15 reminder sentence says what follows | pass | NL "…nog een kort bericht over de uitkomst en wat we voor je kunnen doen. Afmelden kan met één klik." + privacy link; EN the same; e2e under both fields NL/EN |
| COMP-16 lawful basis of day-7/21 mails | **gate J-3, lawyer** (launch HARD STOP if counsel says consent) | unchanged behaviour (F-004) |
| COMP-17 gratis/free list | pass; Julian reads the snapshot once in the PR | `copy-claims.test.ts` rule 5 |
| COMP-18 checkbox allow-list | pass | allow-list = stored choices only (F-005) |
| COMP-19 no scarcity/countdown/review | pass | grep of added lines: 0 |
| COMP-20 Monthly total on the card | pass (text); 375/1280 screenshots not taken (sandbox), J-7 covers live | e2e price card NL/EN |
| COMP-21 other Monthly price surfaces | pass | `price-surfaces.test.ts` green (chat, llms.txt, own facts, JSON-LD) + claims rule 3 |
| COMP-22 excl. btw, 21% named | pass | card "excl. btw"; order mail "Btw (21%)" |
| COMP-23 "Geen verborgen kosten" | gate J-5 (counsel) | unchanged |
| COMP-24 one price source | pass for code; terms copy = **gate J-2** (F-006) | card, mail, surfaces from `PRICES` |
| COMP-25 add-on only for Scan customers | **pass, observed** | route refused `monitor_addon` for `none/scanned` (`addon_without_scan`) |
| COMP-26 product and date | pass | "Besteld op 17 november 2026"; subject names the product |
| COMP-27 amounts, btw, total, processing | pass | per-line excl. btw, subtotal, btw 21%, total; processing variant in `order-mail.test.ts` |
| COMP-28 renewal and cancelling as the terms | pass | mail sentence matches terms art. 9 (`copy/index.ts:893`): online under 'Abonnement', no notice period, paid month runs out, confirmation with end date. Scan + Monthly carries only the Monthly sentence (J-10) — no contradiction with the terms |
| COMP-29 start condition and 30-day dissolution | pass | `startAfterProof` matches terms `index.ts:895`; `startNow` for a verified owner and for the add-on |
| COMP-30 terms + privacy links in the buyer's language, company line | pass | NL `/voorwaarden`, `/privacy`; EN `/en/terms`, `/en/privacy`; company line in text and HTML. Cosmetic: EN month lowercased in the version (F-024, P3) |
| COMP-31 no withdrawal text, no marketing | pass | the "ontbinden" sentence is the contractual 30-day dissolution, not a withdrawal right; no offer, no button |
| COMP-32 pay button text | gate J-6 | F-015 |
| COMP-33 invoice details | gate J-6 | Stripe invoice |
| COMP-34 complaints article in the terms | **gate J-1** | legal text, not edited |
| COMP-35 /contact matches the article | pass for now | /contact: support mail, phone, working hours, "binnen 5 werkdagen" (NL/EN); same 5 days as the proposed article; re-check when J-1 lands (F-019) |
| COMP-36 no ODR / ConsuWijzer / geschillencommissie | pass | grep of copy outside `legal`: 0 |
| COMP-37 lawful basis of the order mail | pass | contract (6(1)(b)); Resend already a processor |
| COMP-38 no address in events/logs | pass for 003's own lines; two P2s | F-022 (shared mail log line), F-023 (`checkout.completed` event, pre-existing) |
| COMP-39 privacy text needs no change | pass (opinion; Julian if counsel disagrees) | — |
| COMP-40 decision after tickets re-checked | pass | J-10 (Scan + Monthly gets only the Monthly sentence) checked against the terms: consistent |
| COMP-41 findings + go-live gates recorded | done in this run | `findings.md` F-022…F-027; `docs/go-live-checklist.md` row L3 lists J-1…J-10 |
| COMP-42 built is not runs | holds | R4, R7, R8, R9 stay `written` until J-6 and J-7 are dated |

## Findings (compliance lane, ordered)
1. F-023 P2 — buyer's address in the `checkout.completed` event (pre-existing; shared with security).
2. F-024 P3 — EN order mail lowercases the month in the terms version (shared with qa).

## Release gates (Julian, not findings)
J-1 complaints article (COMP-34), J-2 terms price clause (COMP-24), J-3 day-7/21 lawful basis (COMP-16, launch hard stop if consent needed), J-4 trade name (COMP-07, launch hard stop if unregistered), J-5 "Geen verborgen kosten" (COMP-23), J-6 test order (COMP-02/04/08/09/32/33), J-7 clean browser (COMP-05/20), J-8 deploy, J-9 KvK field, J-10 Scan + Monthly sentence (COMP-40).
