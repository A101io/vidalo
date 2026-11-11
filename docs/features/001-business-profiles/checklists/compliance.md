# Compliance checklist — 001 Business profiles (phase 1, pre-build)

*compliance · 2026-11-11 · against `01-brief.md` (Amendment A wins), `02-architecture.md`,
ADR-0001…0006, tickets BE-01…08 and FE-01…04. I am not a lawyer; items marked **lawyer** are
named in the ship report as needing one.*

The phase-4 review checks every item below against the code and copy as shipped. Severity
in the right-hand column is the severity **if the item fails in phase 4**. A P0 that was
foreseeable and is not on this list is capped at P1 unless it is a legal hard stop.

## Verdict at phase 1

- **Legal hard stop in the design: none.** One item (C-30) *becomes* a hard stop if it ships
  in a particular way: a public page naming a real competitor of an A101 venture with
  counts produced by mock data. The fix is cheap and is listed under "Change before build".
- **Legal text change: needed, P1, not a hard stop.** One addition to the privacy statement
  (NL and EN), a new version date and `pnpm --filter @vidalo/core legal:lock` (C-03). The
  terms need no change (C-05). FE-04's "none expected" row for terms and privacy is
  therefore overruled for privacy.
- **Internal records change in the same PR:** `docs/processors.md` (OpenAI row) and
  `docs/records-of-processing.md` (free check and paid plan rows) (C-04).

## Change before build (cheap now, a finding later)

| # | Ticket | Change | Why |
|---|---|---|---|
| B1 | BE-04 / ADR-0002 §3–4 | Remove e-mail addresses and phone numbers from the website text and the lookup prose before they go into the classify call | Data minimisation (AVG art. 5(1)(c)): classifying what a business sells needs neither. `docs/processors.md` promises OpenAI gets "never email addresses"; a sole trader's homepage carries theirs (C-08) |
| B2 | BE-05 / ADR-0004 | Door and visit rows in `question_use` store **no fact values**, not only `{naam}`/`{plaats}`: owner policies (`Geldt bij … : "<policy>"?`), services and credentials are inserted verbatim into today's question text (`prompts/index.ts:130`, `sectors.ts:272`). Store the key's generic text, or replace every fact value with a slot | The ledger outlives the business (`on delete set null`). Owner-entered text in it survives the deletion the privacy statement promises (art. 5(1)(e), art. 17) (C-14) |
| B3 | ADR-0002 §7 / BE-04 `mockUnderstand` | Mock competitor names fictional, not "Soundtrack Your Brand" and "Spotify Business" | Mock data reaches public URLs (GitHub Pages snapshot, the preview Worker). A101 B.V. runs Sonable: a public page showing Sonable next to its real competitors with made-up counts is comparative advertising by A101 that is not objective or verifiable (BW 6:194a(1), 6:194) (C-30) |
| B4 | FE-01 | The profile sentence on the waiting page is phrased as Vidalo's reading ("We lezen Sonable als: …"), not as a fact ("Sonable: achtergrondmuziek voor …") | Same rule as "Gecontroleerd als"; the waiting page is shown to whoever started the check, which may be someone other than the owner (C-20) |
| B5 | FE-04 | The `docs/CRITERIA.md` change also amends principle 1 (line 10: "Niet: … hoe vaak je genoemd wordt tegenover concurrenten"), not only "Wat de scan bewust niet beoordeelt" | Otherwise the rules document contradicts the product. The scanner follows CRITERIA literally (C-25) |
| B6 | FE-02 | The plan panel on an online report is checked line by line against what setup does for a business without a listing. "Voor Google, Bing, Apple en de bedrijvengidsen: wat daar anders staat…" must not show unqualified to a business that has no listing to compare | A sales statement of fact shown next to a price (BW 6:194). The brief requires it ("must not promise Dutch directory sync") but no ticket owns it (C-33) |
| B7 | FE-04 | Add to the surface table: privacy statement (C-03), `docs/processors.md` and `docs/records-of-processing.md` (C-04) | The PR's surface table is what Julian approves |

## 1. Personal data: the understanding step (BE-04)

A sole trader's business name, town, website text and phone number are personal data
(privacy statement, "Over wie het gaat"). The lawful basis is the free check's existing one:
legitimate interest, art. 6(1)(f). Paid checks rest on the contract, art. 6(1)(b).

| ID | Item | Verified by | Sev |
|---|---|---|---|
| C-01 | The lookup sends OpenAI only the name (after `sanitizeSlot(…,"name")`), the place and the country. No requester e-mail, no owner e-mail, no IP address, no token | BE-04 unit test spying on the request body; read `understand.ts` | P1 |
| C-02 | The classify call sends only the JSON object in ADR-0002 §4: name, place, country, Google types and flags, website host and at most 4,000 characters of text, and the lookup prose. No other business's facts, no account data | Test asserting the exact keys of the user message | P1 |
| C-03 | **Privacy statement, NL and EN, new version date, `legal:lock`.** "De gratis controle" (and its EN twin) says: (a) before asking, we work out what the business offers and for whom, from Google, the business's own website and one search through OpenAI, and store that description with the business; the owner can correct it in their account; (b) names of other businesses that AI assistants give are shown in the report with how often they were named, and in a paid plan can be used in a question to AI assistants. "Over wie het gaat" names businesses that AI assistants mention next to the one checked. Basis stays art. 6(1)(f). No new vendor | Diff of `copy.legal.privacy` in `index.ts` and `en.ts`; `updated` changed in both; `legal.lock.json` updated; `legal.test.ts` green | P1 |
| C-04 | `docs/processors.md` OpenAI row: "Business facts and the text of the business's own homepage (e-mail addresses and phone numbers removed); never account e-mail addresses". `docs/records-of-processing.md`: free check row gains "description of what the business offers (derived)" and "names of other businesses that AI answers give"; paid row gains "the owner's correction of that description" | Diff | P1 |
| C-05 | Terms need no change: art. 34 ("welke vragen we stellen … kiezen wij"), 45/49 ("We beloven niet dat een AI-assistent je bedrijf noemt, aanbeveelt of op een bepaalde plaats zet"), 63 (a report of another business is not used to mislead or harm) and 151 (general figures not traceable to a business) already cover the feature. Phase 4 re-reads them against the shipped copy | Read the terms against the final copy | P1 if contradicted |
| C-06 | The lookup prose and the website text are **never stored or logged**: not in `business`, `scan_run`, `sample`, events, `ScanJobState`, worker logs or `out/` files. Only the sanitised slots are kept | BE-04 test with a sentinel string in the fixture prose and site text, asserting it appears in no MemDb table, event payload or stored state | P1 |
| C-07 | `profile.decided` and `profile.corrected` carry no free text (modes, source, confidence, basis, cost only) | BE-04 / FE-03 tests on the payload keys | P1 |
| C-08 | E-mail addresses and phone numbers are removed from the site text and the lookup prose before classify (B1) | BE-04 test: fixture homepage with `info@jansen.nl` and `06 12345678`; the classify request contains neither | P1 |
| C-09 | A refused name makes no lookup, and a fallback or low-confidence profile is never written to `profile_auto` (nothing derived is stored about a name that does not resolve to a business) | BE-04 tests (already in its "Done when") | P1 |
| C-10 | The understanding step adds no cookie, no browser storage and no new outside host in the source. If a literal host appears (a mock website such as `https://www.sonable.io`), it goes into `NOT_RECIPIENTS` in `legal.test.ts` with the reason "mock fixture, never fetched", not into `HOSTS` | `legal.test.ts` green; diff of the test file | P1 |

## 2. The stored profile: retention, correction, deletion (BE-01, BE-02, BE-05, FE-03)

| ID | Item | Verified by | Sev |
|---|---|---|---|
| C-11 | `profile_auto`, `profile_owner` and `scan_run.profile` live on rows that are deleted with the business: owner deletion on `/app/account` (`deleteBusiness`) and the 12-month free-check purge when it is built. No new retention class appears. The purge itself is an existing go-live gap, not this feature's | BE-02 test: after `deleteBusiness`, no row holds the profile; read the go-live list for the purge item | P1 |
| C-12 | The data export (`exportMyData`, `/api/account/export`) contains `profileAuto`, `profileOwner` and each scan run's `profile` (art. 15 and 20) | Test on MemDb and PgDb that the export JSON holds the three fields | P1 |
| C-13 | Correction (art. 16): a verified owner corrects mode, offer, audience and category on `/app/gegevens`; a later automatic run never overwrites it. Someone who is not a paying owner (a sole trader checked by someone else) corrects or deletes through support, as the privacy statement already says | FE-03 action test; BE-01 MemDb test; read the report copy for the support route (C-21) | P1 |
| C-14 | `question_use` rows and `question_library` hold **no** business name, place, address, phone, website, owner policy, service, credential or competitor name, for every mode. `online.alt.competitor` is stored as `{concurrent}`. After `deleteBusiness` no surviving row contains any string from that business's facts or profile (B2) | BE-05 test over door, visit and online fixtures with distinctive fact strings; BE-02 deletion test extended to grep the surviving rows | P1 |
| C-15 | `out/library.md` and the SQL view show templates only, never business names; numbers as "n van m" | BE-05 test (already listed) | P2 |
| C-16 | `profile_auto.competitors` (up to 3 names of other businesses, possibly sole traders) has a named use: the competitor questions of the first paid full check. The status endpoint and the waiting page never return competitors | BE-07 status-route test asserting no `competitors` key | P1 |

## 3. "Gecontroleerd als": Vidalo's reading, not a fact (FE-01, FE-02, BE-08, BE-06)

| ID | Item | Verified by | Sev |
|---|---|---|---|
| C-20 | The waiting page, the report, the CLI markdown and any mail word the profile as **how Vidalo read the business** ("Gecontroleerd als: …", "We lezen X als: …"), never as a statement about the business. A `fallback` profile shows the mode words only (B4) | Read the NL and EN copy keys; FE-01 and FE-02 view tests | P1 |
| C-21 | The report says where the description came from in plain words (Google, the website, an AI search) and how to correct it: owners → `/app/gegevens`, everyone else → support@vidalo.io | Read the copy; browser check | P1 |
| C-22 | The profile's offer or category is **never published or sent on as a fact**: not on the facts page (`publisher/render.ts`), not in a correction request to a source, not in a Google Business Profile sync, unless it came from `profile_owner`. ADR-0001 says the facts page does not publish it; an `identity:kind` finding takes the model-memory route and sends no letter (BE-06) | Test that render output and fix letters for a business with an auto profile contain neither `offer` nor `category`; read the `identity:kind` fix path | P1 |
| C-23 | "Beschreven als een ander soort bedrijf" (criterium 11) is judged only against a **grounded** offer (Google, own website, owner). An offer from the AI lookup alone leaves the answer unchecked, never wrong (ADR-0005; BE-06) | BE-06 test (already listed) | P1 |
| C-24 | Customer-facing copy does not call this a "profiel". The privacy statement says "we maken geen profielen van personen", and "bedrijfsprofiel" already means the Google Business Profile in the copy | Grep of the new copy keys | P2 |

## 4. `docs/CRITERIA.md` changes (FE-04)

| ID | Item | Verified by | Sev |
|---|---|---|---|
| C-25 | The amendment is narrow and consistent in **both** places (principle 1 and "Wat de scan bewust niet beoordeelt"): per question we show who AI names and how often, as counts; never a position, percentage, score or "jij versus de buren" table; the dot stays about facts; no promise to change who is named (B5) | Diff of `docs/CRITERIA.md` | P1 |
| C-26 | Criterium 11 gains "of beschrijft je als een ander soort bedrijf" and keeps "een ander bedrijf" for other names (standing rule of 11 Nov: a label describes what the heuristic actually detects) | Diff | P2 |
| C-27 | The A2 family table and the online question set in CRITERIA match `prompts/profile.ts` and `prompts/online.ts` as shipped | Compare the doc with the code | P2 |

## 5. The competition block: claims and competitors (FE-02, BE-06)

Legal reading, not advice. The report is shown to one owner by a private, noindexed link. It
is not advertising by Vidalo for its own goods, and the named businesses are not Vidalo's
competitors, so the comparative-advertising rules (BW 6:194a) do not apply to the report as
such. The general misleading-statement rule for business-to-business communication (BW 6:194)
and the tort rule (BW 6:162) do: what the block says about the owner's business and about
others must be true and must not disparage. The exception is A101's own ventures (C-30).

| ID | Item | Verified by | Sev |
|---|---|---|---|
| C-28 | Every count is computed from the stored samples of that check ("n van m antwoorden"); the business's count plus the answers without it add up to the answers. Per standing rule (11 Nov), the same count is used on every surface that shows it | FE-02 view test; BE-06 summary test | P1 |
| C-29 | The block shows no score, no "%", no rank, "plek", "#1", no "ranking" or "share of voice", no table setting the business against a competitor, and no judgement of a competitor. Quotes are about the business only: they contain none of the listed names (ADR-0005) | FE-02 test on the block text; BE-06 quote test; FE-04 jargon test | P1 |
| C-30 | **No publicly reachable page** (vidalo.ai, the preview Worker, the GitHub Pages snapshot, `/r/voorbeeld*`, social or landing material) shows a real competitor name next to an A101 venture with counts or quotes from mock data. Mock and demo competitors are fictional and captioned as such (house rule: every fictional example carries its caption). Using the real Sonable report in marketing needs its own legal review first (B3) | Grep `mockUnderstand`, `apps/web/lib/demo.ts` and the snapshot output for the competitor names | **P0 hard stop if shipped publicly** (BW 6:194a(1)(b)(c), 6:194); P1 while it is mock-only and unpublished |
| C-31 | Quotes are AI's words, verbatim, attributed to the AI system that gave them and dated by the check. A sentence cut at 240 characters is marked as cut. Never paraphrased into Vidalo's voice | FE-02 view test; read the rendering | P1 |
| C-32 | The block says plainly that these are the names AI gave at the moment of the check, that answers differ per day, that being named does not change the colour, and that Vidalo fixes facts and does not decide who AI names. This matches terms art. 45–49 | Read the `note` copy, NL and EN | P1 |
| C-33 | No copy shown to an online business promises what the code does not do for it: directory sync, Google Business Profile, "vestiging" wording. The plan panel's lines are checked against what setup actually does for a business without a listing (B6). The price still comes from the single price source, with "excl. btw" next to it as on every plan surface (B2B, `docs/legal-compliance-guidelines.md`) | FE-02 browser check of the online plan panel; diff | P1 |
| C-34 | Nothing promises that Vidalo makes AI name, recommend or rank the business ("zorgen dat … genoemd", "we make sure … named", "garanderen", "meer genoemd worden"), on any new or changed surface including the FAQ entry "Werkt dit ook als ik geen winkel heb?" | FE-04 jargon and promise test, failing when a banned phrase is planted | P1 |

## 6. Surfaces, copy and approval (FE-04, AC-7)

| ID | Item | Verified by | Sev |
|---|---|---|---|
| C-35 | One PR updates every surface that describes the product, and its description carries the surface table: landing "Zo werkt Vidalo", FAQ, pricing (or one line why not), CRITERIA, MESSAGING, ARCHITECTURE, assistant knowledge, mails, terms (one line: none needed, C-05), **privacy (C-03)**, processors and records (C-04) | QA and compliance read the PR table against the diff | P1 |
| C-36 | Julian approves the PR before merge. No agent message counts as his approval | PR review state on GitHub | P1 |
| C-37 | Every new string exists in NL (`copy/index.ts`) and EN (`en.ts`); `online.en.ts` matches `online.ts` key for key; Dutch informal "je", no exclamation marks, no emoji; none of GEO, AEO, LLM, prompt, credits, zichtbaarheid, platform, agent, ranking, share of voice, score, "%", garantie or gegarandeerd | Typecheck; parity test; FE-04 jargon test | P1 |
| C-38 | The landing step "we first read what the business does" names only what the code does (Google, the website, one AI search), as built and run, not as planned (standing rule: "built" is not "runs") | Compare the copy with `understand.ts` and one real run (AC-A1's real Sonable check) | P1 |
| C-39 | The real Sonable check (AC-2 / AC-A1) is read by hand before any copy cites it, and any finding there is checked against Sonable's own sources | QA's read of `out/scans/*.md` | P2 |

## 7. Unchanged obligations, re-checked

| ID | Item | Verified by | Sev |
|---|---|---|---|
| C-40 | Consent: no new cookie, identifier or browser storage. The waiting page polls with no new cookie; the CSS animation needs none | `legal.test.ts` green (cookie table equals code, no storage writes) | P0 if a non-essential identifier appears |
| C-41 | Prices, VAT, invoices, cancellation terms and checkout are not touched by this feature. Any diff in `billing/`, checkout or Stripe code is out of scope and reviewed on its own | `git diff --stat` against main | P1 |
| C-42 | Accessibility is not a compliance veto: the EAA microenterprise exemption is assumed to apply (A101 under 10 staff and at most €2M). AC-8 is enforced by QA. Phase 4 re-asks the headcount and turnover; the day either passes the threshold, WCAG 2.2 AA failures on these three screens become a legal hard stop | Ask at phase 4; record the answer in the ship report | P1 |
| C-43 | AI Act: the feature adds no AI system offered to people. The understanding step is internal; the visitor sees its output labelled as Vidalo's reading (C-20). The existing art. 50 points stay with the legal desk (`docs/legal-compliance-guidelines.md`, counsel question 7) | Read | P2 |

## Needing a lawyer (named in the ship report, not blocking)

1. Whether naming third-party businesses (some of them sole traders) in a customer's report,
   and using those names in questions to AI assistants, is fully covered by the privacy
   statement under AVG art. 14(5)(b), or also needs a balancing test on file (LIA). Filed P1
   through C-03.
2. Using competitors' trade names in questions sent to AI systems ("alternatief voor X") and
   showing them in a private report: assumed to be referential, non-trade use (no trademark
   infringement). Low risk; confirm.
3. A customer who publishes their own report, with named competitors and counts: terms
   art. 63 puts the responsibility on them. Confirm that suffices.

## Learned here, for the standing list (proposed; this run writes only this file)

- A usage ledger or statistics table that outlives deletion must hold no fact values, only
  templates. Replacing the name alone is not enough when question texts embed owner-entered
  text.
- Mock data that reaches a public preview is published content: real third-party names with
  fabricated numbers there are claims.
- A model call that classifies a business from its homepage gets the text with e-mail
  addresses and phone numbers removed.
