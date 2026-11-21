# ADR-0010 — A product line is scanned as its own run per market, inside runScan

*2026-11-21 · status: accepted*

## Context
Feature 006 asks the AI systems about a manufacturer's product lines: category recommendations,
specifications, certificates, where to buy, successors, per market in that market's language,
with the existing sampling rules. The owner sees per line and per market a dot per AI system,
open errors, "genoemd als aanrader" and a trend; the monthly mail gets a section per line.
Today one `runScan` per business does sampling, comparison, the dot (`computeStip`), the report,
the run summary (ADR-0007 of 002) and the progress snapshot, and the fixer and rechecks call it
again with `promptIds`. All of it reads a `Facts` object. The business dot must not move because
of a product line.

## Decision
- A line is scanned as **one `scan_run` per (line, market)**, by `runScan` with `productLineId`
  and `market`. There is no second scanner and no second copy of the sampling rules.
- The line reaches `compare()`, `computeStip()` and the report as an **in-memory `Facts` view**,
  `lineFacts()` in `scanner/line.ts` (the same device as `withCountry()` / `withProfile()`): the
  line's name, no place, `country = market`, empty business lists, and `productLine:
  LineFactsView`, from which four new fact keys (`spec`, `certificate`, `outlet`, `successor`)
  take their expected values. Category recommendations reuse the recommendation path (named or not,
  never a position, never a finding).
- Line runs are enqueued by the monthly cron in the same pass as the business's check, one job per
  (active line, market), gated in `paidOnlyBlock`. The monthly report job waits for them: at most 8
  times 15 minutes, then it sends with what exists and says "nog niet gecontroleerd" for the rest.
- A line run skips the understanding step, the question library and bank promotion.

## Consequences
**Good:** the report, the dot, the summary, the trend, rechecks and the finding page work for a
line with a handful of branches; a line's colour is computed exactly like a business's; the
business run never sees a line question, so its dot and counts are unchanged by construction.
**Bad:** the `Facts` view is a disguise: code that reads `facts.name` or `facts.place` for a
business purpose (namesake detection, mention matching) must recognise `productLine` and behave
(two named changes in `extract.ts`). Four runs a month per business at the provisional limits;
the monthly mail can arrive up to two hours later.
**We can no longer:** ask a line question inside the business's own check, or show a single
"line" dot that spans markets without combining per-market runs in the page.

## Alternatives rejected
| Option | Why not |
|---|---|
| Line prompts inside the business's monthly run, findings tagged with the line | Every reader of the business report, the dot, the summary and the progress view would have to filter line rows out, and one missed filter changes the business's colour |
| A separate `runLineScan` with its own sampling and comparison | Two places for `FIRST_SAMPLES`, escalation and the thresholds; they would drift |
| One run per line covering all markets | One run has one language and one user location; the stip and report would have to be split by market afterwards |
| The report chain: each line job enqueues the next, the last one the report | A failed or deferred line job breaks the chain and the mail never goes |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
