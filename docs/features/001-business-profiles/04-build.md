# 04 — Build log

## BE-01 — Contract: types, Db signatures, MemDb (2026-11-11)

**What.** The interface contract of `02-architecture.md` in code. No scanner behaviour changes.

**Where.**
- `packages/core/src/types.ts`: `ProfileMode`, `ProfileBasis`, `ProfileConfidence`, `BusinessProfile`, `ProfileSummary`, `QuestionFamily`; `RecommendationIntent` + `"alternative"`; `INTENT_SUBJECT.alternative`; `Prompt.templateKey`, `Facts.serviceAreaOnly`, `Facts.profile`, `ScanRun.profile`, `RecommendationSummary.family` / `.quotes`, `ScanReport.profile`. `RECOMMENDATION_INTENTS` is unchanged on purpose (it drives bank rotation; `alternative` is not a per-sector intent).
- `packages/core/src/scanner/progress.ts`: `ScanStage`, `ScanJobState` v2 (`steps` kept as optional, deprecated). `persistScanState` / `readScanState` carry the new fields; a state stored without `stage` reads as `ask` with empty lists.
- `packages/core/src/scanner/index.ts`: `ScanProgress` gains `profile`, `questions`, `escalate`; `start.perEngine`. Nothing emits the new events yet; `start` emits `perEngine: {}` (BE-07 fills it).
- `packages/core/src/db/types.ts`: `BusinessRecord.profileAuto/profileOwner`, `ScanRunCreate.profile`, `QuestionUseInput`, `LibraryRow`, `Db.setAutoProfile/setOwnerProfile/recordQuestionUse/questionLibrary`.
- `packages/core/src/db/mem.ts`: all four methods in full; `upsertBusiness` skips both profile fields; `createScanRun` stores `profile`.
- `packages/core/src/db/pg.ts`: **stubs only** (`throw new Error("BE-02")`), and `mapBusiness` returns `null` for both profile fields until BE-02 reads the columns.
- `packages/core/src/prompts/slots.ts` (`sanitizeSlot`, `SLOT_LIMIT`), `packages/core/src/scanner/understand.ts` (`effectiveProfile`, `parseOwnerProfile`); re-exported from `prompts/index.ts` and `scanner/index.ts`.
- Compile-only edits outside core: `apps/web/lib/core.ts` (`createScanState` fills the new state fields), `apps/web/app/scan/[id]/page.tsx` (`steps ?? []`), `apps/web/lib/demo.ts` (`family`, `quotes` on the demo recommendation); `scanner/recommendations.ts` sets `family` (`alternative` when the intent is, else `rec_town`) and `quotes: []` until BE-06.

**How verified.** `packages/core/test/profile-contract.test.ts` (33 tests). Each guarantee was removed in turn and the test went red, then restored: the profile-field guard in `upsertBusiness` (1 failed), the `(scanRunId, templateKey)` dedupe (1), the instruction-word filter (6), the domain filter (2), competitors taken from owner instead of auto (1), the too-long check (3 of the 4 `too_long` cases; the 4th, `mode`, has no length). `corepack pnpm -r typecheck` green; `corepack pnpm -r test` green (core 957, worker 24); `corepack pnpm e2e:mock` OK. Not verified: PgDb (stubs; BE-02).

**Judgement calls.** `parseOwnerProfile` takes an optional third argument `now` (default `new Date()`) so a test never depends on the clock; the contract's two-argument call still works. Order of checks per field: required, then refused (mode), too_long (raw length), then refused (sanitiser). The first failing field in the order mode, offer, audience, category is returned.
