# Compliance review, round 1 — 001 Business profiles (phase 4)

*compliance agent · 2026-11-15 (night run of 14 Nov) · branch `claude/verify-2026-11-15-001-business-profiles`
at `7945202` (= `main` `1cf3de5` plus QA's test commit, which I did not touch); feature commits
`a8a7150..d6966c8` (PR #120, #127). Against `checklists/compliance.md` (B1..B7, C-01..C-43),
`01-brief.md` (Amendment A wins), ADR 0001..0007. I am not a lawyer; items marked **lawyer**
need one. No Supabase connector or database tool was used; nothing hosted was touched; no legal
text was changed.*

## Verdict

- **Legal hard stop (P0): none.** The privacy statement (NL + EN, version 14 November 2026)
  matches the code after ADR 0007: it no longer mentions an OpenAI search, and it names a
  website the requester gives as a source. No real brand sits in mock or demo data on a public
  page. No new cookie or storage.
- **Counts (47 rows: B1..B7, C-01..C-16, C-20..C-43):** 36 PASS, 6 FAIL (B5 = C-25 and B7 = C-35 are one defect each, so four defects), 2 MOOT, 3 NOT VERIFIED.
- **Findings:** 1 × P1 (a wrong source sentence on every automatic "Gecontroleerd als"), 5 × P2.

## Runs

| What | Result |
|---|---|
| `npx vitest run test/legal.test.ts test/copy-profiles.test.ts test/understand.test.ts test/my-data.test.ts test/question-library.test.ts test/db-profiles.test.ts test/report-online.test.ts` (packages/core) | 7 files, 179 passed, 15 skipped (the PgDb-only cases in `db-profiles.test.ts`: no `TEST_DATABASE_URL`) |
| Full suite (caller, before this run) | typecheck 0, core 1419 / 23 skipped, worker 52, e2e:mock OK |
| GitHub PR #120 and #127 (read only) | #120 merged by `A101io` at 15:27:00, 59 s after it was opened, no reviews; body has no surface table |

## Items

| ID | Status | Evidence |
|---|---|---|
| B1 | PASS | `scanner/understand.ts:140` `redactContacts`, applied at `:304` before `classifyRequest`; test `understand.test.ts:549` "never sends an e-mail address or a phone number" |
| B2 | PASS | `prompts/library.ts:102-110` `templateTextOf`: door/visit rows hold a generic label ("Vraag over …"), never question text; tests `question-library.test.ts:166` (door questions do embed owner values, so the test is not vacuous), `:355` (after deletion no row holds name, offer, audience, policy or service) |
| B3 | PASS | `mockUnderstand` returns `competitors: []` (`understand.ts:240`); mock engines use generic surnames (`engines/mock.ts:60`); `scripts/e2e-mock.mts:243` asserts no Sonable, Mood Media, Soundtrack Your Brand or Spotify in the online mock output |
| B4 | PASS | `copy/index.ts:1399-1400` "We lezen {naam} als: …"; EN `en.ts:1365-1366`; fallback says nothing (`understand.test.ts:504`) |
| B5 | FAIL | `docs/CRITERIA.md:10` principle 1 unchanged: "Niet: … hoe vaak je genoemd wordt tegenover concurrenten". Only "Wat de scan bewust niet beoordeelt" (`:251`, `:254`) was amended. V1-COMP-02 |
| B6 | PASS | `copy.result.plan.online` (`index.ts:1614-1628`): no Google, Bing, Apple or directories, "1 bedrijf", "Excl. btw"; `apps/web/lib/report.ts:499` uses `O.stepFacts` when online; test `report-online.test.ts:105`. Related gap in the self-help block: V1-COMP-03 |
| B7 | FAIL | PR #120 body lists "Privacy text: …" in one line; no surface table, and processors / records are not named. V1-COMP-04 |
| C-01 | MOOT | The lookup is gone (ADR 0007); `understand.test.ts:379` (no search tool, exactly one tool-less request), `:392` (no `responses` member). Name and place still go through `sanitizeSlot` (`understand.ts:292-293`) |
| C-02 | PASS | `classifyRequest` (`understand.ts:186-206`): `bedrijf{naam,plaats,land}`, `google{types,heeftAdres,alleenWerkgebied}`, `website{host,tekst}`; tests `:511`, `:531`, `:589` |
| C-03 | PASS | Privacy NL `index.ts:1004-1011`, EN `en.ts:981-988`: describes the classification without a search, the requester's website as a source, other businesses' names with counts; paid section `index.ts:~1057-1061` (owner's correction, names used in "Wat is een goed alternatief voor [naam]?", basis 6(1)(f)); "Over wie het gaat" `index.ts:1000`. `updated` = 14 November 2026 in both, `legal.lock.json` matches; `legal.test.ts` green |
| C-04 | PASS | `docs/processors.md:8` (one classification call, no web search, contacts removed, 4,000 chars); `docs/records-of-processing.md` free row (derived description, typed website, other names) and paid row `:13` (owner correction, names used in questions). Small gap on the question engines' rows: V1-COMP-05 |
| C-05 | PASS | Terms `index.ts:796` (we choose the questions), `:811` (no promise to be named, recommended or placed), `:825` (no misuse of another business's report). Nothing in the shipped copy contradicts them |
| C-06 | PASS (by reading) | `understand.ts:281-350`: page text lives only in local variables; logs carry `reason` only (`:286`); the returned profile holds sanitised slots. No sentinel test as the checklist asked; not filed, low risk |
| C-07 | PASS | `profile.decided` keys (`understand.ts:398`), test `:744`; `profile.corrected {from,to}` modes only (`shared/profile-correction.ts`, 04-build FE-03) |
| C-08 | PASS | As B1 |
| C-09 | PASS | No lookup to make; fallback never stored: `understand.ts:386-396`, tests `:214`, `:308`, `:357` |
| C-10 | PASS | `legal.test.ts` green; no new host in source (sonable.io / vloedlijn hosts only in tests) |
| C-11 | PASS (MemDb) | Profile columns on `business` / `scan_run` (`0015_business_profiles.sql`), runs cascade from business (`0001`); typed website is a `facts` row (cascade). Tests `db-profiles.test.ts:189`, `:204` are PgDb-only and skipped here. The 12-month purge is still a go-live blocker (`docs/go-live-checklist.md:81`), not this feature's |
| C-12 | PASS (MemDb) | `shared/my-data.ts:46-47` `profiles {auto, owner}`; each run carries `profile` (`scans: {...run}`); tests `understand.test.ts:783-791`, `export-secrets.test.ts:64` |
| C-13 | PASS | Owner correction on `/app/gegevens` (FE-03 tests); privacy paid section says how; report `fixOther` "Mail het naar" support |
| C-14 | PASS (MemDb) | As B2; `libraryCategory` drops a category containing the name (`library.ts:114`, test `:206`); `online.alt.competitor` stored as its template (`templateTextOf`, test `:197`) |
| C-15 | PASS | `question-library.test.ts:293` |
| C-16 | PASS | `competitors` is always `[]` (test `understand.test.ts:471`); no `competitors` in `apps/web/app`, `apps/web/lib` or `scanner/progress.ts` (grep) |
| C-20 | PASS | "Gecontroleerd als …", "Het is onze lezing, geen feit over je bedrijf" (`index.ts:1550-1556`); mails use `mails.online.reading`; fallback shows mode words only (`shared/checked-as.ts:15-16`) |
| C-21 | FAIL | The source sentence is fixed text: "Zo lazen wij je bedrijf, uit Google en je website" (`index.ts:1555`, EN `en.ts:1514`), chosen by `profile.source` only (`checked-as.ts:17`). A business with no listing, read from a typed website (the case ADR 0007 was built for), is told we read Google. V1-COMP-01 (P1) |
| C-22 | PASS (by reading) | `publisher/render.ts` does not read a profile (grep: no `profile` in `publisher/`); `insertFacts` drops `Facts.profile` (test `understand.test.ts:759`). No dedicated render test as asked |
| C-23 | MOOT | Only grounded profiles exist now (`isGroundedProfile`, `understand.ts:270`); `basis: ai_lookup` is never produced (test `:316`) |
| C-24 | PASS | No customer string calls it a "profiel" (grep: remaining hits are Google-profiel, legal, owner channel pages) |
| C-25 | FAIL | As B5. V1-COMP-02 |
| C-26 | PASS | `docs/CRITERIA.md:33`, `:114` |
| C-27 | FAIL | `docs/CRITERIA.md:96` still says the step "stelt één AI-zoekopdracht ('Wat is X in Y?')", "De bezoeker krijgt geen extra veld", and falls back to "de online set voor een bedrijf zonder" (now the neutral set); `docs/ARCHITECTURE.md:5` "one AI lookup with web search … up to 3 competitors". V1-COMP-02 |
| C-28 | PASS | `competitionCountsOf` shared by page and mail; `report-online.test.ts:25`, `report-view-counts.test.ts` (d6966c8) |
| C-29 | PASS | `report-online.test.ts:44`, `copy-profiles.test.ts` (36 tests, banned words and promise pattern) |
| C-30 | PASS | Demo online report uses fictional names ("Vloedlijn Audio", "Klankbord Collectief" …, `apps/web/lib/demo.ts:298-367`) with caption `result.competition.demoCaption` (`page.tsx:168`); `scripts/site/snapshot.mjs:58` does not snapshot `/r/voorbeeld-online`; no Soundtrack/Spotify/Sonable in demo, mocks or snapshot (grep). Residual note under V1-COMP-06 |
| C-31 | PASS | `scanner/recommendations.ts:77` `QUOTE_MAX = 240`, cut marked with "…" (`:96`); quotes carry the engine (`report.ts:262`) |
| C-32 | PASS | `result.competition.note` (`index.ts:1545`): counts only, never order, dot unaffected, "Of AI je noemt, bepalen wij niet" |
| C-33 | PASS | As B6, plus "Excl. btw" on both online lines. See V1-COMP-03 for the self-help block (advice, not a promise) |
| C-34 | PASS | `copy-profiles.test.ts` promise pattern green; FAQ `index.ts:666` "Of AI je noemt, kunnen wij niet bepalen" |
| C-35 | FAIL | As B7. V1-COMP-04 |
| C-36 | NOT VERIFIED | #120 merged by the `A101io` account 59 s after opening, zero reviews. It is Julian's account and his local session, but no record shows he read the customer lines. For Julian, J-2 |
| C-37 | PASS | Typecheck 0 (caller); `copy-profiles.test.ts` keys NL+EN, no `!`, banned words |
| C-38 | PASS | Landing step 1 `index.ts:171` / `en.ts:155`: "uit Google en je website", matches `understandBusiness`; real runs recorded in 04-build (ADR 0007 real runs). Not run: a local business with a listing |
| C-39 | NOT VERIFIED | Only profile outcomes of the real runs are recorded (04-build); no hand-read `out/scans/*.md` of a full real Sonable check is on file |
| C-40 | PASS | `legal.test.ts` green (cookie table = code, no storage writes) |
| C-41 | PASS | `git diff --stat a8a7150 d6966c8` touches no billing, checkout or Stripe file |
| C-42 | NOT VERIFIED | Headcount and turnover must be re-asked. For Julian, J-3 |
| C-43 | PASS | The step is internal; output is labelled as Vidalo's reading (C-20) |

PASS includes rows marked "by reading" (no dedicated test) and "MemDb" (PgDb half skipped here).

## Findings

| ID | Sev | Lane | Claim and evidence | Fix | Cost |
|---|---|---|---|---|---|
| V1-COMP-01 | P1 | frontend (copy on the report page; helper in core) | Every automatic profile says "Zo lazen wij je bedrijf, uit Google en je website" / "from Google and your website" (`copy/index.ts:1555`, `en.ts:1514`), picked by `source` alone (`shared/checked-as.ts:17`). The profile knows its basis (`understand.ts:328-330`: `google`, `website` or both), but `ProfileSummary` (`types.ts:198`) drops it. An online business without a Google listing (Sonable from sonable.io, ADR 0007) is told we read Google; one with a listing whose site did not name it is told we read its website. Breaks C-21 (say where it came from) and the house rule "say only what the code does"; the neutral line on the same surface says "Google kent je bedrijf niet" | Add `basis` to `ProfileSummary` (it is already stored in `scan_run.profile`), replace `how.auto` by three strings (`autoGoogle`, `autoWebsite`, `autoBoth`) NL+EN, pick in `checkedAsParts`; old rows without basis keep today's sentence. Test in `report-online.test.ts` for each basis; add the keys to `PROFILE_KEYS` | 1 h |
| V1-COMP-02 | P2 | backend (docs the scanner follows) | `docs/CRITERIA.md:10` principle 1 unchanged (B5/C-25); `:96` describes the removed AI search, "geen extra veld" and the old online fallback; `docs/ARCHITECTURE.md:5` "one AI lookup with web search … up to 3 competitors" (C-27). P2 because these are internal and principle 1 is about what is *judged*, which still holds; but CLAUDE.md says the scanner follows CRITERIA literally | CRITERIA:10 append "Wel tonen we, als aantallen, wie AI noemt bij jouw soort bedrijf (sinds 11 nov 2026); dat telt niet mee in de stip." CRITERIA:96 and ARCHITECTURE:5 rewritten to ADR 0007 (listing + own website, one classification call, website field on `/scan/kies` when Google has no listing, neutral set, no competitors from the step) | 20 min |
| V1-COMP-03 | P2 | frontend | On an online report with no wrong answer (green or grey) the self-help block falls back to the local steps: "Claim je Google-profiel, zet adres en diensten op je website, en meld je aan bij de Nederlandse bedrijvengidsen" and "vul adres, telefoon, openingstijden … in" (`copy/index.ts:1661-1668`; `apps/web/lib/report.ts:514-515,541` ignore `online`). Advice, not a promise, so C-33 holds; but it contradicts the online plan panel next to it and the brief (an online business gets no address or opening-hours questions). The demo online report has a wrong finding, so it does not show this | `result.self.online` (`bodyGrey`, `stepsGrey`) NL+EN without address, hours or directories (website, facts page, the profiles you already have); pick it in `buildReportView` when `online`; extend `report-online.test.ts:105` to the self block | 30 min |
| V1-COMP-04 | P2 | backend (process) | PR #120 carries no surface table (B7/C-35): the body has one line on privacy and nothing on processors, records, terms, pricing or assistant. 04-build FE-04 holds the old/new lines, but that is not what Julian approves at merge | The next PR for this feature (round-1 fixes) carries the table: landing step 1 and 3, FAQ entry, plan panel online, `result.checkedAs`, `result.more`, privacy (version 14 Nov), processors, records, CRITERIA, MESSAGING, ARCHITECTURE, terms "none needed (C-05)", pricing "unchanged, plans generic" | 15 min |
| V1-COMP-05 | P2 | backend (internal record) | `docs/processors.md:10-12` say Perplexity, Anthropic and SerpAPI get "Business facts only", but paid online checks send them questions with other businesses' names ("Wat is een goed alternatief voor {concurrent}?", `prompts/online.ts:45`, filled by `competitorsInUse` in `prompts/profile.ts:64,184`). Records of processing already say so (`records-of-processing.md:13`); the privacy text too (paid section). Not a legal-text gap | Change those three rows (and Gemini in the Google row) to "Business facts; in a paid online check also names of other businesses AI named, inside a question" | 5 min |
| V1-COMP-06 | P2 | backend | Two residual data points, no defect shown: (a) with a Google listing whose website does not name the business, the page text is still sent to OpenAI (`understand.ts:302-304`, test `:462`); after d6966c8 we know such a website can be a directory (nlcompanies.org), so OpenAI gets a third party's page, not "de tekst van de homepage van het bedrijf" as the privacy text says (contacts removed, 4,000 chars). (b) Mock engines name "<surname> <town>" (`engines/mock.ts:60-64`) with fabricated counts; on the public mock preview Worker anyone can produce such a report for a real business name, and a real local "Jansen Rotterdam" may exist. Private report links, no real competitor brands, so not C-30 | (a) Send `tekst: ""` when the page does not name the business (the listing alone then classifies), or keep and add "of de website die Google bij het bedrijf noemt" to the privacy text at the next version (draft below). (b) Prefix mock competitors with "Voorbeeld" as BE-08 did for mails | (a) 15 min code or a legal-text line; (b) 10 min |

Not filed: BE-08's leftovers (`site_instruction`, `reconfirm`, resolution label for `existence`)
use local wording for an online business. They tell the owner what to add or confirm (address,
hours, phone); they do not state anything Vidalo does that it does not do, so they are not a
"say only what the code does" breach. They are wording quality for QA or a ticket. Also
pre-existing and out of scope: FAQ "Wat als AI mijn concurrent noemt?" ("Wel zorgen we dat …").

## For Julian

1. **J-1 (V1-COMP-01): the source sentence under "Gecontroleerd als".** Three versions instead of one:
   "Zo lazen wij je bedrijf, uit Google." / "Zo lazen wij je bedrijf, uit je website." / "Zo lazen wij je bedrijf, uit Google en je website." each followed by "Het is onze lezing, geen feit over je bedrijf."
   Question: may these three replace the current sentence? Suggested answer: "Ja, zo."
2. **J-2 (C-36): approval of #120.** It was merged from your account 59 seconds after it opened. Question: did you read the customer-facing lines in 04-build FE-04 and the privacy change before that merge? Suggested answer: "Ja, gelezen en goedgekeurd op 11 november." (If not: read them in the round-1 fix PR, V1-COMP-04.)
3. **J-3 (C-42): EAA microenterprise exemption.** Question: does A101 B.V. still have fewer than 10 people and at most €2M turnover or balance sheet? Suggested answer: "Ja, beide."
4. **J-4 (V1-COMP-06a): a directory site as "the business's website".** Either we stop sending a page that does not name the business (no text change), or the privacy text gains, at its next version, this **draft (not applied)**: NL "… en de tekst van de homepage van het bedrijf, of van de website die Google bij het bedrijf noemt, waaruit we eerst …"; EN "… and the text of the business's homepage, or of the website Google lists for the business, from which we first …". Suggested answer: "Stop sturen; geen tekstwijziging."
5. **Lawyer** (carried from phase 1, unchanged): AVG art. 14(5)(b) for naming third businesses (sole traders) in a report and in questions to AI, or an LIA on file; competitors' trade names in questions to AI systems; a customer publishing their own report (terms art. 63).

## Not verified

- PgDb and the hosted project: `db-profiles.test.ts` PgDb cases skipped (no `TEST_DATABASE_URL`); RLS and grants of `question_use` / `question_library`, the CHECKs and the deletion behaviour on project `bbynmqvaxpjdnkaasutd`. Not checked live: needs the Supabase connector or the project's service key (P2).
- Production: what vidalo.ai serves now (the PR body says the migration was applied before the deploy); which engines run there, so whether "Een volledige controle stelt ze allemaal aan ChatGPT, Google AI, Gemini, Perplexity en Claude" (`result.more.body`, `scanner/index.ts:49`) is true live depends on the keys in the Worker's secrets.
- C-39: a full real check of Sonable read by hand.
- Browser: `/r/voorbeeld-online`, the online plan panel and the waiting page were not viewed (code and tests only).

## General lessons (for `docs/process/checklists/compliance.md`)

- When a design decision removes a data source (ADR 0007), grep every fixed sentence that names sources (report, privacy, CRITERIA, ARCHITECTURE), not only the privacy text. Here the privacy text was fixed the same day, while the report's source line and two internal docs kept a source that no longer exists or is not always used.
- A source sentence shown to a visitor is chosen from the record's actual basis, not from a constant.
- The surface table belongs in the PR body that is merged; a table in the build log is not what the approver sees.
