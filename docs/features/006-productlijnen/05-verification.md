# 006 Productlijnen: verification

*delivery-lead · merged from `qa.md`, `security.md`, `compliance.md` (all 21 Nov 2026), against `01-brief.md`
AC1–AC8 and the phase-1 lists `checklists/security.md` and `checklists/compliance.md`. Severity per
`_OS/playbook/templates/pipeline/SEVERITY.md`, applied literally. Every row is in `findings.md`.*

## Round 2 (21 Nov 2026)

### Verdict: DECISION NEEDED. No P0 left in code; QA-01 (AC8 timing) waits on Julian. Verify rounds 2 of 2 used.

- **Fixed and confirmed by the agent that raised it:** SEC-V01 (cron reads only `scan.enqueued`; PoC flood 1 + 4 jobs, was 6 + 24), SEC-V02 (monthly line budget; 4 jobs, was 24), SEC-V03 (715 KB field 6 ms, was 174 s), SEC-V04, SEC-V05, SEC-V07, S-13 (unchanged save writes nothing), CMP-601, CMP-602, CMP-603, CMP-604, CMP-607, CMP-611 (no-JS error summary takes focus), QA-04, QA-05, QA-06, QA-08. QA-11 (reordered markets made a new version) fixed after round 2 by the coordinator: `parseProductLine` stores markets in `LINE_MARKETS` order; test red without it.
- **Open, not blocking a PR:** QA-01 (AC8, Julian; memo in state.md) · SEC-V08 P1 (Google reconnect re-queues a baseline scan; on main, not 006) · CMP-605 P2, CMP-606 P2 (D5), CMP-608 P2 (EAA size confirmation), CMP-609 P2 (lawyer) · QA-03 P2 (`/r` line guard has no automated test; behaviour checked by hand) · QA-07 P3 (EN question carries the owner's Dutch label) · SEC S-13 daily cap not built (P2) · SEC P3 index on `event (business_id, type, at desc)` · BLD-04 no Playwright specs.
- **Suites after the last change:** typecheck clean; core 1656 passed / 30 skipped; worker 69; `e2e:mock` OK; `verify:pg` (before QA-11, which touches no SQL) RLS-OK with both broken controls RLS-FAIL; `mail:lab` OK.

## Round 1 (21 Nov 2026)

### Verdict: BLOCKED. Two P0s open; verify round 1 of 2 used.

| P0 | Why it stands | Where it goes |
|---|---|---|
| **SEC-V01** (security) | A plausible path to money in the defined form: a verified, paying owner floods the 500-event window, and the `*/10` cron re-enqueues the monthly scan (and on this branch every line-market job); `DEFER_ONCE` turns the daily ceiling into a one-day delay. PoC 6 + 24 jobs against 1 + 4. Evidence, fix and cost present. Live on main (`saveMailPrefs`), so the foreseeability cap does not apply | Backend, fix round r1 in progress on this branch. The business half also goes to main on its own (Julian: deploy) |
| **QA-01** (qa) | AC8 demonstrably not met, failing case written down (FAQ, assistant, pricing, `/organisaties`, terms "what a line includes": 0 mentions; no approval). An acceptance criterion that fails is a veto; delivery-lead does not overrule it | **Not a build item.** Closes only by Julian amending AC8 (or deciding D1). Decision memo in `state.md` |

AC1–AC7 pass (QA, with eleven controls shown red without the guarantee). Compliance: no legal hard stop.
Security: 32 of 38 checklist items pass; S-11, S-13, S-23, S-30, S-34, S-36 partial or failing, all filed below.

### Conflict resolved: QA-01 option (a) against compliance B3

- **QA** proposes (a): an FAQ item ("… alleen Vidalo Monthly, geen prijs tot D1"), the same fact in the assistant,
  the `/organisaties` sentence when that branch merges.
- **Compliance B3 / L-40 / L-42 / L-71** (phase 1, before build): no surface outside the dashboard, legal texts and
  owner mails names product lines or what a plan includes while `VIDALO_PRODUCT_LINES` is off and D1 is open,
  because lines named as part of Monthly become part of Monthly by conduct (terms art. 3), and moving them to another
  price later is a removal that needs notice and a right to cancel.
- **Decided: (a) is rejected as a build item.** Grounds: lawfulness is compliance's decision (PIPELINE decision
  rights), B3 was recorded in phase 1 and built (deviation 5), and the FAQ sentence QA proposes states what Monthly
  includes, which is exactly what B3 forbids. Pricing and the terms line cannot be written before D1 at all, and
  `/organisaties` is not on main. QA's position is recorded in `findings.md` under QA-01.
- **QA-01 keeps P0.** Its form is right; what is wrong is that AC8 bundles surfaces that depend on an open decision
  (D1) and an unmerged branch. Changing an acceptance criterion is the analyst's call with Julian's approval, so
  this goes to Julian as **DECISION NEEDED (AC8 timing)**, not to frontend.

### Re-classified by delivery-lead

| ID | Claimed | Now | Rule |
|---|---|---|---|
| CMP-608 | P1 | **P2** | Demotion: no evidence ("headcount and turnover not given to me"). The question to Julian stays |
| CMP-609 (new id: compliance's open lawyer question on art. 5 and certificates) | P1 (phase 1) | **P2** | Demotion: no concrete fix, no cost. Goes to the ship report as a lawyer question |
| SEC-V07 (new id: security's note on `loadProductLineDetail`) | unrated | **P2** | Demotion: no cost given. Routed to frontend |
| CMP-611 (new id: compliance's "focus not moved to first error without JS") | unrated | **P2** | Demotion: no fix, no cost. QA lane, not a veto (EAA, L-66) |
| SEC-V02 | P1 | P1 (confirmed) | Security capped it itself under foreseeability (S-13, S-23 named it in phase 1); must be fixed before the switch is turned on |
| SEC-V01 | P0 | P0 (confirmed) | Live exploit path; the cap does not apply |

No P0 came from an agent outside security, compliance or QA.

### Merged list per lane (ordered; P0, then P1, then P2, then P3)

**Backend**
1. SEC-V01 P0: keyed "already enqueued this month" (job dedupe key or `hasEventSince` + index), per-business monthly
   line budget; test with 600 unrelated events; business half as its own PR to main. 2–3 h. *In progress (fix r1).*
2. SEC-V02 P1: the monthly line budget from V01, plus S-13 (≤ 50 saves per line per day). +30 min. *In progress.*
3. CMP-601 P1: a line correction letter and its follow-up drop the facts-page URL; test asserts it. 30–45 min. *In progress.*
4. CMP-602 P1: outlet finding in the monthly mail uses `outletNotListed` / `outletNote`, never "Klopt niet"; mail-lab
   assertion. 1 h. *In progress.*
5. CMP-603 P1: the mail's line market sentence names the AI systems asked. 30 min. *In progress.*
6. SEC-V03 P2: `lines()` stops at `MAX_ROWS + 1` and caps the raw field; 700 KB test < 50 ms. 15 min. *In progress.*
7. SEC-V04 P2: escape the U+202E in `test/product-lines.test.ts:148`. 5 min. *In progress.*
8. CMP-604 P2: "deze maand niet gecontroleerd" for a market with an earlier run. 20 min. *In progress.*
9. CMP-606 P2: whether an unlisted outlet colours the dot. **Waits on D5**; no build until Julian answers.

**Frontend**
1. QA-01 P0: nothing to build until Julian answers the AC8 memo. If he picks the amendment, nothing changes in this PR.
2. QA-03 P2: `isLineRun` in `lib/report-access.ts`, unit-tested. 30 min. *In progress.*
3. QA-04 P2: `aria-invalid` on the failing outlet input only. 30 min. *In progress.*
4. QA-05 P2: `tabIndex={0} role="region" aria-label` on the `DotGrid` scroller. 10 min. *In progress.*
5. CMP-607 P2: hide "Ik heb dit aangepast" on outlet findings (or prove the recheck runs). 30 min. *In progress.*
6. SEC-V07 P2: `loadProductLineDetail` passes `{ productLineId: line.id }` to `openFixesByFinding`. ~10 min. *Open, not in the running fix round; take it in the next pass.*
7. CMP-611 P2: without JS, move focus to the error summary. *Open.*
8. BLD-04 P2: the Playwright specs FE-01..03 ask for. *Open.*
9. SEC-V05 P3: `/api/report-email` refuses a line run. 5 min. *In progress.*
10. QA-06, QA-07, QA-08 P3: market order kept, Dutch question quoted as stored, back link to the line. *In progress.*

**Design**: no items. Phase 2 skipped (reason in `state.md`); axe 0 violations on five screens.

**Julian** (see `state.md`, Decisions needed): AC8 timing (QA-01), D1, D2, D5 (incl. CMP-606), CMP-608, SEC-V01
hotfix deploy, CMP-605 with the D1 terms change, CMP-609 lawyer question, D3/D4 as before, PR approval (L-74).

### Process misses, routed back

- **PROC-01 (brief vs phase-1 checklist).** AC8 required public surfaces that compliance's B3 forbade before build,
  and nobody reconciled them in phase 1; the clash surfaced as a P0 in phase 4. Ask to the analyst and the playbook
  template: a phase-1 "change before build" that contradicts an AC opens a brief amendment before build starts, and an
  AC may not depend on an open D-decision without naming the switch it ships with.
- **PROC-02 (controls).** The build did not show its concurrency tests red without the lock (deviation 6); QA found
  one that never fails (QA-02). The build template's "shown to fail without the change" line is to be enforced at
  build hand-off, not discovered at verify.
- Security and compliance already amended the standing lists (`docs/process/checklists/security.md`,
  `compliance.md`, and the playbook template for security).

### Next

Fix round r1 lands → **verify round 2** (QA, security, compliance, re-run of the controls and the SEC-V01 PoC).
If round 2 does not close SEC-V01, a decision memo follows. QA-01 closes only on Julian's AC8 answer.
