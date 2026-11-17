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

## Round 3: AC-10

Reviewer: compliance agent, 17 Nov 2026. Not legal advice. Scope: the uncommitted change on
`claude/namesake-followup` (`reporter/index.ts` `sendFollowUp`, `reporter/templates.ts`
`followUpEmail`, AC-10 in `01-brief.md`, the two test files), read with the day-7/day-21 copy
(`copy/index.ts:3451-3471`, `en.ts:3342-3361`) and the cron that sends them (`apps/worker/src/cron.ts`
`enqueueFollowUps`). Tests run: `DATABASE_URL= pnpm --filter @vidalo/core exec vitest run
test/namesake.test.ts test/namesake-wiring.test.ts test/legal.test.ts` → 34/34 green. Both mails
were also rendered as text for a local, unlisted business with an "existence" finding (temporary
test, removed); nothing was sent.

**Verdict: AC-10 met; closes QA-R2-04 as written. No P0 from this change. One line is enough in
the body, not in the inbox: two P1s, one of them pre-existing and more serious than the namesake
question (CMP-10, the day-21 mail claims a re-check that never runs). One P2. Nothing needs a
lawyer; CMP-10 needs a fix, not an opinion.**

| Check | Result | Evidence |
|---|---|---|
| Same signal as AC-9 | yes. `notListed: !business.googlePlaceId`, profile from the last finished run, both through `namesakeLine`, so local gets `namesake`, online `namesakeOnline` (no Google named, BE-08), neutral none. A run without a profile falls to the local wording, as in the report mail | `reporter/index.ts:442-443`; `templates.ts:729`; `shared/checked-as.ts:25-28` |
| Placement | directly under the quoted answer card, before "Zelf oplossen" / the price CTA on day 7 and before the CTA on day 21: the reader meets it before the offer. Without an example card it follows the intro. Same `note` style (14px, muted) as in the report mail, accepted in round 2 | `templates.ts:745-746, 762-763`; `layout.ts:68-69` |
| Wording | unchanged from AC-9 (round 2 and CMP-09 wording), NL and EN equal; fits the commercial context, no new claim | `copy/index.ts:1587-1589`, `en.ts:1542-1543` |
| Commercial-mail rules (Tw 11.7, AVG) | untouched: the unsubscribe link, `List-Unsubscribe` one-click and the opt-out check still precede the send; no new data, no new recipient; the line is derived from `google_place_id`, already held. `copy.result` is outside the legal lock | `reporter/index.ts:415-424, 451-453`; `test/legal.test.ts` green |
| BW 6:194, body | one line is enough in the body. The test is the overall impression on the addressee (a business owner who asked for this check); the qualifier sits under the very answer it qualifies, in the same mail as the result link | rendered text |
| BW 6:194, inbox | not enough. Subject and preheader are read without the body, and they carry the quoted value with no qualifier. See CMP-11 | `templates.ts:740-741, 758-760` |

| ID | Sev | Claim | Evidence | Proposed fix | Cost |
|---|---|---|---|---|---|
| CMP-10 | P1 | The day-21 mail says "We hebben het vandaag opnieuw gecontroleerd. Het staat er nog." (preheader and intro; EN "We checked it again today. It is still there."), and its subject and headline say "Nog steeds". No check runs: the cron enqueues only the mail, and `sendFollowUp` quotes the open findings of the free check from 21 days ago. A false statement of fact in a commercial mail that sells a €149 fix is misleading advertising (BW 6:194; 6:193c where the recipient is a consumer). With AC-10 it now also sits right above "Een antwoord kan … over een ander … gaan", which reads as a contradiction. Pre-existing since v0.1 (`acd8d04`), not introduced by AC-10, hence P1 and not a 005 gate. My one line of disagreement for Julian: I would treat this as a hard stop **for the day-21 mail itself**; if the production cron is sending follow-ups, fix it before the next day-21 run | `apps/worker/src/cron.ts:151-167` (no scan enqueued); `reporter/index.ts:425-434` (findings read, no scan); `copy/index.ts:3462-3467`, `en.ts:3353-3358` | Two readings: (a) make the claim true by running a recheck before the mail (costs a scan per non-customer; Julian's call), or (b) stop claiming it. I recommend (b), copy only, both languages. NL: `subject: (wrong) => \`Drie weken geleden: "${wrong}"\``, `subjectPlain: (n, name) => \`Drie weken geleden: ${n} ${n === 1 ? "fout" : "fouten"} over ${name}\``, `preheader: "Dit is de laatste mail hierover."`, `headline: (engine, wrong) => \`${engine} zei "${wrong}"\``, `headlinePlain: (n, name) => \`${n} ${n === 1 ? "fout" : "fouten"} over ${name}\``, `intro: (seen) => \`Drie weken geleden zagen we dat ${seen}.\``. EN: `Three weeks ago: "${wrong}"`, `Three weeks ago: ${n} error(s) about ${name}`, `"This is the last email about it."`, `${engine} said "${wrong}"`, `${n} error(s) about ${name}`, `Three weeks ago we saw that ${seen}.`. Adjust the test that matches the subject (`namesake-wiring.test.ts` mail file name only) | 20 min |
| CMP-11 | P1 | For a business without a listing the inbox layer carries the quoted value unqualified: day-7 preheader "ChatGPT zegt "X" over … Het is Y.", day-21 subject `Nog steeds "X"` and headline `ChatGPT zegt nog steeds "X"`. The example is the finding with the highest frequency of any fact, so it can be "definitief gesloten" (rendered: subject `Nog steeds "definitief gesloten"` in `namesake-wiring.test.ts`'s mock run), which is the fact a closed namesake produces most readily. A sole trader who reads only the inbox line gets an alarming claim about their business from a seller, with the qualifier unseen. Not a hard stop: the body qualifies it, and the recipient asked for the check | `templates.ts:741` (day-7 preheader), `758-760` (day-21 subject, headline); `reporter/index.ts:436` (example by frequency) | In `followUpEmail`, when `namesake` is set, do not quote the value in the inbox layer: `const quoted = namesake ? null : w;` and use `quoted` for the day-7 `preheader` and the day-21 `subject` and `headline` (falls to `preheaderPlain`, `subjectPlain`, `headlinePlain`). Keep `w` for the card and the day-21 intro, which the line follows directly. Extend `namesake.test.ts`: with `notListed` and an example, subject and preheader do not contain the wrong value. Do it together with CMP-10, so `subjectPlain` no longer says "Nog steeds" | 15 min |
| CMP-12 | P2 | Day-7 intro "Een klant die het vraagt, krijgt dit antwoord. Niet één keer, elke keer, tot de bron verandert." sits above a card that says "(3 van de 10 keer)"; the mail contradicts itself, and for a possible namesake "elke keer" overstates further. Pre-existing | `copy/index.ts:3456`, `en.ts:3347`; rendered text | NL: "Een week geleden controleerden we wat AI over ${name} zegt. Een klant die het vraagt, kan dit antwoord krijgen, tot de bron verandert. Hoe vaak, staat bij het antwoord." EN: "A week ago we checked what AI says about ${name}. A customer who asks can get this answer, until the source changes. How often is shown with the answer." | 5 min |

### Checklist amendments made in this run

- `docs/process/checklists/compliance.md`, "Learned (Vidalo, 17 Nov 2026, 005 round 3)": a
  qualifier also governs the inbox layer (CMP-11); a mail's "we did X today" is traced to the job
  that does X (CMP-10).
- `A101/_OS/playbook/templates/pipeline/checklists/compliance.md`: the same two, general to every
  venture.
