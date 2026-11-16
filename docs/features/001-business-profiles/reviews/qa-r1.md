# QA verification, round 1 — 001 Business profiles (phase 4)

*qa agent (Claude) · 2026-11-15, unattended night run · branch `claude/verify-2026-11-15-001-business-profiles`
(= `main` `1cf3de5` plus docs and the QA tests below). Against `01-brief.md` (Amendment A wins where it
conflicts; ADR 0007 replaces the AI lookup). Mock mode only: no API keys, nothing live, no hosted database,
no mail. The security and compliance reviews of this round are not redone here.*

## Verdict

- **P0: none.** No acceptance criterion fails in a way that harms a customer's data, money or legal position.
- **Criteria (8 original + 10 of Amendment A = 18 rows):** 10 pass (AC-A7 with a defect), 2 pass as amended
  (AC-1, AC-4), 1 fail (AC-A3), 5 partly or not verifiable here (AC-2, AC-7, AC-A1, AC-A9, AC-A10).
- **Findings:** 2 × P1 (V1-QA-02, V1-QA-03), 2 × P2 (V1-QA-01, V1-QA-04).

## Runs (observed counts, 15 Nov 2026, 23:10–23:20 UTC)

| What | Result |
|---|---|
| `pnpm install` | done, lockfile unchanged |
| `pnpm -r typecheck` | core, web, worker: all three `Done`, no errors |
| `pnpm -r test` | core **96 files, 1431 passed, 23 skipped (1454)**; worker **7 files, 52 passed** |
| `pnpm e2e:mock` | **OK e2e-mock**: 60 jobs; baseline stip rood, 34 findings, 34 fixes, 17 channels, 12 mails; not-found case 2 wrong / 17 not found of 24; online case "Vloedlijn Music, Utrecht": mode online, 12 answers, stip rood |
| Feature tests only (`vitest run` on qa-001-*, online-questions, understand, report-online, online-judging, copy-profiles, online-templates, question-library, scan-progress) | **11 files, 243 passed** (the three `it.fails` in qa-001 pass because the defect is still there) |
| AC-3 snapshot regenerated independently | git worktree of `5a1a40e`, its own `generatePrompts` / `selectFreeScanPrompts` / `promptsForFullScan` on MemDb, the same seven fixtures: **21 of 21 sets identical** to `test/fixtures/questions-5a1a40e.json` (free 6 each; full 31/20/33/30/30/25/29) |
| Playwright, mock (`qa-001-online`, `scan-website`, `profile-correction`, `a11y`), Chromium of the container via a scratch config (the repo pins Playwright 1.64.1, whose headless shell is not installed here; config not committed) | run 1: **30 passed, 4 failed**; two failures were QA's own spec (below), one `/vak/horeca` was the known cold-compile reload (CLAUDE.md). Run 2 after fixing the spec: **16 passed, 1 failed** (the waiting-page check, now `fixme`, see AC-A9) |

The spec fixes (commit `d8225b8`): the "no town" check now reads the question lines of the competition block only;
before, it also read the mock engines' competitor names ("Bos & Zn Utrecht"), which are mock data
(compliance V1-COMP-06b). The waiting-page check is `test.fixme`: in mock mode the scan has finished
before the page renders, and a second request for the `/scan/<token>` hop answered not-found.

## Criterion by criterion

| AC | Status | Evidence |
|---|---|---|
| AC-1 profile chosen on `/scan/kies` | **pass as amended** | Replaced by A1 (no choice for the visitor) and ADR 0007 (a website field only when Google has no listing). `e2e/scan-website.spec.ts`: 7 desktop + 1 mobile passed (field shown for an unlisted business with one small button and a way on without it, refused value next to the field and not echoed, valid website read, no website still runs, English, 375 px with 44 px targets, axe NL+EN with and without an error) |
| AC-2 Sonable free check: 6 online questions | **pass (mock); real run not verifiable** | `qa-001-online-free.test.ts` through `prepareBusiness` + `runScan`: with `https://sonable.io`, 6 questions: "Bestaat Sonable nog?", "Wat doet Sonable?", "Wat is de website van Sonable?", "Wat is een goed alternatief voor Sonable?" and 2 category questions without the name; none matches the shop-front pattern or any of `NL_CITIES`. Without a website: the neutral 3 (ADR 0007), so "6 questions" holds only with a website, by design. Not verified: a real check of Sonable (no keys here; compliance C-39) |
| AC-3 local businesses keep their questions | **pass** | `online-questions.test.ts` door snapshot (7 fixtures × door profile and no profile) and visit (address, pinnen and, without an open day, hours removed); my independent regeneration on `5a1a40e`: 21 of 21 identical. The kapper case with Google type `hair_care` and a listing stays door when the classifier says online (`understand.test.ts:138`). `e2e:mock` green |
| AC-4 full check asks about competitors | **pass as amended** | Owner-entered competitors are out of this cycle (A5, A6). `online-questions.test.ts:187` full set at most 13, never the town; `:206` the business itself is never a competitor; `:211` without profile competitors the three most named in the previous online scan are used. Competitors never judged: `online-judging.test.ts:139,152` (no quote that names another business), `qa-001-dot.test.ts` (answers naming Mood Media and Soundtrack Your Brand give 0 findings) |
| AC-5 competition block with counts | **pass** | View model: `qa-001-online-free.test.ts` on a report the scanner built (not the demo): per question `answers` = samples of that question, named ≤ answers, ≤ 5 others, ≤ 3 quotes each with an engine, the summary adds up, no `%`, `#n`, plek, score, rank or position in NL and EN, local "Wie AI wel noemt" empty. Browser: `qa-001-online.spec.ts` passed for a real mock online report NL and EN ("Genoemd in 8 van 12 antwoorden", per question "n van 4") and the demo `/r/voorbeeld-online` NL and EN. Quote quality: V1-QA-04 |
| AC-6 dot by the stipregel, competition outside it | **pass** | `qa-001-dot.test.ts` on the real online question set (`loadPrompts`, 6 questions): named in every or in no category answer gives the same dot (groen) and 0 findings; one answer of five calling Sonable "een winkel aan de Weena 705 … op zondag open" gives a criterium-11 finding and oranje or rood. Also `online-judging.test.ts:205,221` |
| AC-7 NL+EN, banned words, surfaces | **partly: strings pass, surfaces fail** | Typecheck green (copy shape). `online-templates.test.ts` (NL/EN item for item, slots, no town or jargon) and `copy-profiles.test.ts` (keys in both languages, no `!`, banned words, promise pattern) pass. Surfaces: compliance found `docs/CRITERIA.md:10` and `:96`, `docs/ARCHITECTURE.md:5` stale (V1-COMP-02) and no surface table in PR #120 (V1-COMP-04); I confirm by reading and do not re-file them |
| AC-8 accessibility | **pass (axe + keyboard by test); manual keyboard pass not done** | axe, no serious or critical: `/scan/kies` website field NL+EN with and without an error (`scan-website.spec.ts:107`), `/app/gegevens` profile group NL+EN with and without an error (`profile-correction.spec.ts:171`), `/r/[id]` competition block on a real mock report and the demo, NL+EN (`qa-001-online.spec.ts`). Keyboard: `profile-correction.spec.ts:186` (radio group one tab stop, fields in order, focus visible, Enter saves) passed. The competitor field of the original AC-8 is out of scope (A5). Not done: a hand keyboard pass of the competition block (it has no controls) |
| AC-A1 Sonable read as online | **pass (mock); real run not verifiable** | `understand.test.ts` (Sonable from sonable.io: one page, one classification, no search, mode online stored); `qa-001-online-free.test.ts` mode online, source auto; no shop-front question. Real: see AC-2 |
| AC-A2 kapper with a listing is door | **pass** | As AC-3 |
| AC-A3 never blocks; no listing falls back to the online/neutral set | **fail** | V1-QA-02: a business without a listing whose name contains a word on the instruction list ("Prompt Software", Utrecht) is asked today's shop-front set ("Is Prompt Software in Utrecht op zondag open?", "…pinnen?", "Wat is het adres…") and gets a coloured dot. The control "Plain Software" gets the neutral 3. Test `qa-001-online-free.test.ts` (`it.fails`). The step itself never blocks (`understand.test.ts:166-247`) |
| AC-A4 deterministic in mock | **pass** | `e2e:mock` OK, Playwright as above; the mock understanding step returns a fixed profile (`understand.ts:240`) |
| AC-A5 free online set of 6 | **pass** | As AC-2 |
| AC-A6 "wat doet X" judged as same / other kind / not found | **pass** | `online-judging.test.ts:53-89`; criterium 11 in `qa-001-dot.test.ts` |
| AC-A7 library learns | **pass, with a defect after retirement** | `question-library.test.ts` (MemDb here; PgDb half skipped without `TEST_DATABASE_URL`, run by security on a local Postgres: 64 passed). After a retirement the ledger write throws: V1-QA-03 |
| AC-A8 slot values cleaned or refused | **pass** | `online-questions.test.ts:221-253` (markup, URL, instruction never reach an engine); security S-01/S-02 controls |
| AC-A9 waiting page shows real steps | **not verifiable in the browser here; pass by reading and unit test** | `scan-progress.test.ts` (typed stages from the scan's events, no timers); `ScanProgress.tsx:107` `aria-live="polite"`; `scan/[id]/page.tsx:27-30` noscript refresh after 5 s. In mock mode the scan finishes before the page renders, so no browser saw the steps (V1-QA-01) |
| AC-A10 design G, no jargon | **not verified (waiting page); pass for strings** | Banned-word tests pass. No screenshot of the waiting page at desktop and phone width was taken this round (V1-QA-01) |

## Findings

| ID | Sev | Lane | Claim and evidence | Fix | Cost |
|---|---|---|---|---|---|
| V1-QA-02 | P1 | backend | **AC-A3 fails for a name with an instruction word.** `typedBusinessProblem` lets "Prompt Software" through (an honest name, S-04). With no listing the step falls back to online/neutral; every neutral template needs the name slot; `sanitizeSlot(name)` refuses "prompt" (`prompts/slots.ts:10-15,40`), so no online question is left, and `runScan` (`scanner/index.ts:269-270`) then asks the local door set with the town. Observed: 6 questions incl. "Is Prompt Software in Utrecht op zondag open?", "Kan ik bij Prompt Software in Utrecht pinnen?", "Wat is het adres van Prompt Software in Utrecht?", stip not grijs. Words on the list ("systeem", "assistant", "prompt", "opdracht", "system") occur in real Dutch trade names. Test: `qa-001-online-free.test.ts` "AC-A3 … (fails today, V1-QA-02)" | When the profile is online and no template survives, fall back to the neutral set with the name as the door set already sends it (the name reaches engines verbatim in today's door questions, so refusing it in the online set protects nothing); never to the door set for a business without a listing. Flip the `it.fails` to `it`. Security re-checks S-07/S-08 on the change | 30–45 min |
| V1-QA-03 | P1 | backend | **The library write throws after the first retirement in a category.** `prompts/library.ts:184` builds `wasRetired` from a filter that reads `wasRetired` itself (temporal dead zone): as soon as `before` holds a retired row, every later scan in that category throws a `ReferenceError` after `recordQuestionUse`; the catch logs `library.record_failed` (`:191`). Effects: a second template that retires later is never logged as `library.retired`; every scan logs a false failure, which hides a real write failure. The rows are still written and the CLI list (`cli/library.ts`) reads the view, so Julian's list stays right. The existing "logs it once" test passes only because of the throw. Tests: `qa-001-library.test.ts` (2 × `it.fails`, control and "observed today" pass) | `const wasRetired = new Set(before.filter((r) => libraryStatus(r) === "retired").map((r) => r.templateKey))`, then log only `after` rows that are retired and not in `wasRetired`. Flip both `it.fails` to `it` | 15 min |
| V1-QA-04 | P2 | backend | **A quote can be the business's name only.** On the real mock online report every "Wat AI over jou schreef" quote was `“Vloedlijn Music …”`, the list line holding the name and nothing else (Playwright run 1, block text). AC-5 asks for sentences "in which AI describes the business". With mock list answers this is mock data, but a real numbered list ("1. Sonable") gives the same | In `scanner/recommendations.ts`, keep a quote only when it has at least a few words besides the name (e.g. 3 letters-words after removing the name and list markers); test with "1. Sonable" (dropped) and "Sonable levert muziek voor hotels" (kept) | 20 min |
| V1-QA-01 | P2 | frontend | **The waiting page was not seen working in a browser.** AC-A9/A10 are verified by reading and `scan-progress.test.ts` only; in mock mode the scan is done before `/scan/[id]` renders, and the browser check is `fixme` (`qa-001-online.spec.ts:66`). FE-01's own Playwright run (04-build) is the last browser evidence | Give the mock scan a delay switch for tests (e.g. `VIDALO_MOCK_DELAY_MS` read only when `VIDALO_MOCK=1`), then un-fixme the check: live region, steps, reduced motion, 375 px screenshot NL and EN | 1 h |

Not filed (seen, no defect against the brief): the competition block's "Ook genoemd" names in mock mode carry the
town ("Jansen Utrecht"); compliance V1-COMP-06b covers it.

## Not verified here

- A real free check of Sonable and the real understanding step against OpenAI and a live website (no keys; ADR 0007
  asks for one per release; compliance C-39).
- PgDb halves of the feature tests (skipped without `TEST_DATABASE_URL`; security ran them on a local Postgres).
- The full Playwright mock suite (only the four feature specs above), the gate suite, and a production build.
- Success metrics (need live data).
