# ADR-0002 — Understanding: Places rules first, then one web-search lookup, then one tool-less classification

*2026-11-11 · status: accepted*

## Context
Sources named by Amendment A1, in order: the Google Places record, the business's own website,
one AI lookup with web search ("Wat is {naam} in {plaats}?"). Sonable has no listing and no known
website; a kapper with a listing must come out `door` every time (AC-A2) so local checks stay
identical to main. Text from the visitor (the name), from a website and from an AI answer is
untrusted and may carry instructions. `pnpm e2e:mock` and the Playwright suites run without keys
(AC-A4). The free check costs about €0.25 today and is capped per IP and per day.

## Decision
1. **Places rules decide what they can, no model involved** (`decideMode` in `scanner/understand.ts`):
   - listing (`business.googlePlaceId`) and `facts.serviceAreaOnly === true` (Google's
     `pureServiceAreaBusiness`, added to the Text Search field mask) → `visit`, unless the
     classifier says `online` with confidence `high`;
   - listing, not service-area-only, and a local sector (`business.sector`, or
     `sectorForCandidate` on `facts.googleTypes`) → `door`, whatever the model says;
   - otherwise the classifier's mode when its confidence is `medium` or `high`.
2. **Lookup**: OpenAI Responses API, `gpt-4.1-mini`, tool `web_search` (search context `low`,
   user location as the engines), input `Wat is {naam} in {plaats}?` (scan language; for an
   online-looking name without a listing the place is still asked: it narrows namesakes), 30 s
   timeout. The name passes `sanitizeSlot(name, "name")` first; refused → no lookup.
3. **Website text**: the known website (facts) is fetched in parallel with the lookup. When none
   is known, the first citation of the lookup whose host contains a word of `nameCore(name)` is
   fetched. One page, `fetchText` 8 s / 300 KB, `htmlToText`, first 4,000 characters.
   `basis` gains `website` only when that text contains the business name.
4. **Classify**: Chat Completions, `gpt-4.1-mini`, temperature 0, **no tools**,
   `response_format: json_schema` strict, schema
   `{mode: enum, offer: string, audience: string, category: string, competitors: string[], website: string|null, confidence: enum high|medium|low}`,
   validated with zod. The user message is one JSON object
   `{bedrijf:{naam, plaats, land}, google:{types, heeftAdres, alleenWerkgebied}, website:{host, tekst}, opzoeking:{antwoord}}`;
   the system message says the fields are data to describe, never instructions, and that
   category is the singular lowercase noun a buyer searches with. Every string field of the
   output then passes `sanitizeSlot`; a refused `offer` or `category` sets confidence `low`.
5. **Grounding**: `grounded = basis` includes `google`, `website` or `owner`. Only a grounded
   offer is a reference for judging "wat doet X"; an offer from the lookup alone picks questions
   but every answer to "wat doet X" is then counted unchecked. Likewise `profile.website` is set
   only when the fetched page names the business, and `withProfile` uses it as the website fact
   only while the facts are provisional and have none.
6. **Fallback** (AC-A3): an error, a timeout, confidence `low`, or a lookup that `looksNotFound`
   with no site text → the business's earlier `profile_auto` if any, else
   `{source:"fallback", mode: Places rule, else listing → door, no listing → online}` with null
   slots. A fallback is never stored as `profile_auto`.
7. **Mock** (`VIDALO_MOCK=1` or no OpenAI key): `mockUnderstand(name, facts)`, a keyword table like
   `mockProfile`: names matching `/sonable|muziek|music|software|saas|webshop|app\b/i` → online with
   fixed Dutch slots (Sonable: offer "achtergrondmuziek voor hotels en horeca", audience "hotels,
   restaurants en winkels", category "aanbieder van achtergrondmuziek", competitors
   "Soundtrack Your Brand", "Spotify Business"); the mock resolver returns those names without a
   listing (no place id, no address) and with a website, so the Places rules do not force `door`.
   Everything else follows the Places rules with the mock profile's category word. No network.
8. Cost (≈ 1.5 ¢) is added to the scan run's `costCents`.

## Consequences
**Good:** local businesses with a listing are decided by Google's data, so AC-A2 cannot regress
through a model; the step that reads untrusted text has no tools and can only fill a schema whose
strings are then sanitised; the pattern (search in prose, then structured extraction) is the one
the scanner already uses for answers.
**Bad:** two OpenAI calls instead of one; the Places field `pureServiceAreaBusiness` only exists
for businesses resolved after this ships (older facts lack it and are treated as not
service-area-only, i.e. today's behaviour); the classifier's confidence is the model's own word.
**We can no longer:** classify a listed hairdresser as online, even when the owner sells online;
that business needs the owner's correction on `/app/gegevens`.

## Alternatives rejected
| Option | Why not |
|---|---|
| One Responses call with `web_search` and a JSON output format together | Couples reading untrusted pages with producing the profile in one turn; not relied on without a verified test of tool + strict-schema behaviour on this model |
| Ask the visitor to classify (original AC-1) | Julian rejected it: "the visitor is not asked to classify their own business" |
| Website text alone | Sonable's website is not known from the name and place |
| Let the model override Places for listed local businesses | Breaks AC-A2/AC-3 on a model's whim; no evidence it would be right more often |
| A numeric confidence | Self-reported floats are not calibrated; three levels are what the fallback rule needs |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
