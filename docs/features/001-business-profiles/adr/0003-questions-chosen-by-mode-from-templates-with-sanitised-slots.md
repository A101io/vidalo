# ADR-0003 — Questions are chosen by profile mode; online questions come from code-held templates with sanitised slots

*2026-11-11 · status: accepted*

## Context
`prompts/index.ts` builds today's questions for a business with a door in a town; the 11 sector
packs add to them and never remove. Amendment A2 gives a table of question families per mode.
AC-3 and AC-A2: a `door` business gets main's questions text for text (snapshot at `5a1a40e`;
the prompt generators have not changed since). Model-written text may never become a question
(A3); slot values must be cleaned or refused (AC-A8). Every new pack must exist in Dutch and
English item for item (AC-7). Stored prompts persist per business, and a profile can change
(owner correction), so a stored question of the old mode must not be asked under the new one.

## Decision
- **`prompts/profile.ts` is the one place that decides whether a question applies**:
  `familyOf(prompt)` derives the family from `templateKey`, `kind`, `category` and `intent`
  (no column), and `applies(family, profile, facts)` implements the A2 table:

  | family | door | visit | online |
  |---|---|---|---|
  | existence | yes | yes | yes (town-free template) |
  | hours | yes | when `facts.hours` has an open day | no |
  | address | yes | no | no |
  | payment | yes | no | no |
  | phone | yes | yes | when `facts.phone` is known (town-free template) |
  | website | yes (today's question) | yes (today's) | yes (town-free template) |
  | what (`identity:kind`) | no | no | yes |
  | rec_town | yes | yes | no |
  | rec_category | no | no | yes |
  | alternative | no | no | yes |
  | other (service, price, policy, area, urgency, credential, identity) | yes | yes | no |

- **door**: `loadPrompts` runs today's code unchanged, with one added filter that drops stored
  prompts whose `templateKey` starts with `online.` (a no-op for every business that never was online).
- **visit**: today's generators, then `applies()` filters; no replacement questions.
- **online**: `onlineQuestions(profile, facts, kind, library, competitors)` fills templates from
  `prompts/online.ts` (Dutch) or `online.en.ts` (English, by `scanLang`); missing ones are stored
  with `templateKey`; the scan asks the stored rows whose text matches; no bank rotation.
  Free: existence, what, website, two `rec_category`, one `alternative` (AC-A5). Full: two existence,
  what, website, phone if known, four `rec_category`, `alternative` for the business, and one
  `alternative` per competitor in use (≤ 3). At most 13.
- **Templates** are objects `{key, family, intent, nl, en, slots}`; text uses `{naam}`,
  `{categorie}`, `{doelgroep}`, `{concurrent}` and grammar helpers (`welkFor`/`deBesteFor` on the
  head noun: the words before the first " van | voor | met | in | uit "). `online.en.ts` must hold
  the same keys in the same order (test like `sectors-en.test.ts`).
- **`prompts/slots.ts` `sanitizeSlot(raw, slot)`** is the only producer of slot values:
  Unicode NFC; refuse (null) when the raw text holds `<`, `>`, `://`, `www.`, a domain-shaped token
  (`/\b[\p{L}\d-]+\.[a-z]{2,}\b/iu`, except for the slot `name` where a dot inside a brand is kept)
  or an instruction word (NL/EN list: negeer, vergeet, instructie, systeem, prompt, opdracht,
  ignore, disregard, forget, instruction, system, assistant, "je bent", "you are", "act as");
  then keep only letters, digits, spaces and `&'-.`; collapse spaces; trim; refuse when fewer than
  two letters remain; cut at a word boundary to the slot's limit (name 80, category 60,
  audience 80, offer 120, competitor 60). A template whose slot is refused is skipped.
- **Prompt injection containment**, in layers: (1) the questions sent to AI systems are fixed
  templates plus sanitised slots, nothing else; (2) untrusted page and answer text only reaches
  the classification call, as JSON data, in a call with no tools (ADR-0002); (3) slot values are
  short, filtered and length-capped, and the stored profile has DB CHECKs as backstop; (4) the
  lookup is one per check and inside the existing free-check caps.

## Consequences
**Good:** AC-3/AC-A2 hold by construction (door runs main's code path); one function answers "is
this question asked for this business"; a business that changes mode stops being asked the old
mode's questions without deleting history.
**Bad:** one online template set instead of the three packs the original brief listed (online
service, webshop, B2B software): the category slot carries the difference; a webshop gets the same
question shapes as a SaaS. A legitimate name with a dot (a domain-named brand) is refused as a
competitor slot.
**We can no longer:** ask an online business about services, prices or policies from its facts in
this cycle (the A2 table does not list them), or have an online business in a sector pack.

## Alternatives rejected
| Option | Why not |
|---|---|
| Three new sector-style packs | Duplicates what the `category` slot already says; triples the Dutch/English parity surface; the library learns per category anyway |
| Deactivating stored prompts on a mode change | Writes history away; filtering at selection keeps the rows for old reports |
| A `family` column on `prompt` | Derivable from existing fields; a second place to keep in step |
| Letting the model write questions for the category | A3 forbids it; it is the injection path the sanitiser exists to close |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
