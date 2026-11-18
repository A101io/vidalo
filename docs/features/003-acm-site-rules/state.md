# State — 003 ACM rules on the site

*Updated by delivery-lead. This is the file that answers "where is this?" in five seconds.
An unattended run re-reads it at the start of every run; Julian edits it between runs.*

| | |
|---|---|
| Phase | **4 verify, round 1 done 2026-11-17: SHIP** (`05-verification.md`). PR #136 merge: see the phase log (only after every CI check on the head is green and `deploy` is skipped). Nothing deployed; vidalo.ai unchanged |
| Started | 2026-11-12 |
| Design reviewed | none (no new layout; copy inside existing design G components) |
| Design gate rounds used | 0 of 2 (skipped) |
| Verify rounds used | 1 of 2 |
| Open P0s | **none**. F-009 and F-020 tried on a real route (Postgres, mock off, no Stripe key) and refused. Verify r1 added F-023 (P2), F-024…F-027 (P3); F-022 confirmed P2. All follow-ups, none blocks |
| Waiting on Julian | J-1…J-9 below (J-10 decided 19 Nov 2026 by the silence rule): release gates, not merge blockers (also row L3 of `docs/go-live-checklist.md`). J-3 (F-004) and J-4 (F-021) can block **launch**. J-1 (legal text, `legal:lock`) and J-8 (deploy) stay Julian's |

Control Room rows: R4, R7, R8, R9

## Waiting on Julian (suggested answer per item)
| # | What | Suggested answer |
|---|---|---|
| J-1 | Complaints article in the terms, NL and EN (wording in `02-architecture.md` §8); new legal version + `legal:lock`; counsel De Boer | "Ja, na De Boer zo publiceren, 5 werkdagen" |
| J-2 | Terms "Prijzen en betalen" (`copy/index.ts:865`): say Monthly starts with Vidalo Scan, refer to /prijzen instead of repeating prices (F-006) | "Verwijs naar /prijzen en noem dat Monthly met Scan begint" |
| J-3 | Day-7/21 mails after a free check: counsel on art. 11.7 Tw; privacy calls them a reminder while they carry an offer (F-004) | "Counsel vragen; tot dan alleen sturen als het nieuwsvakje is aangevinkt" |
| J-4 | Confirm footer identity against the KvK extract and that "Vidalo" is a registered trade name of A101 B.V.; choose whether the footer leads with A101 B.V. (F-013, F-021) | "Klopt, Vidalo staat als handelsnaam ingeschreven; footer mag zo blijven" (only if true) |
| J-5 | Counsel on "Geen verborgen kosten" next to €149 + €49 (Q5 assumed keep) | "Houden" |
| J-6 | One real test order per plan: Stripe summary and pay-step screenshots (button text in both modes), whether a btw number was required, the order mail received, Stripe invoice with KvK and btw (F-008, F-015) | "Doe ik op de sandbox na de merge" |
| J-7 | Clean-browser check on vidalo.ai after deploy (`/`, `/en`, `/binnenkort`, `/en/coming-soon`, `/contact`); phone answers on a working day | "Doe ik na de deploy" |
| J-8 | Deploy (manual) and the launch gate | "Deploy na groen en J-1" |
| J-9 | Ask the KvK number at checkout as B2B evidence? (F-008) | "Nee, als J-6 laat zien dat het btw-nummer verplicht is" |
| J-10 | Order mail for Scan + Monthly: only "Vidalo Monthly verlengt elke maand vanzelf…", not also "Vidalo Scan is een eenmalige opdracht. Er verlengt niets." (the two contradict each other in one mail). Built that way in BE-02 | "Goed zo" **Decided 19 Nov 2026 by the silence rule** (Q-20261117-02, asked 17 Nov, no answer within 48 hours; `_OS/AUTHORITY.md` §2): as built. |

## Phase log
| Date | Phase | What happened | Who |
|---|---|---|---|
| 2026-11-12 | 0 intake | Request recorded from the Control Room backlog; re-audit of R4, R7, R8, R9 against the repo at b5577b1; 01-brief.md written (18 acceptance criteria, Q1-Q6 with assumed answers) | think run |
| 2026-11-15 | 0 intake | Brief approved by the 48-hour silence rule (needs-you Q-20261112-01); Q1–Q6 stand as assumed | silence rule |
| 2026-11-15 | 1 shape | 02-architecture.md (contract 003.1): copy keys NL/EN, `COMPANY` source, order mail from the webhook, interface contract, file ownership, test plan; ADR-0008, ADR-0009; tickets BE-01, FE-01, FE-02, BE-02 (complex), BE-03, 2.75 d; Julian items J-1…J-9; proposed complaints article for counsel. Code read at 1cf3de5 | architect (think run) |
| 2026-11-15 | 1 shape | checklists/security.md (SEC-01…17, no P0 against the design; SEC-01/02/05/10/11 P0 if observed) and checklists/compliance.md (COMP-01…42; B2B position checked: holds on conditions; one P0 against the design, F-001; launch hard-stop candidates F-004, F-021) | security, compliance (think run) |
| 2026-11-16 | 3 build | Night 1 (unattended build run): BE-01 copy keys, `COMPANY`, `copy-claims.test.ts`; FE-01 complaint paragraph + `company-details.spec.ts`; FE-02 card total, reminders sentence, `no-preticked-boxes.test.ts`; BE-03 price surfaces + checkout-consent tests. Core 1436 tests, worker 52, e2e:mock and mail:lab OK. BE-02 not started | build run |
| 2026-11-17 | 3 build | Night 2 (unattended, Opus): merged main (#137, two copy conflicts kept both); BE-02 built: order mail queued by the webhook for all plans (paid/processing, once per session), sender, template NL/EN, required kind, worker case, mail lab rules, F-009 and F-020 in the checkout route. Core 1518 passed, worker 52, e2e:mock OK, mail:lab OK (36/36 kinds). Build done | build run |
| 2026-11-17 | 4 verify | Round 1 (unattended, 03:30 stand-in): qa, security, compliance reviews in `reviews/*-r1.md`; gate observed (core 1518/23 skipped, worker 52, e2e:mock OK, mail:lab 36/36, Playwright 19 + 3 gate); F-009/F-020 refused on a real route; verdict **SHIP** (`05-verification.md`); findings F-023…F-027 | verify run |
| 2026-11-15 | 1 shape | F-001…F-021 into findings.md; F-001 (P0) folded into ADR-0008/BE-02; F-002, F-003, F-005, F-009, F-010, F-017, F-018, F-020 folded into tickets (Amendment 1 of the architecture); F-004, F-006, F-008, F-013, F-021 to Julian | delivery-lead (think run) |
| 2026-11-19 | 4 verify | Q-20261117-02 took its default under the silence rule: J-10 as built (only the Monthly renewal sentence in the Scan + Monthly order mail). Nothing mailed, nothing deployed. | think run (unattended) |

## Skipped phases
| Phase | **4 verify, round 1 done 2026-11-17: SHIP** (`05-verification.md`). PR #136 merge: see the phase log (only after every CI check on the head is green and `deploy` is skipped). Nothing deployed; vidalo.ai unchanged |
|---|---|
| 2 design gate | No new page, layout or component: one chip text, one price line inside the existing card, one sentence under two existing fields, one paragraph on /contact, one mail in the existing mail layout. Every string is reviewed by Julian line by line in the PR, and FE-01/FE-02 attach screenshots at 375 and 1280 px. If Julian wants a design pass on the price card, it re-enters at phase 2 |

## Decisions needed
None to merge (verify r1: SHIP). Follow-up PR, small, no decision needed: F-022, F-023, F-024 (EN month lowercased in the order mail), F-025, F-027. Before launch: J-3 (counsel on the day-7/21 mails) and J-4 (trade
name). Suggested answers above; default if silent: the build proceeds, launch waits.
