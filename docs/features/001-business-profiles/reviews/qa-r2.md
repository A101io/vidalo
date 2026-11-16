# QA verification, round 2 of 2 — 001 Business profiles (phase 4)

*qa agent (Claude) · 2026-11-16, unattended stopgap run (03:30 verify slot) · branch
`claude/fix-2026-11-16-001-business-profiles` (PR #137) after merging the round-1 reports (PR #135 branch) and
current `main` (`b92675c`, #121, #133, #138, #139) into it. A diff against `qa-r1.md`: only what changed is
written out. Mock mode only: no keys, no hosted database, no mail, nothing live.*

## Verdict

- **P0: none.** **P1: none open** (V1-QA-02 and V1-QA-03 closed, both proven by control).
- **Criteria (18 rows):** 11 pass (AC-A3 moves from fail to pass), 2 pass as amended, 5 partly or not verifiable
  (unchanged from round 1: AC-2, AC-7, AC-A1, AC-A9, AC-A10).
- **Findings:** V1-QA-02, V1-QA-03, V1-QA-04 fixed; V1-QA-01 (P2) still open; one new P2, V2-QA-01.

## Runs (observed counts, 16 Nov 2026)

| What | Fix branch alone (`41aeb4f`) | Fix branch + current `main` (`722f991`) |
|---|---|---|
| `pnpm install --frozen-lockfile` | exit 0 | exit 0 |
| `pnpm -r typecheck` | core, web, worker `Done` | core, web, worker `Done` |
| `pnpm -r test` | core **96 files, 1433 passed, 23 skipped**; worker **7 files, 52 passed** | core **102 files, 1478 passed, 23 skipped**; worker **7 files, 52 passed** |
| `pnpm e2e:mock` | **OK e2e-mock**: 60 jobs, baseline rood 34 findings; not-found 2 wrong / 17 of 24; online "Vloedlijn Music" mode online, 12 answers, rood | **OK e2e-mock**: same counts, plus the new free-scan line (6/12 wrong, rood) |
| Feature tests by name (12 files: qa-001-*, scan-progress, online-judging, online-questions, understand, question-library, report-online, copy-profiles, online-templates, legal) | | **12 files, 269 passed**, no `it.fails` left in `qa-001-*` |
| Playwright `e2e/qa-001-online.spec.ts`, desktop, container Chromium via a scratch config (not committed) | | first run: 2 failed (the spec's form flow was stale, see below), 2 passed; after the spec fix: **4 passed, 1 fixme** |

**Controls (each fix reverted on its own, its test run, then restored):** V1-QA-03 (`032a3b0` src reverted):
`qa-001-library.test.ts` **3 failed / 1 passed**. V1-QA-02 (`d70267d` `scanner/index.ts` reverted):
`qa-001-online-free.test.ts` **2 failed / 4 passed**. V1-SEC-04 (`663a79d`): `scan-progress.test.ts` **1 failed /
13 passed**. V1-QA-04 (`3ba44dd`): `online-judging.test.ts` **1 failed / 21 passed**. The tests guard the fixes.

**Spec drift (test-only, commit `bbb6898`).** Since round 1, `main` asks for a postcode or website on the landing
form (#139, "never pick a business by name alone") and starts a free check only from the confirmation link (#121).
`qa-001-online.spec.ts` now fills `identity` with a postcode Google does not know (as `scan-website.spec.ts` does)
and calls `confirmCheck`. Not a product defect.

## What changed per criterion

| AC | Round 1 | Round 2 | Evidence |
|---|---|---|---|
| AC-A3 never blocks; no listing → online/neutral set | fail | **pass** (residual P2 V2-QA-01) | "Prompt Software" (no listing, Utrecht) is asked exactly "Bestaat Prompt Software nog?", "Wat doet Prompt Software?", "Wat is de website van Prompt Software?", stip grijs (`qa-001-online-free.test.ts`, `it` instead of `it.fails`). Control red on old code |
| AC-A7 library learns | pass with a defect | **pass** | After a retirement, later scans log no `library.record_failed`, write their rows (+4 asked on `online.alt.self` over two scans), and the retirement is logged once; a second template retired later is logged too (2 × `library.retired`). `qa-001-library.test.ts` 4/4 |
| AC-5 competition block | pass | **pass** | Browser rerun on `main`'s flow: real mock online report NL and EN, "n van m", no rank, no town in the block's questions, axe clean; demo NL/EN pass. Quote quality: a list line that is only the name is no longer quoted (V1-QA-04, `online-judging.test.ts` "drops a line that is only the name"; a quote needs 3 words besides name and town) |
| AC-8 accessibility | pass (axe + keyboard by test) | **pass** for the competition block (axe NL+EN on the rerun); the `/scan/kies` and `/app/gegevens` specs were not rerun this round | |
| AC-A9 / AC-A10 waiting page | not verifiable in a browser | **unchanged**: still `test.fixme`, V1-QA-01 open (frontend lane did no round-1 fixes) | |
| All others | as `qa-r1.md` | unchanged; covered by the full suite and `e2e:mock` above | |

## Findings

| ID | Sev | Status | Note |
|---|---|---|---|
| V1-QA-03 | P1 | **closed** | as above, control red |
| V1-QA-02 | P1 | **closed** | as above, control red; security re-checked S-07/S-08 (security-r2.md) |
| V1-QA-04 | P2 | **closed** | control red |
| V1-QA-01 | P2 | open | unchanged; frontend lane |
| **V2-QA-01** | P2 | **new** | **AC-A3 residual: a name with a link and no listing still gets the shop-front set with the town.** Probe on `neutralNameQuestions` (scratch test, deleted): `"www.prompt.nl"` and `"Prompt Software <b>"` return `[]`, so `runScan` (`scanner/index.ts`, V1-QA-02 branch) falls back to `loadPrompts(…, null)`: the door set with the town. `typedBusinessProblem` refuses markup at the form, so only a name containing `www.` or `://` reaches this on the free check. Fix: in `neutralNameQuestions`, strip `www.`, the scheme and the top-level domain (so `www.prompt.nl` becomes "prompt") and ask the neutral set with what is left; only when fewer than 2 letters remain, fall back as today. Test with `www.prompt.nl` (neutral set, no town). Cost: 30 min. Not a P1: rare input, the questions are still about the named business, nothing is stored wrongly. |

## Not verified here (carried)

- A real free check of Sonable and the real understanding step (no keys).
- PgDb halves of the feature tests (`TEST_DATABASE_URL` not set this run).
- The waiting page in a browser (V1-QA-01); the rest of the Playwright mock suite; the gate suite; a production build.
- Note for the toolchain: the Next dev server stopped twice at start with an upgrade notice before serving; a plain retry
  started it. Logged as an observation, nothing was upgraded (not in this run's scope).
