# 04 Build, frontend (FE-01 to FE-05)

*frontend · 21 Nov 2026 · against BE-01 (8fdd35e) on MemDb and the mock seed. Nothing committed. Backend tickets BE-02 to BE-06 were being built in the same worktree; the pages read only BE-01 names.*

## What was built
- `/app/productlijnen` (EN `/en/app/product-lines`): the list with an access banner, a limit sentence, the add form (`?nieuw=1`) and an `aria-live` message region; the nav item "Productlijnen"; per market one dot per AI system with its status in words, open errors, "genoemd als aanrader: n van m keer".
- `/app/productlijnen/[id]`: header with version and date, market links, latest check, errors with source and what we do, resolved errors as proof lines, "Wie AI wel noemt" (alphabetical, counts), progress (counts, engine grid, criterium grid), what we check (outlet links only after a render-time http(s) check), the status form.
- Form (`LineForm.tsx`) and actions (`actions.ts`, logic in `lib/product-lines.ts`): add, edit (version n+1), "Niet meer leverbaar" / "Weer actief".
- `/app/fouten/[id]` for a line finding (line heading, wording for the four keys, "niet in je lijst" heading for an outlet); "Dit klopt wél" goes to the line's edit form; `/r/[id]` answers 404 for a line run.
- Legal text 21 Nov 2026 (terms: Gegevens; privacy: paid plan, per-market questions, not published, sources outside NL), `legal:lock` run; `docs/processors.md`, `docs/records-of-processing.md`, CRITERIA, ARCHITECTURE, MESSAGING, cost-per-client, repo CLAUDE.md.

## Deviations (each one a decision for the architect or Julian to confirm)
1. **Server-side form errors do not redirect.** The action returns the errors and the typed values as state (`useActionState`), so a refusal never empties the form and no typed value reaches a URL (WCAG 3.3.7, L-16, L-62). `?fout=` is still produced for access refusals and the reactivation limit (`fout=toegang:<reason>`, `fout=limiet`) and is rendered through an allow-list. The ticket's `fout=limiet` on a new line therefore shows as the same sentence without the query key.
2. `loadProductLines(business, db)` and `loadProductLineDetail(id, business, db)` take the db as a parameter (pages pass `ready()`), so a test can run them on a MemDb.
3. New export `@vidalo/core/shared/product-lines` in `packages/core/package.json`: the client form imports only that module (no db, no env), security S-33. The `copy.productLines` copy lives in `copy/product-lines.ts` and `product-lines.en.ts` (as `owner-area`), wired by one line in `index.ts` and `en.ts`.
4. `DotGrid` is a new component (the grids of `/app/voortgang`, plus the colour in words). `/app/voortgang` was left untouched to avoid a conflict with the corporate branch; the two copies can be merged when that branch lands.
5. Reading is off when the launch switch is off: no nav item, the list shows the access banner `not_enabled` and reads nothing, the detail answers 404 (compliance B3, L-42).
6. Not done: S-13 (cap on versions saved per day), the Playwright specs and an axe run (FE-01 to FE-03 ask for them), and the "tests shown to fail without the change" proof beyond the new tests being new.
7. `no-preticked-boxes.test.ts` gained one allow-list entry for the markets boxes (they show the line's own choice; a new line starts with none).

## Findings for others
- **Backend / seed (blocks the browser check of line dots):** `seedOwnerArea` (`apps/web/lib/demo-owner-area.ts`) ends with `backfillRunSummaries(db, { all: true })`. That rebuilds every run's summary from the business facts, so the seeded line runs lose their summaries (all dots grey, "genoemd als aanrader" gone). Until BE-04 rebuilds a line run from its own facts, `all: true` should skip line runs. I verified the pages with that call set to `all: false` and put it back.
- The seeded held fix has no `email` evidence object, so the finding page shows no "correctiemail in de wachtrij" line (AC4 wants that as evidence); BE-05 or the seed should add it.
- `fixPathForFinding` for a line finding returns the business path wording until BE-05 (ADR-0014).

## Follow-up list for Julian (verbatim from FE-05)
1. `/organisaties` and the corporate pricing (unmerged branch): add "in je dashboard" and the line wording once both are on main.
2. Terms: a sentence on what a line includes (limit, markets, monthly check), after D1/D2, with `legal:lock`.
3. D4: apply 0020 to `bbynmqvaxpjdnkaasutd` after approval, then run `scripts/rls/product-lines.sql` there.
4. Report statuses and square marks: the line pages take the corporate pass when it merges.

AC8 surfaces added by compliance (B7): terms (done here, L-01), privacy (done here, L-02), `docs/processors.md` and records (done), data export (BE), `legal.test.ts` (passes; `example` was already in `NOT_RECIPIENTS`). Julian approves the PR before merge (L-74).

## What I checked in the browser
Own dev server from this worktree (port 3100, mock, demo owner). Desktop (about 800 px pane) and 375 px: list, detail (NL and BE tabs), edit form, a finding, EN pages. See the report for the observations and what was not checked.
