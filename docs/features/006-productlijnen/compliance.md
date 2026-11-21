# Compliance verify — 006 Productlijnen (phase 4)

*compliance · 2026-11-21 · worktree `.claude/worktrees/005-productlijnen`, branch `claude/005-productlijnen`, uncommitted
tree on top of 8fdd35e. Checked against my phase-1 list `checklists/compliance.md` and then past it. I am not a lawyer;
items that need one are named at the end. Nothing was changed in code; the hosted Supabase project was not touched.*

## Verdict

- **Legal hard stop: none.** No P0. The two that could have been one (outlet letters to retailers, a real retailer in
  public mock data) were built out as asked (B1, B4).
- **Three P1s**, all in mail wording, all cheap: a line correction letter points the third party to a facts page that
  does not carry product lines (CMP-601); the monthly mail calls an unlisted outlet "Klopt niet" (CMP-602); the mail's
  line section does not name the AI systems asked (CMP-603).
- Legal texts, internal records, export, retention, launch switch, market allow-list, cookies and storage: pass.

## What was run

| Check | Result |
|---|---|
| `DATABASE_URL= pnpm -r typecheck` | exit 0 |
| `DATABASE_URL= pnpm -r test` | core 119 files, 1645 passed, 30 skipped; worker 8 files, 67 passed; `legal.test.ts` 24/24 |
| `DATABASE_URL= pnpm mail:lab` | `OK mail-lab`, 0 problems; NL monthly mail to the demo owner read in full (`out/mail-lab/mail/*bakkerij-de-vries-in-november-2026*`) |
| Browser, mock server :3100, signed in as the demo owner (Playwright + axe 4.14, WCAG 2.0–2.2 A/AA tags) | `/app/productlijnen`, detail (NL, BE), edit form, add form, two line findings on `/app/fouten/[id]`: axe 0 violations on each; no `localStorage`/`sessionStorage` keys; only cookie `vidalo_mock_session` (httpOnly) |
| No-JS and JS submit of an edit with a `javascript:` outlet URL | refused, typed name kept in the field, URL unchanged (`?bewerken=1`), nothing saved |

## Change before build (B1–B7)

| # | Result | Evidence |
|---|---|---|
| B1 outlet never takes a third-party letter | **pass** | `fixer/paths.ts` `fixPathFor`: `factKey === "outlet"` → `LINE_OUTLET_PATH` (action `none`) before any source check; `test/line-fixer.test.ts:82`. Page copy "Die staat niet in je lijst … Verkoopt dit bedrijf je product wel?" |
| B2 export reads every scope | **pass** | `shared/my-data.ts:34-54` and `shared/export-stream.ts` read lines, versions, and line rows of prompts, runs, findings; `test/db-product-lines.test.ts:258` on MemDb and PgDb |
| B3 launch switch | **pass** | `productLinesEnabled` (`shared/product-lines.ts:30`): `VIDALO_PRODUCT_LINES=1` or mock; not set in any wrangler config; cron gates on `productLineAccess` (`apps/worker/src/cron.ts`); nav, list and detail off (04-build deviation 5) |
| B4 seed names fictional | **pass** | no Delhaize / Bakkerij Bart in `apps/web/lib/demo.ts`; outlets "Versmarkt Haarlem", "Broodhuys Gent", "Gentse Warenwinkel", `.example` URLs. "Delhaize" survives only in a code comment (`shared/facts-nl.ts:145`) |
| B5 market allow-list | **pass** | `LINE_MARKETS` = EU/EEA subset + GB + CH, no US, no sanctioned country; `parseProductLine` refuses others; the form shows 16 boxes |
| B6 certificate letter | **pass** | `email-templates.ts` `lineLines`: number and end date only when `valid`; an expired entry makes the expected value "no" (`scanner/normalize.ts:313-318`), so the letter never asserts it; `test/line-fixer.test.ts:104` |
| B7 AC8 surfaces | **pass** | `04-build.md` lists terms, privacy, processors, records, export, `legal.test.ts` |

## Checklist items

| ID | Result | Evidence / note |
|---|---|---|
| L-10 export | pass | as B2 |
| L-11 every field has a use | pass | `replacedBy` shown under "Opgevolgd door" on the detail page, never in a question (`prompts/line.ts:3-5`); certificate number used in the letter |
| L-12 form hints | pass | outlets hint "winkels of bedrijven, niet om personen. Vul geen telefoonnummers of e-mailadressen in." NL and EN |
| L-13 old names | pass | hint "Alleen eerdere namen van jouw eigen product"; successor letter built from `finding.subject`, which only comes from `replaces` |
| L-14 retention | pass | `on delete cascade` from `business` through `product_line`, `product_line_facts`, `prompt`, `scan_run` (`0020_product_lines.sql:14,24,65,76`); `test/db-product-lines.test.ts:370` deletes and counts zero in six tables. No new retention class |
| L-15 events and logs | pass | `product_line.confirmed` {id, version, market count, created}, `.status`, `.refused` {reason}, `scan.*` and `job.skipped.line` carry ids and codes only |
| L-16 no personal data in URLs | pass | form refusals come back as action state, not `?fout=` (verified in the browser); remaining keys are ids and allow-listed codes |
| L-20 question slots | pass | `prompts/line.ts` header and `test/line-prompts.test.ts` |
| L-21 extraction payload | pass | `scanner/extract.ts:656-657`: line name, brand, category, market only; no owner values, no outlet list |
| L-22 engine location | pass | `scanner/index.ts:321` `{ country: market, place: "" }` |
| L-23 / L-03 processors and records | pass | `docs/processors.md` five vendor rows and "Sources with an error" region; `docs/records-of-processing.md` paid-service row |
| L-01 terms | pass | definition *Gegevens* extended NL and EN; art. 5 mandate reads "alleen Gegevens die jij bevestigd hebt", so it now covers lines; *Feitenpagina* article untouched |
| L-02 privacy | pass | paid-plan block: lines kept with every version, asked per country in that country's language, not published; recipients "ook buiten Nederland als je productlijn daar verkocht wordt". See CMP-605 for the transfer section |
| L-04 terms sentence on what a line includes | open, follow-up | correctly not written (D1/D2 open) |
| L-05 version date and lock | pass | "Versie van 21 november 2026" / "Version of 21 November 2026", `draft: false`, `legal.lock.json` updated, `legal.test.ts` green |
| L-06 report names the AI systems | **fail in the mail** (CMP-603); pass on the pages | pages show one labelled dot per AI system |
| L-07 no promise of a position | pass | "Genoemd als aanrader: n van m keer"; names alphabetical with "we tellen alleen hoe vaak"; mail-lab check for %/score/positie/€ |
| L-30 outlet copy | **fail in the mail** (CMP-602); pass on pages and fixer | no letter goes out, so P1, not P0 |
| L-31 line letters | **fail** (CMP-601) | names the line and asks the owner's value, but cites the facts page as where the value is. Mail lab shows no line letter (template only), so this was read in code and tests |
| L-32 "Wie AI wel noemt" | pass | counts, alphabetical, no comparison table |
| L-33 markets | pass | as B5 |
| L-34 letters stay Dutch | pass (noted) | no copy claims otherwise |
| L-35 checkout, VAT unchanged | pass | no diff in `billing/`, checkout or `copy/prices.ts` |
| L-40 no price | pass | grep of `product-lines.ts`, `.en.ts`, the line pages, MESSAGING, ARCHITECTURE, CRITERIA, CLAUDE.md: no €, gratis, inbegrepen, included, upgrade |
| L-41 price display after D1 | open, follow-up | |
| L-42 switch off = nothing | pass | as B3 |
| L-43 access banner | pass | `no_monthly_plan`: "Daarvoor heb je een abonnement met maandelijkse controle nodig." states a requirement, not what Monthly includes; and the switch is off in production |
| L-44 invoices and cancellation | pass | untouched |
| L-50 no new cookie | pass | browser and `legal.test.ts` |
| L-51 no browser storage | pass | browser: empty; `legal.test.ts` |
| L-52 `.example` hosts | pass | already in `NOT_RECIPIENTS`; no line code fetches an outlet URL (outlet links are rendered with `rel="noopener noreferrer nofollow ugc"`, never fetched) |
| L-53 no new vendor SDK | pass | only a new `exports` entry in `packages/core/package.json` |
| L-60…L-65 accessibility | QA, not a veto | axe clean on five screens; labels, legends, "Verplicht"/"Niet verplicht" in text; confirmation sentence sits directly above "Bevestigen en opslaan" (L-65 pass). Two points for QA: a refused outlet URL sets `aria-invalid` on the market and name inputs, not on the URL input; without JS, focus is not moved to the first error. Playwright specs from FE-01–FE-03 were not written (04-build deviation 6) |
| L-66 EAA exemption | open, P1 ask | assumed still under 10 staff and at most €2M; nobody confirmed it this run. Vidalo sells only to businesses, a second ground. The day either threshold is passed, AA failures on these screens become a legal hard stop |
| L-70 "vanaf de volgende maandelijkse controle" | pass | only shown to an owner who may save, and that same access check gates the cron |
| L-71 built is not runs | pass | no line wording outside the dashboard, legal texts and owner mails |
| L-72 copy rules | pass | jargon test in `test/web-product-lines.test.ts`; typecheck enforces NL/EN shape |
| L-73 AI Act | pass | no new AI system offered to people |
| L-74 Julian approves | open | nothing committed; approval pending |

## Findings

| ID | Agent | Sev | Claim | Evidence | Proposed fix | Cost | Owner | Status |
|---|---|---|---|---|---|---|---|---|
| CMP-601 | compliance | P1 | A correction letter and its follow-up about a product line tell the third party "De actuele gegevens staan op onze feitenpagina, bevestigd door de eigenaar: {url}" / "Bron: {url}". Lines are not on the facts page (ADR-0014; the privacy statement now says so), so the letter, sent in the owner's name, cites a page that does not hold the value it asks for. Not a hard stop: the value itself is the owner's confirmed one | `packages/core/src/fixer/email-templates.ts:74-75` (request), `:102` (follow-up); `ctx.line` is set but the URL lines are unconditional. `test/line-fixer.test.ts:63` checks the line sentence, not this | When `ctx.line` is set, replace both URL lines with "Dit gegeven is door de eigenaar aan ons bevestigd." and no URL. Add `expect(text).not.toContain(factsPageUrl)` to the line-fixer test for request and follow-up | 30–45 min | backend | open |
| CMP-602 | compliance | P1 | The monthly mail renders an outlet finding as "Google AI zei: Gentse Warenwinkel, niet in je lijst (1 van de 1 keer) / **Klopt niet. Het is: Broodhuys Gent**". That says the AI is wrong and the shop does not sell it, which L-30, MESSAGING and the page copy ("Dit is dan geen fout meer") all rule out | NL monthly mail in `out/mail-lab/`; path `reporter/templates.ts:682` `lineBlocks` → `exampleCards` → `findingLines` → `templates.ts:200` `F.wrongIs(w.correct)` | In `findingLines`, for `factKey === "outlet"` use `copy.productLines.detail.outletNotListed(wrong)` and `outletNote` (NL and EN) instead of `wrongIs`. Check the resolution and unfixable notices for outlet findings the same way; add a mail-lab assertion that a line section never holds "Klopt niet" next to "niet in je lijst" | 1 h | backend | open |
| CMP-603 | compliance | P1 | Terms art. 3 says every report names the AI assistants asked. The mail's line section names none, while its header lists the business's engines ("aan ChatGPT, Gemini, Perplexity, Google AI, Copilot, Claude"); line runs ask three. A reader takes the header as covering the lines | Same mail: "Nederland: oranje. 1 fout open. Genoemd als aanrader: 3 van 10 keer." with no engine names; `copy.mails.monthly.lines.market` (`copy/index.ts:3461`) | Pass the run's engines into `LineMailSection.markets[]` and end the market sentence with "Gevraagd aan ChatGPT, Google AI en Perplexity." (EN in step), labels from the existing engine label map | 30 min | backend | open |
| CMP-604 | compliance | P2 | "België: nog niet gecontroleerd" is printed for a market that was checked in earlier months and still has an open finding, which the same section lists below it. A "checked" claim must come from the same count on every surface (standing list, 11 Nov) | Same mail, BE block; `copy/index.ts:3463` used whenever this month's run is missing | Use "deze maand niet gecontroleerd" when an earlier finished run exists; keep "nog niet gecontroleerd" for a market never run | 20 min | backend | open |
| CMP-605 | compliance | P2 | The privacy section "Gegevens buiten de Europese Economische Ruimte" names only the US. Line letters can now go to sources in GB and CH by design (`LINE_MARKETS`); both have adequacy decisions, so the gap is disclosure, not lawfulness | `copy/index.ts:1172-1175`; `processors.md` row "Sources with an error" says "also outside the EU" | One sentence: correction requests can go to a source outside the EEA, for the United Kingdom and Switzerland on the Commission's adequacy decisions. Bundle with the D1 terms change so there is one new version date and one `legal:lock` | 15 min, in the D1 change | compliance + frontend | open |
| CMP-606 | compliance | P2 | An outlet "not in your list" is counted as a wrong answer: orange dot "Misleidt", "1 antwoord klopte niet of vond niets", "Antwoorden die niet kloppen 1" in the grids. Private to the owner, but it is the same "the AI is wrong" claim B1 avoids, on a figure | Detail page `/app/productlijnen/<id>?markt=BE`, "Per onderdeel / Waar te koop" and "Per AI-systeem / Google AI" | Julian decides under D5 whether an unlisted outlet colours the dot. If not: count it separately as "niet in je lijst" and leave it out of "niet kloppen" | 1–2 h | backend + Julian (D5) | open |
| CMP-607 | compliance | P2 | On an outlet finding the page offers "Zelf de bron aangepast? Zeg het ons; dan vragen we het binnen een uur opnieuw" while the same page says "Geen bron genoemd" and "Geen hercontrole gepland". The promise of a re-ask within an hour has to come from a job that actually runs (standing list, CMP-10 of 005) | `/app/fouten/0923a731-…` (seeded outlet finding, BE) | For outlet findings, hide "Ik heb dit aangepast" and keep "Dit klopt wél" (that is the "voeg het toe" route), or confirm that `markFixedByOwner` queues a recheck for them and test it | 30 min | frontend | open |
| CMP-608 | compliance | P1 | EAA exemption not re-confirmed this cycle (L-66) | none: headcount and turnover not given to me | Julian confirms "A101 under 10 staff and at most €2M turnover/balance on 21 Nov 2026" in the ship report | 1 min | Julian | open |

Process note: CMP-601 to CMP-603 are failures of items on my own phase-1 list (L-31, L-30, L-06), filed at the severity
written there. CMP-604 to CMP-607 were not on the list. None is a hard stop, so the foreseeability cap changes nothing.

Out of scope, for the record: the landing copy has used "Bakker Bart" as a competitor example since before this feature
(`copy/index.ts:459,463`, `en.ts:445,449`). One letter from the real chain is the same concern as B4. P3, not touched here.

## Needing a lawyer (ship report, not blocking)

1. Whether the mandate in terms art. 5 ("namens je bedrijf correctieverzoeken … alleen Gegevens die jij bevestigd
   hebt"), now that *Gegevens* includes product lines, is enough for a letter that asserts a certificate on the owner's
   word alone, or whether the owner should first upload or link proof. Filed P1 in phase 1; still open.
2. The phase-1 questions on sanctioned markets and on outlet letters are moot: the allow-list (B5) shipped and no outlet
   letter is ever sent (B1).

## Standing checklist

Two lines added to `docs/process/checklists/compliance.md` (Vidalo, 21 Nov 2026, 006).

## Round 2 (21 Nov 2026, last round)

Evidence: `DATABASE_URL= pnpm mail:lab` (OK, 14 mails, 0 with problems; `out/mail-lab/`), the mock server on :3100
signed in as `eigenaar@bakkerijdevries.nl`, and `vitest` on `legal`, `line-fixer`, `line-mail`, `product-lines`,
`no-preticked-boxes` (76 tests, green). Nothing committed, nothing fixed, hosted project not touched.

| ID | Round 2 | Evidence |
|---|---|---|
| CMP-601 | **closed** | `fixer/email-templates.ts:74,100`: with `ctx.line` both request and follow-up say "Dit gegeven is door de eigenaar aan ons bevestigd." and carry no URL; `test/line-fixer.test.ts:78-79` asserts no facts-page host and no "feitenpagina". Line 131 (directory diff) still cites the facts page; that path is business facts, not lines, correct |
| CMP-602 | **closed** | Mail lab NL monthly: "Google AI zei: Gentse Warenwinkel, niet in je lijst (1 van de 1 keer) / Verkoopt dit bedrijf je product wel? Voeg het dan toe aan je lijst. Dit is dan geen fout meer." No "Klopt niet" in the outlet block (EN in step: "It is then no longer an error"). `templates.ts:196-198`; `line-mail.test.ts:73` guards it |
| CMP-603 | **closed** | Each market sentence ends "Gevraagd aan ChatGPT, Google AI en Perplexity." / "Asked to ChatGPT, Google AI and Perplexity.", from `run.engines` (`reporter/index.ts:380`), not a fixed list |
| CMP-604 | **closed** | "België: deze maand niet gecontroleerd. Laatste controle: 7 oktober." when an earlier run exists; "nog niet gecontroleerd" kept for a never-run market (`templates.ts:696`, `copy/index.ts:3463-3464`) |
| CMP-607 | **closed** | `/app/fouten/0923a731-…` (outlet, BE): no "Ik heb dit aangepast", no "binnen een uur"; only "Dit klopt wél" plus "Geen hercontrole gepland". A forced POST of the `markFixed` action for that finding returns 303 to `?hercontrole=geen`, flash "Er loopt geen herstel voor deze fout; de volgende controle neemt hem mee." (`fixer/index.ts:346` returns null for outlet). "binnen een werkdag" on the page is the support line, unchanged |
| Legal lock | consistent | `legal.test.ts` green; `legal.lock.json` NL/EN "Versie van 21 november 2026" with new hashes, matching `copy.legal.updated` |
| Price wording | clean | No "€", "gratis", "inbegrepen", "included" or "free" in `copy/product-lines*.ts` or in the added lines of `copy/index.ts`/`en.ts`. The only "gratis" on the line pages is the site-wide meta description, pre-existing |

Still open, unchanged since round 1 and not in this round's scope: CMP-605 (UK/CH adequacy sentence, P2, bundle with
D1), CMP-606 (outlet counted in "niet kloppen", P2, Julian D5), CMP-608 (EAA headcount/turnover confirmation, P1,
Julian). Lawyer question 1 (certificate on the owner's word) stays in the ship report. No hard stop: compliance does not
block this cycle.
