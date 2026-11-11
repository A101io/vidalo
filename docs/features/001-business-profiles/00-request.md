# Request — 001 Business profiles

Julian, in the Vidalo session of 11 November 2026, after the free check of Sonable on
vidalo.ai (scan `cb4aac86`, 08:40) came out green with questions about Sunday hours and
paying by card. Verbatim, in the order he wrote them:

> Hier gaat ontzettend veel mis.

> Twee verschillende adressen worden als correct genoemd, er zijn geen 19 antwoorden. Er is maar 1 van 1 vraag

> Waar worden de vragen voor verschillende industrieen bijvoorbeeld verzameld en ingezet wanneer nodig? Bijvoorbeeld. Voor Sonable maken openingstijden niet uit, daar gaat het om hoe het performt versus competitie etc.

Claude answered with three proposals: a kind of business that decides which base questions
apply (local with a door, local at the customer's place, online and national); new question
packs for online services, webshops and B2B software without a town; and a competition block
in the report. Then asked whether to write a brief for it. Julian:

> Ja, schrijf de brief

## Context the analyst needs

- The three bugs in the Sonable check are a separate fix, not this feature: a town alone
  became the address fact so any Rotterdam address passed; questions without a reference
  fact were dropped silently; the counts on the report were wrong. The architecture page
  (https://claude.ai/artifact/FcuAMW3hnxv34nL7D5UC1b) and `A101/_OS/LEARNINGS.md`
  (2026-11-11) record them.
- Where questions live today: `packages/core/src/prompts/index.ts` (base questions, asked
  for every business), `prompts/sectors.ts` (11 packs, all local businesses with a door or a
  service area; they add questions, they never remove base ones), `prompts/rotation.ts`
  (bank of 20–30 per sector, 6 rotate per month), `prompts/nouns.ts` (comparison profile),
  `scanner/recommendations.ts` ("Wie AI wel noemt"). The sector is inferred from the Google
  category or the KvK SBI code (`inferSector`); the owner can change it after paying.
  Rules: `docs/CRITERIA.md`.

## 11 November 2026, later the same day (after the fixes of #115 were live)

Julian, looking at the corrected Sonable report ("Alle 19 antwoorden", every line "niet te
controleren" or "geen bruikbaar antwoord"), verbatim:

> This is still incorrect. Why were these questions asked for Sonable, it is pointless to know for a music streaming provider if they are open on friday. Make sure to before you ask these questions, understand what the business we target does and what questions will be reliable. This needs to happen for every client and we can build up some kind of database with common and good questions. Come up with the best solution to ensure the right questions are asked for businesses so companies feel attracted to Vidalo. Also add a nice animation that reflects what Vidalo is doing while clients wait.

Read as: approval of the brief's direction, with three changes recorded in `01-brief.md`,
"Amendment A".
