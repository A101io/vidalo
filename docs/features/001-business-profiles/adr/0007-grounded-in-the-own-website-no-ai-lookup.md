# ADR 0007 — A profile is grounded in the Google listing or the business's own website; the AI lookup is removed

- Date: 11 November 2026
- Status: accepted. Supersedes ADR 0002 where it describes the web-search lookup.
- Decided by: Claude, on evidence from real calls; Julian approves with the PR.

## What happened

ADR 0002 had the understanding step ask ChatGPT with web search "Wat is {naam} in {plaats}?"
for a business Google does not list. Every test of it used a recorded answer. The first
real calls (11 Nov 2026, in memory, about 6 cents in total):

| Query | What came back |
|---|---|
| ChatGPT, "Wat is Sonable in Rotterdam?" | Salsability, a dance school |
| ChatGPT, "Wat is het bedrijf Sonable?" | sonable.ai, another company |
| ChatGPT, with town and country | an events platform, from LinkedIn |
| Google (SerpApi), "Sonable" | Sonible audio plug-ins |
| ChatGPT, "Wat is Vidalo in Rotterdam?" | Nightclub Lido |
| ChatGPT, "Wat is het bedrijf Vidalo?" | Vidyalo, an education platform |
| Google (SerpApi), "Vidalo" | a VILA jumper |

The step stored "dansschool" for Sonable and "nachtclub" for Vidalo with medium confidence,
and the questions and the waiting page would have used them. With the website given, the
lookup's answer still contaminated the classification (Vidalo: "congreslocatie"; Sitty:
"Palestijnse afhaalmaaltijden", from sitty.nl). From the own website alone, with no lookup:

| Business | Profile |
|---|---|
| Sonable (sonable.io) | online, AI-gegenereerde achtergrondmuziek voor commerciële ruimtes |
| Vidalo (vidalo.ai) | online, controle en correctie van AI-antwoorden over bedrijven |
| Sitty (sitty.io) | online, tijdelijke werkplekken boeken |
| a site that cannot be fetched | fallback, as designed |

A name is not enough to identify a young or small business, for any source. That is also
the product's own thesis: AI mixes such a business up with others.

## Decision

1. The AI lookup is removed. The understanding step reads the Google listing (Places types,
   address, website) and the business's own website, and makes one classification call.
2. A profile is accepted only when it is grounded: a listing, or a page on the business's
   own website that names the business. Ungrounded means fallback: nothing is stored,
   nothing is shown as "We lezen X als", and the questions are the neutral set.
3. When Google does not list the business, the visitor is asked for the website on
   `/scan/kies` ("We vonden je bedrijf niet op Google. Wat is je website?"), optional, with
   a way on without one. The website is validated as a public http(s) address, read once,
   and stored as a provisional fact. It is the only new field, and only in that case.
4. The neutral set, without a listing and without a readable website: "Bestaat X nog?",
   "Wat doet X?" and "Wat is de website van X?", shown as what AI says, not judged; the
   report says we could not read the business and how to fix that (give the website; a
   paying owner fills in the profile).
5. Competitors no longer come from the understanding step (the classifier saw none on the
   site and invented generic ones from the lookup). They come from who AI names in the
   answers, as the report already shows.

## Consequences

- Cost per check drops from about 1.4 cents to about 0.1 cent.
- The privacy text's sentence about "één zoekvraag via OpenAI" must go again; the homepage
  text still goes to OpenAI for the classification.
- Security checklist items on the lookup (S-03 place in the lookup, the citation host rule
  S-11) fall away; the fetch guards (S-12, S-13) now apply to a visitor-typed URL, which
  makes them more important: a typed URL must never reach a private address.
- AC-A1 changes: Sonable is understood from sonable.io, given on `/scan/kies`.
- Tests of the understanding step must include recorded real pages, and one real run per
  release of this step is a required check (the mock proved nothing here).

## Rejected

- A better lookup question or more search context: tried, still another company.
- Guessing domains from the name (sonable.nl, .com, .io): sonable.ai is someone else.
- Asking the visitor to classify the business: Julian asked for Vidalo to understand it.
