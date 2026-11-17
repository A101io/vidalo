# 005 — Compliance verify (phase 4)

Reviewer: compliance agent, 16 Nov 2026. Not legal advice. Scope: the uncommitted change on
`claude/scan-identity` (`git diff` plus `packages/core/src/shared/business-identity.ts`), checked
against `docs/process/checklists/compliance.md`, `docs/legal-compliance-guidelines.md`,
`docs/records-of-processing.md`, `docs/processors.md`, `A101/_OS/playbook/LEGAL-NL.md` and the
brief's AC.

**Process miss, mine:** no phase-1 compliance checklist was written for 005. Under the
foreseeability rule nothing below may be above P1 unless it is a legal hard stop. None is.

**Verdict: no P0. Ships on compliance.** Two P1s to fix this cycle, both copy only (CMP-01,
CMP-02). Nothing needs a lawyer.

Tests run: `DATABASE_URL= pnpm --filter @vidalo/core exec vitest run test/legal.test.ts
test/business-identity.test.ts test/free-check.test.ts` → 38/38 green (legal lock matches the new
text, NL and EN dates agree). Any fix under CMP-01 changes `copy.legal` again: new date and
`pnpm --filter @vidalo/core legal:lock`.

## What holds

| Check | Result | Evidence |
|---|---|---|
| Lawful basis for the new field | yes: art. 6(1)(f) AVG, the free check's existing basis. Identifying the right business serves that purpose and the accuracy principle (art. 5(1)(d)) | privacy "Grondslag", `copy/index.ts:1019`, `en.ts:995` |
| Necessary and proportionate (minimisation) | yes. A name alone demonstrably picked the wrong business (brief, 13 and 16 Nov). Postcode + house number is the least that identifies an address exactly; the website is offered as an alternative that is not a home address; the value lives for one request plus at most 15 min in the visitor's own cookie | `business-identity.ts:14-28`; `route.ts:99-103` |
| Not stored in the database, an event or a log line (AC-6) | yes for postcode + house number. `pendingPayload` and `freeCheckEvents` pick `email`, `marketing`, `lang` by name, so the cookie's `identity` field cannot ride along; no `console.*` in the route or pick page | `shared/scan-confirm.ts:63-65`; `shared/free-check.ts:40-44`; grep on `route.ts`, `kies/page.tsx`. The website branch is stored on purpose: CMP-01 |
| Not in a URL (AC-6) | yes. Redirects carry `q`, `place`, `k`, `fout`, `kandidaat` only; the field is not echoed back on `fout=herken` | `route.ts:90-95,108` |
| Not sent to Google | yes. The Places/KvK lookup gets the typed name and place only; matching happens afterwards on our side | `route.ts` `resolveBusiness(parsed.query, place)`; `identityMatches` |
| Cookie header in Cloudflare Workers Logs (`observability.enabled`) | Cloudflare states that Workers Logs redact `Cookie` and `Authorization` headers ([launch post](https://blog.cloudflare.com/introducing-workers-dashboard-logs)); not stated on the [docs page](https://developers.cloudflare.com/workers/observability/logs/workers-logs/). The address already rode in the same cookie, so no new exposure | `apps/web/wrangler.jsonc:14` |
| Cookie statement | yes. `vidalo_check` row updated NL + EN, lifetime unchanged and true (`maxAge: 15*60`, cleared once the check starts) | `copy/index.ts:1224`, `en.ts:1200`; `lib/free-check.ts:5`; `route.ts` end of POST |
| Legal versioning (AC-7) | yes. `updated` moved in both languages, lock rehashed, `legal.test.ts` green. See CMP-06 for the date |  |
| NL and EN equal in substance | yes, pair by pair (form copy, pick page, privacy, cookie row, `/controle` body) | |
| Processors | no new recipient. `docs/processors.md` needs no line: the value reaches only Cloudflare in transit (already "everything in transit"); a typed website that becomes the checked website is fetched and its text goes to OpenAI, already the OpenAI row and the privacy "Herkomst" ("ook een website die je zelf opgeeft") | `docs/processors.md` OpenAI and Cloudflare rows |
| "Mijn bedrijf staat er niet bij": data | the typed postcode is dropped on this branch; only name, place and an optional website are used, as for a business with no listing before (ADR-0007) | `resolve.ts` `unlistedCandidate`; `route.ts:120` |
| "Mijn bedrijf staat er niet bij": consumer law | nothing touched. The check is free, no contract with a price, no VAT, no withdrawal right in play; still behind the e-mail confirmation | `route.ts` `requestConfirmation` / `startSignedIn` |
| Pick page shows postcode next to street | Google's and the KvK register's public address data, shown only after a passed bot check; adds the postcode to a street line already shown. Acceptable | `kies/page.tsx:48` |
| VAT, prices, invoices, cancellation, supply side | not touched | |
| Accessibility (EAA) | not a veto; microenterprise exemption assumed unchanged (fewer than 10 staff, at most €2M). AC-8 (label, hint, error by `aria-describedby`) is QA's lane | |

## Findings

| ID | Sev | Claim | Evidence | Proposed fix | Cost |
|---|---|---|---|---|---|
| CMP-01 | P1 | The new privacy paragraph says of the value "we sturen het nergens heen en bewaren het niet", which is untrue when it is a website: under AC-4 and AC-5 a typed identity website of a business Google does not list becomes the checked website, is stored as provisional `facts.website`, fetched, and its page text sent to OpenAI. It also promises "zodat we nooit een ander bedrijf … controleren", which the "Mijn bedrijf staat er niet bij" path cannot keep (that check runs on name and place alone). A privacy text that misdescribes processing fails art. 5(1)(a), 12(1) and 13(1)(c),(e) AVG. Not a hard stop: the website use is disclosed two items further down ("Herkomst", "Wat we ermee doen") and a business website is seldom personal data. Note for QA: the brief's AC-6 ("never stored") contradicts its own AC-4/AC-5 for websites | `copy/index.ts:1016`, `en.ts:992`; `route.ts:141`; `scanner/onboard.ts:59-68` | Replace the item. NL: "Herkennen: naast de naam vul je de postcode en het huisnummer of de website van je bedrijf in, zodat we het juiste bedrijf controleren en niet een ander met een naam die erop lijkt. Werk je vanuit huis, dan is die postcode met huisnummer je woonadres. Postcode en huisnummer vergelijken we alleen met de bedrijfsgegevens die Google toont; we sturen ze nergens heen en bewaren ze niet. Ze staan hooguit 15 minuten in de cookie vidalo_check. Kent Google je bedrijf niet en vul je een website in, dan controleren we die website als die van je bedrijf en bewaren we hem bij het bedrijf." EN: "Recognising: besides the name you enter your business's postcode and house number, or its website, so we check the right business and not another with a similar name. If you work from home, that postcode and house number is your home address. We only compare the postcode and house number with the business details Google shows; we send them nowhere and do not keep them. They sit in the vidalo_check cookie for at most 15 minutes. If Google does not know your business and you enter a website, we check that website as your business's and keep it with the business." New version date, `legal:lock` | 15 min |
| CMP-02 | P1 | No privacy information at the point of collection. The form now asks for what may be a home address (and already asked for the e-mail address) with a hint that gives only the purpose; there is no link to the privacy statement on the form, and on `/scan/kies` and `/controle` (`note={false}`) not even the note. Art. 13(1) requires the information "at the time when personal data are obtained"; the EDPB transparency guidelines (WP260 rev.01, layered notice) accept a short first layer with a link at the field. House rule LEGAL-NL §6: "Link the Privacy Statement wherever personal data is first collected". Not a hard stop: the full statement exists and the footer links it on the same page. To the question asked: the hint alone is not enough; hint plus link is | `apps/web/components/ScanField.tsx:89-121`; `copy/index.ts:58-67` (`scanField`) | (a) Hint NL: "Zo weten we zeker welk bedrijf je bedoelt. Postcode en huisnummer vergelijken we alleen; we bewaren ze niet." EN: "So we know for sure which business you mean. We only compare the postcode and house number; we do not keep them." (b) One line under the button, rendered always (also when `note` is false): NL "Wat we met je gegevens doen, staat in onze [privacyverklaring]." EN "What we do with your details is in our [privacy statement]." linking `/privacy` (EN `/en/privacy`), ideally to the free-check section anchor. `scanField` copy is not `copy.legal`: no version bump | 30 min |
| CMP-03 | P2 | `docs/records-of-processing.md` does not list the new field (art. 30(1)(c) AVG: categories of data), and its website wording says the typed website comes "on /scan/kies" only | `docs/records-of-processing.md` row "Free check" | Data categories, add: "postcode + house number or website typed to identify the business (postcode only compared during the request, at most 15 min in the `vidalo_check` cookie, never stored; a website for a business Google does not list becomes the provisional `facts.website`)"; change "on /scan/kies" to "on the form or on /scan/kies" | 5 min |
| CMP-04 | P2 | "Mijn bedrijf staat er niet bij" makes the as-typed check reachable for any name, also one Google lists. The report then does not say it was checked on name and place alone, so answers about a namesake (for a sole trader's own name: another person) can read as being about the requester's business. Pre-existing for businesses with no listing at all (ADR-0007); now one click away for everyone. A claims-accuracy point (BW 6:194), not a data point | `kies/page.tsx:178-230`; `apps/web/lib/report.ts` (no branch for `placeId` null); `copy.result` (no such line) | For a report whose business has no `google_place_id`, one line near the heading, NL: "We controleerden dit bedrijf op de naam en plaats die je invulde; Google kent het niet. Antwoorden kunnen daardoor over een ander met dezelfde naam gaan." EN to match. Same line in the report mail | 30 min |
| CMP-05 | P3 | `vidalo_check` is set without `Secure`; it now carries a possible home address next to the e-mail address. Pre-existing; security's lane | `apps/web/lib/free-check.ts:5` | `secure: true` when `PUBLIC_BASE_URL` is https (as the CSP rule does) | 5 min |
| CMP-06 | P3 | Version date 17 November 2026 while today is 16 November; deployed today, the statement carries a date that has not come | `copy/index.ts:759`, `en.ts:735` | Deploy on or after 17 Nov, or set the deploy date and re-lock (CMP-01 re-locks anyway) | 5 min |
| CMP-07 | P3 | A home-working sole trader without a website has to type their home address. The KvK number would identify them without it (the resolver already has KvK candidates) | `business-identity.ts`; `resolve.ts:183-203` | Later: accept an 8-digit KvK number as a third identity, matched against `candidate.kvk` | 1 h |

## Notes for other agents (not compliance findings)

- **QA:** AC-6 ("never stored in the database") and AC-4/AC-5 (typed identity website used as the
  checked website) cannot both hold for websites; the code follows AC-4/AC-5. Decide which the
  brief means; CMP-01 words the privacy text to match the code.
- **Security:** CMP-05.

## Checklist amendments made in this run

- `docs/process/checklists/compliance.md`: "Learned (Vidalo, 16 Nov 2026, 005)".
- `A101/_OS/playbook/templates/pipeline/checklists/compliance.md`: point-of-collection link and
  tracing a "not kept" sentence through every branch, both general to every venture.

## Round 2: CMP-04 fix

Reviewer: compliance agent, 17 Nov 2026. Not legal advice. Scope: the uncommitted change on
`claude/namesake-line` (`copy.result.namesake` NL + EN, `apps/web/lib/report.ts`,
`app/r/[id]/page.tsx`, `reporter/index.ts` + `templates.ts`, AC-9 in `01-brief.md`, the two new
tests and the e2e lines). Tests run: `DATABASE_URL= pnpm --filter @vidalo/core exec vitest run
test/legal.test.ts test/namesake.test.ts test/report-namesake.test.ts` → 30/30 green.

**Verdict: CMP-04 fixed for the case it named (a local business without a Google listing). No P0,
no P1. One P2 (CMP-08: the same risk on the online "not listed" path, left unqualified) and one
P3. Nothing needs a lawyer.**

| Check | Result | Evidence |
|---|---|---|
| CMP-04 met | yes for local businesses. The line shows when the business row has no `google_place_id` and the profile is not online, on the report page (under the hero, before the per-AI lines) and as a note right after the intro of the report mail, NL and EN. Old reports of such a business get it too, which is true of them | `report.ts` `namesake: opts.notListed && !online`; `r/[id]/page.tsx` `notListed: !!business && !business.googlePlaceId`; `templates.ts` note after `B.intro`; `reporter/index.ts` `notListed: !business.googlePlaceId` |
| BW 6:194 (claims accuracy) | the qualifier sits where the result is read, not in a footnote, and says what could be wrong (another business or person with the same name). It removes the impression CMP-04 named. The demo and listed businesses do not get it, correctly: a demo is labelled fictional and a listed business is matched on its listing | `test/report-namesake.test.ts`, `test/namesake.test.ts`, `e2e/free-check.spec.ts:32` |
| Wording | calm, no exclamation mark, none of GEO/AEO/LLM/prompt/credits/zichtbaarheid/platform/agent, no "u". It does not address the reader with "je" on purpose ("die zijn ingevuld"): a report link can be read by someone other than the person who typed. That is within the convention (informal register, not formal "u") and more accurate than "die je invulde" | `copy/index.ts:1579`, `en.ts` `namesake` |
| NL and EN equal in substance | yes | same |
| Leaving it out for the neutral case (no listing, no website) | defensible. That report already says "Google kent je bedrijf niet en we vonden geen website", asks three general questions and judges no answer ("je ziet wat AI zegt"), so no verdict can be pinned on a namesake. A second Google sentence would repeat the first | `copy/index.ts` `checkedAs.neutral.how`; `types.ts` `isNeutralProfile` (fallback + online); `e2e/free-check.spec.ts:163-168` |
| Leaving it out for an online business | the stated reason holds for the *wording* (BE-08: an online report names no Google) but not for the *risk*. See CMP-08 | |
| `copy.legal`, privacy statement, cookie table, processors | nothing needed. No new field, no new processing, no new recipient: the line is derived from `business.google_place_id`, already held. `copy.result` is outside the legal lock; `legal.test.ts` green, no version date needed | `test/legal.test.ts` 24/24 |

| ID | Sev | Claim | Evidence | Proposed fix | Cost |
|---|---|---|---|---|---|
| CMP-04 | — | Status: **fixed** (local, not listed). The online remainder is split out as CMP-08 | above | — | — |
| CMP-08 | P2 | An online business reached through "Mijn bedrijf staat er niet bij" with a typed website (AC-4, the path CMP-04 was about) carries no namesake line, yet its questions name the business by name alone, without town or website ("Bestaat {naam} nog?", "Wat doet {naam}?"), so the namesake risk is at least as high as for a local one. "Gecontroleerd als" says what kind of business Vidalo read, not who the answers were about. Not P1: the website-led profile and criterium 11 (`other_entity`, one sample is enough) catch part of it, and the wrong-Google wording was rightly avoided | `prompts/online.ts:35-44`; `scanner/extract.ts:72-76` (online: place not required); `scanner/compare.ts:273-274`; `report.ts` `!online`; `templates.ts` `!online` | Second key without Google, shown when `notListed && online && !checkedAsNeutral` (page) / `notListed && online && !isNeutralProfile(profile)` (mail). NL `namesakeOnline`: "We stelden de vragen over dit bedrijf alleen met de naam, dus een antwoord kan over een ander bedrijf of iemand anders met dezelfde naam gaan." EN: "We asked about this business by its name alone, so an answer may be about another business or someone else with the same name." Same placement; extend both tests. Satisfies BE-08 (no Google named) | 30 min |
| CMP-09 | P3 | Two small accuracy nuances in the line. (a) "Google kent dit bedrijf niet" states a fact about Google; what Vidalo knows is that its lookup found no listing. (b) A business picked from the KvK register on `/scan/kies` has no `google_place_id` too, and its name and place came from the register, not from what "zijn ingevuld". Neither misleads on the point that matters (a namesake is possible) | `scanner/resolve.ts:186-211` (KvK candidates, `placeId` null); `scanner/onboard.ts:55` | NL: "We vonden dit bedrijf niet op Google en controleerden het op zijn naam en plaats. Een antwoord kan daardoor over een ander bedrijf of iemand anders met dezelfde naam gaan." EN: "We did not find this business on Google and checked it by its name and town. An answer may therefore be about another business or someone else with the same name." | 10 min |

### Checklist amendment made in this run

- `docs/process/checklists/compliance.md`, "Learned (Vidalo, 16 Nov 2026, 005 phase 4)": a
  qualifier is scoped by the risk, not by where its wording fits (CMP-08).
