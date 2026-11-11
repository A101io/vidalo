# ADR-0005 — Competition is counted per question on the report and stays out of the dot; "wat doet X" is judged on criterium 11

*2026-11-11 · status: accepted (Q3 and Q4 are Julian's; built on the assumed answers in Amendment A5)*

## Context
For an online business the questions that matter are recommendation questions (who does AI name
for this category, which alternatives). Julian decided on 25 Oct 2026 that "niet genoemd" is not a
wrong fact and never colours the dot (`docs/CRITERIA.md`). AC-5 asks for counts per question
("n van m antwoorden"), up to 5 other names, up to 3 quoted sentences about the business, and no
score, percentage, position or judgement of a competitor. AC-6: an answer that calls the business
another kind of business is a criterium-11 finding at 1 of N, so a Sonable described as a shop at
Weena 705 is orange or worse; every-answer-right with zero mentions is green. Since 11 Nov 2026 a
question without a reference fact is never "klopt" and an engine with nothing checkable is grey
(`isUncheckedGrey`).

## Decision
- `RecommendationSummary` (built in `scanner/recommendations.ts`) gains `family`
  (`rec_town` | `rec_category` | `alternative`, from the prompt's template key / intent) and
  `quotes`: up to three sentences from that question's answers that name the business
  (`mentionsBusiness`) and none of the `others`, at most 240 characters, each with its engine.
  `others` keeps its top 5. Nothing else is computed: no share, no rank.
- The report page shows the competition block for `profile.mode === "online"` only, built in
  `apps/web/lib/report.ts` from `recommendations`; local reports keep "Wie AI wel noemt" unchanged.
- The online question "Wat doet {naam}?" probes `identity:kind`, criterium 11. Extraction yields
  `same` (described as the kind of business in `profile.offer`/`category`), `other` (described as a
  different kind) or the not-found sentinel. `factValue(facts, "identity", "kind")` returns `"same"`
  when `facts.profile.grounded`, else `null` (unchecked). `other` against `same` is wrong; criterium
  11's threshold is "any", severity verwarring → at least orange. The stipregel itself is unchanged.
- For `mode === "online"`, `mentionsBusiness` does not ask for the town on a one-word name, and
  `detectOtherEntity` skips its "in <other city>" test (the heading test stays): the town is not the
  identity of an online business.
- An online business with no grounded offer and no grounded website is judged on its existence
  answers only; the 11 Nov unchecked-grey rule applies to it unchanged and needs no exception.
- `docs/CRITERIA.md` is amended in the same PR: counts per question are shown; never a position,
  percentage, score or a "jij versus de buren" table; no promise to change who is named.

## Consequences
**Good:** the dot keeps meaning "are your facts right"; the competition block gives the online
owner what Julian asked for without a new kind of number; a mis-described business is caught.
**Bad:** an online business that AI never names but describes correctly is green, which may read
as odd next to "0 van 30"; the report must say why (copy, FE-02). Judging "same kind" is a model's
reading of a description, softer than a phone number.
**We can no longer:** show a trend of mentions or a position without reopening Julian's 25 Oct
decision and CRITERIA.md.

## Alternatives rejected
| Option | Why not |
|---|---|
| Count "not named" into the dot for online businesses | Reverses the 25 Oct decision; a correct business would turn red for a preference no one can fix |
| A share-of-voice percentage or "plek" | Forbidden by AC-5 and CRITERIA.md; under 1 % reproducible |
| Judge "wat doet X" against the offer from the AI lookup alone | Circular: the AI would be graded against itself; only a grounded offer is a reference |
| Quote sentences that also name competitors | Would put AI's judgement of a competitor on our page (AC-5 forbids judging competitors) |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
