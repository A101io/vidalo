# 005 Scan identity: never pick a business by name alone

## Julian's request (16 Nov 2026, verbatim)
"Dit kan zo niet, we kunnen niet een naam aannemen. Zorg dat dat er meer variabelen ingevuld moeten worden. verzin iets beters" — then "Ja, bouw het" on the proposal below.

## Why
On 13 and 16 Nov 2026 the free check for the name "Vidalo" ran on "Voila ! Damesmode": Google Places answered the unknown name with the nearest one it knew, and `/api/scan` took a single candidate without asking (`candidates.length === 1`). The requester got a report about another business.

## What
The free-check form asks, besides name, place and e-mail, one required field: the Dutch postcode + house number, or the website. A candidate is taken without a click only when exactly one candidate matches that exactly. Otherwise `/scan/kies` lists the candidates with street, postcode and website, and offers "Mijn bedrijf staat er niet bij".

## Acceptance criteria
- AC-1 A post to `/api/scan` without a usable postcode + house number or website (and without a pick on `/scan/kies`) goes back to the field with `fout=herken`, before the bot check and before any lookup; the field is marked invalid and the page says what to enter.
- AC-2 A candidate is taken without a click only when exactly one candidate has the typed postcode and house number (whole number, postcode without spaces, case-insensitive) or the typed website's host (without `www.`). The name never decides.
- AC-3 With no or several matches, `/scan/kies` lists the candidates with street, postcode and website and lets the visitor pick one; nothing is started before that click and the e-mail confirmation.
- AC-4 `/scan/kies` offers "Mijn bedrijf staat er niet bij" (EN "My business is not listed"), which checks the business as typed (name, place, optional website; the typed identity website is used when the field is empty), after the e-mail confirmation like every other check.
- AC-5 A website as identity when nothing at all is listed starts the check on that website (ADR-0007) without the pick page.
- AC-6 A typed postcode + house number is never stored in the database, an event or a log line, and never in a URL; between form and pick page the identity rides only in the signed `vidalo_check` cookie (15 min). A typed website is stored only where AC-4/AC-5 make it the checked website of a business nothing lists (amended in phase 4, CMP-01), and never on a business Google or the KvK lists (SEC-01).
- AC-7 Privacy statement (NL + EN) says what the field is for, that it can be a home address, that it is only compared and not kept; cookie row updated; new version date; legal lock updated.
- AC-9 (17 Nov 2026, from CMP-04; Julian: "bouw de regel voor naamgenoten op het rapport") The report page and the free-check report mail of a local business Google does not list say that an answer may be about another business or person with the same name (`copy.result.namesake`, NL + EN). Not for a listed business, a demo report, or an online business (its report names no Google; "Gecontroleerd als" says how it was read).
- AC-8 All copy NL + EN; the field has a label, a hint tied by `aria-describedby`, and an error tied the same way.
