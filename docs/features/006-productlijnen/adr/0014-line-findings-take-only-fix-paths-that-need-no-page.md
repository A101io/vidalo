# ADR-0014 — Line findings take only the fix paths that need no page of ours

*2026-11-21 · status: accepted*

## Context
`fixer/paths.ts` picks one path per source type. Several paths act on things a product line does
not have: republishing the facts page (`owned_facts_page`, `other_entity`, not found, not named)
and syncing Google, Bing, Apple and the directories (`directory_api`, not found). The facts page
lists no product lines (not in the brief), so republishing it for a line would store evidence of
an action that cannot change the answer. The owner-website path (mail the owner the text to
change) and the third-party path (a correction mail in the owner's name) work for a product as
they do for a business.

## Decision
- `fixPathFor` reads the finding's `productLineId`; for a line finding:
  - `owned_website` → today's owner-website path;
  - `third_party`, `directory_api`, `directory_form` → today's third-party correction path;
  - `owned_facts_page`, `other_entity`, `none`, verdict `not_found`, and recommendation evidence →
    `LINE_KEEP_CHECKING_PATH`: action `none`, recheck after 30 days, unfixable after 60, wording
    "We hebben geen pagina waarmee we dit voor je productlijn kunnen verbeteren. We blijven elke
    maand controleren." (NL + EN).
- `isFindabilityFinding` is false for every line finding, so `openFixForFinding` never publishes,
  syncs or discovers directories for one.
- Rechecks of line findings run as line runs (the finding's scope), with the same 5-then-10 rule.

## Consequences
**Good:** no false evidence; the owner sees plainly when we cannot act; "Ik heb dit aangepast" works
for every line finding, because it only pulls the recheck forward.
**Bad:** not found and not named on a line have no remedy until Vidalo publishes something for
lines; those findings will often end as "unfixable" after 60 days.
**We can no longer:** route a line finding through a channel sync without first giving lines a
channel and a path of their own.

## Alternatives rejected
| Option | Why not |
|---|---|
| Today's paths unchanged | Republishes the business's facts page and syncs Google for a product; the evidence would claim a remedy |
| Publish line facts on the facts page | Not in the brief; it changes the publisher, the JSON-LD and the legal texts |
| No fixes at all for line findings | The owner-website and correction paths work and are what AC4 asks for |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
