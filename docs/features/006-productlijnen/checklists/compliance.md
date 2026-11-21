# Compliance checklist — 006 Productlijnen (phase 1, pre-build)

*compliance · 2026-11-21 · against `01-brief.md`, `02-architecture.md`, ADR-0010…0014, tickets
BE-01…06 and FE-01…05, `docs/processors.md`, `packages/core/test/legal.test.ts` and the legal
texts as of version 17 November 2026. I am not a lawyer; items marked **lawyer** are named in the
ship report as needing one.*

The phase-4 review checks every item below against the code and copy as shipped. Severity
in the right-hand column is the severity **if the item fails in phase 4**. A P0 that was
foreseeable and is not on this list is capped at P1 unless it is a legal hard stop.

## Verdict at phase 1

- **Legal hard stop in the design: none.** Two things would become one if they shipped a certain
  way: correction letters in the owner's name telling a third party that it does not sell a product
  it may well sell (B1, L-21), and a public mock page with a real retailer's or chain's name next to
  made-up findings (B4, L-40). Both are cheap to prevent and are listed under "Change before build".
- **Legal text change: needed in this PR, P1, not a hard stop.** This does not wait for D1/D2:
  the terms' definition of *Gegevens* and the mandate to send correction requests (art. 5) must
  cover product-line data before any line correction letter goes out, and the privacy statement's
  paid-plan block must say that product lines are kept, asked about per market and **not**
  published (L-01, L-02). The D1/D2 sentence (limit, price) stays a follow-up. So the
  architecture's "Privacy … expected none" row and FE-05's "`legal.test.ts` passes unchanged" are
  both overruled: the test will need one `NOT_RECIPIENTS` entry for the seed's `.example` URLs (L-52).
- **Internal records in the same PR:** `docs/processors.md` (AI vendors and "Sources with an
  error"), `docs/records-of-processing.md` (paid-plan row) (L-03).
- **Data export: needed.** The scope default (no line argument = business only) silently drops every
  line row from `exportMyData`, which the privacy statement promises contains "alles wat we over je
  bedrijf bewaren" (B2, L-10).

## Change before build (cheap now, a finding later)

| # | Ticket | Change | Why |
|---|---|---|---|
| B1 | BE-05 / ADR-0014 | An `outlet` finding ("niet in je lijst") never takes the automatic third-party correction path. It takes `LINE_KEEP_CHECKING_PATH` plus a line for the owner: "Verkoopt {outlet} je product wel? Voeg het toe aan je lijst." A correction letter is only sent for `spec`, `certificate` and `successor` | The architecture itself names the case "AI names a legitimate reseller the owner did not list". A letter in the owner's name asking a source to say a retailer does not sell the product is an untrue statement about a third party (BW 6:162; 6:194 for B2B communication). Not-in-the-owner's-list is not evidence of wrong |
| B2 | BE-01 / BE-02 | `exportMyData` (`core/shared/my-data.ts`) reads **every** scope: `listProductLines`, `listProductLineVersions` per line, and the line rows of `listScanRuns`, `listFindings`, `listPrompts` (pass an explicit "all scopes" option, never rely on the default). Add the line ids to the export tests | Art. 15 and 20 AVG, and the privacy statement's own promise. ADR-0011's scope default would make the export quietly incomplete, and no test fails |
| B3 | BE-01 / FE-01 / FE-02 | **Launch switch**: lines are visible and saveable only when an env flag is on (`VIDALO_PRODUCT_LINES=1`, default off in production) until D1 is decided and `/prijzen` and the terms name what a line includes, in one change | Terms art. 3 ("Welke onderdelen bij een Plan horen, staat op de prijspagina") and art. 3's "Verdwijnt er iets wezenlijks uit je Plan … kun je opzeggen". Giving every Monthly customer lines on deploy, with a banner saying "Productlijnen horen bij Vidalo Monthly", makes lines part of Monthly by conduct; moving them to an enterprise price later (D1) is then a removal that needs notice and a right to cancel. Also the cost row |
| B4 | BE-01 (`seedDemoLines`) | Every name in the seed is visibly fictional: replace "Delhaize" (a real Belgian retailer) and "Bakkerij Bart" (one letter from the real chain Bakker Bart) with made-up names; keep `.example` URLs | Mock data reaches public URLs (preview Worker, Pages snapshot). A real retailer shown as an outlet "niet in je lijst" with a fabricated finding is a published claim (standing rule from 001) |
| B5 | BE-01 / FE-02 | Markets: an allow-list `LINE_MARKETS` (proposal: EEA + CH + GB + US), not all 249 codes of `COUNTRY_CODES`. `parseProductLine` refuses others | Removes a sanctions question nobody has answered (a service that helps sell goods into RU, BY, IR, KP; correction letters to sources there), keeps the transfer picture to known countries, and makes the market control usable (249 checkboxes is not a form). **lawyer** if the full list stays |
| B6 | BE-05 (certificate letter) | A certificate correction letter states the owner's certificate **number** and validity date, and never asserts a certificate the owner's entry shows as expired | Gives the stored number its use (minimisation, L-12); a certification claim made in the owner's name must be the owner's verifiable claim (BW 6:194) |
| B7 | FE-05 | Add to the AC8 surface table: terms (L-01), privacy (L-02), `processors.md` + records (L-03), export (B2), `legal.test.ts` (L-52) | The PR's table is what Julian approves |

## 1. What a line holds, and is it personal data (BE-01, FE-02)

A product line is mostly not personal data: product names, categories, specifications,
certificate names. It becomes personal data where the brand is a sole trader's name, and the
free-text fields (outlet name, spec value, replaced-by) can carry a person's name or number if the
owner types one. Lawful basis: performance of the contract, art. 6(1)(b), as every paid-plan fact.

| ID | Item | Verified by | Sev |
|---|---|---|---|
| L-10 | The export holds product lines, every version, and the line rows of scan runs, findings, prompts, samples, claims and fixes (B2) | Test on MemDb and PgDb: export of the demo business contains both seed lines, their versions and a line finding | P1 |
| L-11 | Every stored field has a use: `name`, `category`, `useCases`, `specs`, `certificates.name`, `outlets` (matching), `replaces` feed questions or judging; `certificates.number` and `validUntil` feed the letter and the valid-on-date rule (B6); `outlets.url` feeds host matching; `replacedBy` is only shown to the owner — it stays only if it is shown on the detail page; otherwise it is dropped | Read `parseProductLine`, `lineFacts`, `generateLinePrompts`, the letter template and FE-03 | P2 |
| L-12 | The form hints say what each field is for and that it is about the product, not people: outlet name is a shop or company name, not a contact person; no phone numbers or e-mail addresses | Read `copy.productLines.form` NL and EN | P2 |
| L-13 | `replaces` is the owner's own older product names. The hint says so; a successor letter claims "X is the successor of Y" only for names the owner entered as its own | Read the hint and the successor letter wording | P2 |
| L-14 | No new retention class. Lines and versions live and die with the business: `on delete cascade` from `business`, reached by `deleteBusiness`, `purgeBusiness` and the 90-day post-churn deletion. No purge or retention selector reads scan runs or findings through the business-only default and leaves line rows behind | BE-02 test: after `purgeBusiness`, zero rows in `product_line`, `product_line_facts` and zero rows with that business's `product_line_id` in `prompt`, `scan_run`, `sample`, `claim`, `finding`, `fix`; grep purge code for scoped readers | P1 |
| L-15 | Events carry no names, outlet URLs or free text (`product_line.confirmed`, `.status`, `.refused`, `report.waiting`, `scan.*`, `job.skipped`); nothing from a line in worker logs | Payload-key tests; grep logs in BE-04/05 | P1 |
| L-16 | No personal data in URLs: query keys carry ids and codes only (`nieuw`, `bewerken`, `markt`, `betwist=<uuid>`, `fout=<field>:<reason>`). The fix for a lost form after a server error (L-62) never puts typed values in the query string | Read the actions and the form | P1 |

## 2. What goes to the AI vendors (BE-03, BE-04)

No new vendor. The same engines (OpenAI, Google Gemini, Anthropic, Perplexity, SerpAPI) are asked,
with the user location set to the market instead of the business's town.

| ID | Item | Verified by | Sev |
|---|---|---|---|
| L-20 | A line question contains only: the line name, the business name (" van {merk}"), category, use case, spec label, certificate name, old product name, country name. Every slot passes `sanitizeSlot`. No owner e-mail, no account data, no outlet URL, no spec value in the question | `generateLinePrompts` test asserting the slot set; read `line.ts` / `line.en.ts` | P1 |
| L-21 | The LLM extraction call for the four keys sends the answer text and at most the owner's own values for that key (spec value, outlet names) — nothing of another line, no account data. Write down in BE-04 exactly what the extraction prompt receives | Test spying on the extraction request body | P1 |
| L-22 | The engines get `country: market, place: ""` and no other location data; no IP or identifier of the owner reaches them | Read `runScan` line branch and `engines/types.ts` | P2 |
| L-23 | `docs/processors.md`: the "Business facts only" rows (Perplexity, Anthropic, SerpAPI) and the OpenAI and Google rows read "Business facts and product-line facts"; "Sources with an error" region reads "where the source is (NL/EU; for lines in other markets also outside the EU)" | Diff | P2 |

## 3. Legal texts (FE-05, plus the follow-up)

| ID | Item | Verified by | Sev |
|---|---|---|---|
| L-01 | **Terms, NL and EN, this PR.** (a) Definition *Gegevens* gains "en de gegevens van je productlijnen, zoals naam, specificaties, certificaten en verkooppunten" (EN in step). (b) Art. 5 (mandate): the correction requests "namens je bedrijf" cover product-line data the owner confirmed; it already says "alleen Gegevens die jij bevestigd hebt", so (a) is enough if the article reads right after it. (c) The *Feitenpagina* article (art. 7) is not changed: lines are not published (ADR-0014), so nothing in the terms may imply they are. (d) Art. 15's liability carve-out ("schade doordat Gegevens die je bevestigde niet klopten") then covers wrong product data, certificates included. Without (a), a correction letter about a product in the owner's name rests on a mandate that does not clearly cover it | Diff of `copy.legal.terms` in `index.ts` and `en.ts` | P1 |
| L-02 | **Privacy, NL and EN, this PR.** "Een betaald plan" → Gegevens: "de productlijnen die je invoert, met elke eerdere versie"; Wat we ermee doen: "We stellen AI-assistenten vragen over je productlijnen, per land dat je kiest, in de taal van dat land (Nederlands voor Nederland, anders Engels). Productlijnen publiceren we niet op je feitenpagina; bij een fout kunnen we de bron om herstel vragen." The sentence "we publiceren je bevestigde gegevens op je feitenpagina" must not read as covering lines. Basis and retention unchanged. "Met wie we gegevens delen": "Bronnen met een fout" gains "ook buiten Nederland, als je productlijn daar verkocht wordt" | Diff of `copy.legal.privacy` | P1 |
| L-03 | `docs/records-of-processing.md` paid-plan row gains "productlijnen (owner-entered, versioned)" and "landen buiten NL als vraaglocatie"; `processors.md` as L-23 | Diff | P2 |
| L-04 | **Follow-up after D1/D2 (not this PR):** one terms sentence on what a line includes (number of lines, markets, monthly check), the price **by reference to `/prijzen`**, never a second copy of the figure. Note that terms art. 8 already holds the plan prices as figures, which is an existing second copy; the line price must not add a third | Compliance drafts it with the pricing change | P1 then |
| L-05 | **What `legal.test.ts` requires when `copy.legal` changes** (L-01, L-02): a new `updated` in both files with the **same** date ("Versie van D november 2026" / "Version of D November 2026", parsed to the same ISO date); `draft: false` in both; `pnpm --filter @vidalo/core legal:lock` and `src/copy/legal.lock.json` committed; KvK 42057858 still in NL and EN terms and the EN contact line, btw number in the EN contact. `copy.productLines`, `copy.criteria[13..16]` and `copy.mails.monthly.lines` are outside `copy.legal` and need no new date | `pnpm --filter @vidalo/core test legal` green; diff of the lock file | P1 |
| L-06 | Terms art. 3 ("In elk rapport staat welke AI-assistenten we gevraagd hebben") holds for the line pages and the mail section: each market row names the AI systems by label, as text | FE-01/FE-03 view tests; mail lab | P1 |
| L-07 | Terms art. 4 ("We beloven niet dat een AI-assistent je bedrijf noemt, aanbeveelt of op een bepaalde plaats zet") is not contradicted: "genoemd als aanrader n van m keer", never a position, score, percentage or "meer genoemd worden"; the keep-checking wording claims no remedy (ADR-0014) | Jargon/promise test over `copy.productLines` and `copy.mails.monthly.lines`, failing when a banned phrase is planted | P1 |

## 4. Third parties and other markets (BE-05, FE-03)

| ID | Item | Verified by | Sev |
|---|---|---|---|
| L-30 | Outlet findings send no third-party letter (B1). Copy says "niet in je lijst", never "fout verkooppunt" or "verkoopt het niet" | Fixer test: an `outlet` finding with `third_party` source opens `LINE_KEEP_CHECKING_PATH`; read the copy | **P0 if a letter goes out** asserting a retailer does not sell the product (untrue statement about a third party in the owner's name, BW 6:162); P1 otherwise. **lawyer** if Julian wants outlet letters |
| L-31 | A correction letter about a line names the line and asks for the owner's confirmed value only; it says the request is on behalf of the business and is sent by Vidalo (as today's letters) | Mail lab: one `spec`, one `certificate`, one `successor` letter | P1 |
| L-32 | "Wie AI wel noemt" for a line shows other products or companies named by AI as counts, privately to the owner; no judgement of a competitor's product, no table setting the line against one (same reading as 001 C-28/C-29) | FE-03 view test | P1 |
| L-33 | Markets are limited to the allow-list (B5) | `parseProductLine` test: `RU`, `KP` refused | P1; **lawyer** if the full list stays |
| L-34 | Letters to sources outside NL stay Dutch (architecture). Not a legal point; noted so nobody claims otherwise in copy | Read | P2 |
| L-35 | A market is where the owner's buyers are, not where Vidalo sells. Checkout, VAT and the "Vidalo is er alleen voor bedrijven" basis are unchanged; a foreign *business* still needs Stripe Tax (`?betaling=buitenland`) | `git diff --stat` shows no change in `billing/` or checkout | P1 |

## 5. Price, VAT, plan (all tickets)

D1 and D2 are open, so no price may be written.

| ID | Item | Verified by | Sev |
|---|---|---|---|
| L-40 | No price, no "gratis", "inbegrepen", "zonder extra kosten", "upgrade" or amount for lines in any copy, page, mail, doc or assistant knowledge. The limit message states the number only | Grep of the new copy keys and docs for `€`, `EUR`, `gratis`, `inbegrepen`, `included`, `free` | P1 (a price misstated to a B2B customer is P1 under BW 6:194, not a consumer VAT P0: Vidalo sells only to businesses) |
| L-41 | When D1 is decided: the price comes from the single price source, shown "excl. btw" with "Alle prijzen excl. btw" next to it (`docs/legal-compliance-guidelines.md`), on `/prijzen` and wherever it appears, with the terms by reference (L-04) | Phase 4 of the pricing change | P1 |
| L-42 | Launch switch (B3): with the flag off in production, no nav item, no page content beyond `notFound()` or a neutral line, no line jobs from the cron | Test with the flag unset; read `enqueueMonthlyScans` | P1 |
| L-43 | The access banner does not state what a plan includes before `/prijzen` does: "Productlijnen horen bij Vidalo Monthly" only once the price page says so; until then a neutral reason | Read `copy.productLines.access.no_monthly_plan` | P1 |
| L-44 | Invoices, cancellation terms and the pay button are not touched. A future line price that changes a running Monthly subscription is a price change for that customer: 30 days' notice and the right to cancel (terms art. 8) | `git diff --stat` | P1 |

## 6. Cookies, storage, hosts (all tickets)

| ID | Item | Verified by | Sev |
|---|---|---|---|
| L-50 | No new cookie or `…COOKIE…` constant; the form, the market picker and the add/remove rows keep their state in the DOM only | `legal.test.ts` cookie table tests green | P0 if a non-essential identifier appears; P1 otherwise |
| L-51 | No `localStorage`, `sessionStorage` or `indexedDB`, also not as a draft store for the form | `legal.test.ts` "nothing writes browser storage" green | P1 (the privacy statement says we use none) |
| L-52 | The seed's URLs (`https://versmarkt-haarlem.example`, `https://broodhuys-gent.example`, `https://broodwiki.example/…`) are outside hosts to the test's regex and will fail "every outside host is a known recipient". Add `"example": "reserved TLD (RFC 2606) in the mock seed, never resolves"` to `NOT_RECIPIENTS`. Owner-entered outlet URLs are data, never fetched by the line code; if any code fetches them, that is a new recipient question | `legal.test.ts` green; grep `fetch(` in line code | P1 |
| L-53 | No new vendor SDK in any `package.json` | Diff of the three package files | P1 |

## 7. Accessibility of the new forms (FE-01…FE-04)

Not a compliance veto. The EAA microenterprise exemption is assumed (A101 under 10 staff and at
most €2M), and Vidalo is sold only to businesses, which takes it outside the EAA's consumer
e-commerce scope on a second ground. WCAG 2.2 AA is the brief's bar, enforced by QA and
`docs/process/checklists/a11y.md`. Listed here so QA has the form-specific points.

| ID | Item | Verified by | Sev |
|---|---|---|---|
| L-60 | Every input has a visible label; markets in a `fieldset` with `legend`; spec, certificate and outlet rows grouped with a legend per group; the date field shows its format; required fields say so in text (1.3.1, 3.3.2) | axe + read the markup | QA |
| L-61 | Errors tied to their field (`aria-invalid`, `aria-describedby`), described in words, focus to the first error, the same message after the no-JS server redirect (3.3.1, 3.3.3) | Playwright keyboard and no-JS runs (FE-02) | QA |
| L-62 | **Redundant entry (3.3.7):** a server refusal must not empty the form. With `redirect(?fout=…)` a new line's typed values are lost; render the error with the submitted values (`useActionState` or re-render), never by putting them in the URL (L-16) | No-JS run: submit an invalid outlet URL, the other fields keep their values | QA (P1 usability) |
| L-63 | Add/remove row buttons have specific names ("Specificatie 2 verwijderen"), move focus sensibly after add and remove, and are at least 24 × 24 px (2.5.8); the max count is said in text, not only by a disabled button | Keyboard run; axe | QA |
| L-64 | Status messages (`?opgeslagen`, `?status`, `?fout`, limit reached) in an `aria-live` region (4.1.3); dots carry the AI system and status as text (1.4.1) | FE-01 test | QA |
| L-65 | The confirmation sentence ("Je bevestigt dat deze gegevens kloppen …") sits next to the submit button, before the commitment | Read | QA |
| L-66 | Phase 4 re-asks headcount and turnover. The day A101 passes 10 staff or €2M, or Vidalo starts selling to consumers, WCAG 2.2 AA failures on these screens become a legal hard stop | Ask; record in the ship report | P1 |

## 8. Copy and claims (FE-01…05, BE-06)

| ID | Item | Verified by | Sev |
|---|---|---|---|
| L-70 | "We gebruiken ze vanaf de volgende maandelijkse controle" is true only for an owner whose line jobs the cron enqueues; for a paused owner the sentence says so or is not shown | Read against `enqueueMonthlyScans` and `productLineAccess` | P1 |
| L-71 | "Built is not runs": no copy, `/organisaties` included, says lines are in the dashboard until the feature runs on production with the flag on (brief, follow-up 1) | Read the follow-up list in `04-build.md` | P1 |
| L-72 | NL and EN for every new string, informal "je", no exclamation marks, no emoji, none of GEO, AEO, LLM, prompt, platform, zichtbaarheid, agent, ranking, positie, score, "%" | Typecheck; jargon test | P2 |
| L-73 | AI Act: no AI system offered to people is added; the line pages show AI answers labelled by AI system, as today | Read | P2 |
| L-74 | Julian approves the PR before merge; no agent message counts as his approval (AC8) | PR review state | P1 |

## Needing a lawyer (named in the ship report, not blocking)

1. Whether the terms' mandate to send correction requests "namens je bedrijf" covers product data
   once *Gegevens* is extended (L-01), and whether a correction letter about a certificate needs
   more than the owner's assertion. Filed P1.
2. Markets: if Julian wants every country code rather than the allow-list (B5), whether a service
   that tests and corrects what AI says about goods sold into sanctioned countries (RU, BY, IR, KP)
   touches EU sanctions rules. Filed P1.
3. Outlet letters: if Julian wants Vidalo to write to sources about outlets anyway, the wording that
   avoids an untrue statement about a third-party retailer (L-30).

## Learned here, for the standing list

Added to `docs/process/checklists/compliance.md` (Vidalo, 21 Nov 2026). Proposed for the playbook
template, because it applies to every venture: "a feature switched on for existing subscribers
before the price page names it becomes part of their plan".
