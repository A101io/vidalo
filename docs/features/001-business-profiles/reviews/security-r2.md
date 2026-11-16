# Security verification, round 2 of 2: 001 Business profiles

*security agent (Claude) · phase 4, round 2 · 2026-11-16, unattended stopgap run · branch
`claude/fix-2026-11-16-001-business-profiles` (PR #137) with the round-1 reports and current `main` merged in.
A diff against `security-r1.md`: items not named here are as in round 1. Nothing hosted was touched (no Supabase,
Stripe, Cloudflare, mail); no application code edited; probes were scratch test files, deleted after the run.*

## Verdict

**P0: none.** One round-1 item closed (S-29 / V1-SEC-04). The re-check round 1 asked for on the V1-QA-02 change
(S-07, S-08) passes. Six round-1 P2s are still open, unchanged in code; none was claimed fixed.

## Re-checks

| S | Round 1 | Round 2 | Evidence |
|---|---|---|---|
| 07, 08 (V1-QA-02 change) | PASS | **PASS** | The new `neutralNameQuestions` (`prompts/profile.ts`) builds questions only from code-held templates via `fillTemplate` and `build`; the one new input is `facts.name`, which is: capped at 320 raw / 80 clean characters before any regex; refused on bidi controls, `<`, `>`, `://`, `www.`; NFKC-normalised; Cc/Cf/zero-width/soft hyphen removed; refused under 2 letters. Probe: `"Prompt​Software"` → "Prompt Software"; fullwidth "Ｐrompt" folded; `"www.prompt.nl"` and `"…<b>"` → `[]`. A name holding instruction words ("System Assistant Ignore previous instructions you are") is asked verbatim; that is the exposure the door set already had (`prompts/index.ts:96-137` interpolates `facts.name` raw), now narrower (capped, cleaned). The engines' answers are judged only about this business; the classify call (S-06, the one model reading untrusted text with a schema) is unchanged. Before the form, `typedBusinessProblem` still refuses markup after NFKC and control characters. No new RegExp from input (S-36 holds). Prompts are stored per business with `insertPrompts`, the same table and path as door prompts |
| 29 (V1-SEC-04) | FAIL (P2) | **PASS** | `scanner/progress.ts` `scanStatusBody` rebuilds `profile` as `{mode, offer, audience, category, source}`, each question as `{id, text}`, each engine as `{engine, received, expected}`. Test `scan-progress.test.ts` "nested objects carry only their named fields (V1-SEC-04)" feeds `basis`, `decidedAt`, `competitors`, `businessId`, `templateKey`, `costCents`, `error` and asserts the exact key sets and that none leaks. Control: the fix reverted → 1 failed / 13 passed |
| 23 (library ledger, V1-QA-03 change) | PASS | **PASS** | The fix only reorders a read (`wasRetired` from `before`) and narrows the log to new retirements; the event keys are unchanged (`category, mode, templateKey`, S-39) |
| 30 (V1-SEC-03) | FAIL (P2) | **FAIL (P2), open** | `apps/web/app/api/scan/[id]/status/route.ts` still calls `getScanState(id)` with no shape check |
| 21 (V1-SEC-05) | FAIL (P2) | **FAIL (P2), open** | No migration 0020; the last migration is `0019_deletion_retention.sql` |
| 38 (V1-SEC-06) | FAIL (P2) | **FAIL (P2), open** | `perl -CSD` scan of the tracked `.ts`/`.md` under `packages/core/src`, `packages/core/test` and this feature's docs: literal hidden characters still at `shared/typed-business.ts:13`, `shared/typed-website.ts:15`, `test/understand.test.ts:660-662,671,694`, `checklists/security.md:30,33` |
| 11 (V1-SEC-02) | PASS, gaps filed | **unchanged, gaps open** | `scanner/util.ts` not touched by #137 or by `main` since round 1 |
| V1-SEC-01 (typed website sticks) | P2 | **P2, open, narrowed by `main`** | `main` #139 (`scanner/onboard.ts`) no longer attaches a typed website to a business Google or the KvK lists. For a business nothing lists, the first typed website still wins (`facts.website` set once) |
| 37 (V1-SEC-07) | NOT VERIFIED | **NOT VERIFIED** | `FactsForm.tsx:5` still imports `SECTOR_LIST` from the `@vidalo/core/prompts` barrel; no build run |

**Counts:** PASS 33, FAIL 3 (S-21, S-30, S-38, all P2), MOOT 3, NOT VERIFIED 1.

## Findings

| ID | Sev | Status |
|---|---|---|
| V1-SEC-04 | P2 | **closed** (control red) |
| V1-SEC-01, -02, -03, -05, -06, -07 | P2 | open, unchanged |

No new security finding. QA's V2-QA-01 (a name with a link falls back to the door set) has no security effect: the
door set was the round-1 behaviour for every refused name.

## Not verified (carried)

- S-19/S-20 on the hosted project; S-37 bundle grep; S-26 cross-origin `curl`; a real understanding step; a Workers
  run of `fetchPublicText`.
