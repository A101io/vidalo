# State — 003 ACM rules on the site

*Updated by delivery-lead. This is the file that answers "where is this?" in five seconds.
An unattended run re-reads it at the start of every run; Julian edits it between runs.*

| | |
|---|---|
| Phase | **1 shape done 2026-11-15 → 3 build-ready** (phase 2 design gate skipped, see below). Next: BE-01 first, then FE-01, FE-02, BE-02, BE-03 (`tickets/README.md`), 2.75 d in all |
| Started | 2026-11-12 |
| Design reviewed | none (no new layout; copy inside existing design G components) |
| Design gate rounds used | 0 of 2 (skipped) |
| Verify rounds used | 0 of 2 |
| Open P0s | none. F-001 (compliance, P0 against the design: order confirmation inside the welcome mail) is folded into the design (ADR-0008, BE-02). Two P1s are **P0 if observed** in phase 4: F-009 (free plan without a Stripe key), F-020 (add-on charged without a Scan); both fixed in BE-02 |
| Waiting on Julian | J-1…J-9 below; none blocks the build. J-3 (F-004) and J-4 (F-021) can block **launch** |

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

## Phase log
| Date | Phase | What happened | Who |
|---|---|---|---|
| 2026-11-12 | 0 intake | Request recorded from the Control Room backlog; re-audit of R4, R7, R8, R9 against the repo at b5577b1; 01-brief.md written (18 acceptance criteria, Q1-Q6 with assumed answers) | think run |
| 2026-11-15 | 0 intake | Brief approved by the 48-hour silence rule (needs-you Q-20261112-01); Q1–Q6 stand as assumed | silence rule |
| 2026-11-15 | 1 shape | 02-architecture.md (contract 003.1): copy keys NL/EN, `COMPANY` source, order mail from the webhook, interface contract, file ownership, test plan; ADR-0008, ADR-0009; tickets BE-01, FE-01, FE-02, BE-02 (complex), BE-03, 2.75 d; Julian items J-1…J-9; proposed complaints article for counsel. Code read at 1cf3de5 | architect (think run) |
| 2026-11-15 | 1 shape | checklists/security.md (SEC-01…17, no P0 against the design; SEC-01/02/05/10/11 P0 if observed) and checklists/compliance.md (COMP-01…42; B2B position checked: holds on conditions; one P0 against the design, F-001; launch hard-stop candidates F-004, F-021) | security, compliance (think run) |
| 2026-11-15 | 1 shape | F-001…F-021 into findings.md; F-001 (P0) folded into ADR-0008/BE-02; F-002, F-003, F-005, F-009, F-010, F-017, F-018, F-020 folded into tickets (Amendment 1 of the architecture); F-004, F-006, F-008, F-013, F-021 to Julian | delivery-lead (think run) |

## Skipped phases
| Phase | Why skipping is safe here |
|---|---|
| 2 design gate | No new page, layout or component: one chip text, one price line inside the existing card, one sentence under two existing fields, one paragraph on /contact, one mail in the existing mail layout. Every string is reviewed by Julian line by line in the PR, and FE-01/FE-02 attach screenshots at 375 and 1280 px. If Julian wants a design pass on the price card, it re-enters at phase 2 |

## Decisions needed
None to start the build. Before launch: J-3 (counsel on the day-7/21 mails) and J-4 (trade
name). Suggested answers above; default if silent: the build proceeds, launch waits.
