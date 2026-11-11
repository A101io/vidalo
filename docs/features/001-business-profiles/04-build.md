# 04 — Build log

## BE-01 — Contract: types, Db signatures, MemDb (2026-11-11)

**What.** The interface contract of `02-architecture.md` in code. No scanner behaviour changes.

**Where.**
- `packages/core/src/types.ts`: `ProfileMode`, `ProfileBasis`, `ProfileConfidence`, `BusinessProfile`, `ProfileSummary`, `QuestionFamily`; `RecommendationIntent` + `"alternative"`; `INTENT_SUBJECT.alternative`; `Prompt.templateKey`, `Facts.serviceAreaOnly`, `Facts.profile`, `ScanRun.profile`, `RecommendationSummary.family` / `.quotes`, `ScanReport.profile`. `RECOMMENDATION_INTENTS` is unchanged on purpose (it drives bank rotation; `alternative` is not a per-sector intent).
- `packages/core/src/scanner/progress.ts`: `ScanStage`, `ScanJobState` v2 (`steps` kept as optional, deprecated). `persistScanState` / `readScanState` carry the new fields; a state stored without `stage` reads as `ask` with empty lists.
- `packages/core/src/scanner/index.ts`: `ScanProgress` gains `profile`, `questions`, `escalate`; `start.perEngine`. Nothing emits the new events yet; `start` emits `perEngine: {}` (BE-07 fills it).
- `packages/core/src/db/types.ts`: `BusinessRecord.profileAuto/profileOwner`, `ScanRunCreate.profile`, `QuestionUseInput`, `LibraryRow`, `Db.setAutoProfile/setOwnerProfile/recordQuestionUse/questionLibrary`.
- `packages/core/src/db/mem.ts`: all four methods in full; `upsertBusiness` skips both profile fields; `createScanRun` stores `profile`.
- `packages/core/src/db/pg.ts`: **stubs only** (`throw new Error("BE-02")`), and `mapBusiness` returns `null` for both profile fields until BE-02 reads the columns.
- `packages/core/src/prompts/slots.ts` (`sanitizeSlot`, `SLOT_LIMIT`), `packages/core/src/scanner/understand.ts` (`effectiveProfile`, `parseOwnerProfile`); re-exported from `prompts/index.ts` and `scanner/index.ts`.
- Compile-only edits outside core: `apps/web/lib/core.ts` (`createScanState` fills the new state fields), `apps/web/app/scan/[id]/page.tsx` (`steps ?? []`), `apps/web/lib/demo.ts` (`family`, `quotes` on the demo recommendation); `scanner/recommendations.ts` sets `family` (`alternative` when the intent is, else `rec_town`) and `quotes: []` until BE-06.

**How verified.** `packages/core/test/profile-contract.test.ts` (33 tests). Each guarantee was removed in turn and the test went red, then restored: the profile-field guard in `upsertBusiness` (1 failed), the `(scanRunId, templateKey)` dedupe (1), the instruction-word filter (6), the domain filter (2), competitors taken from owner instead of auto (1), the too-long check (3 of the 4 `too_long` cases; the 4th, `mode`, has no length). `corepack pnpm -r typecheck` green; `corepack pnpm -r test` green (core 957, worker 24); `corepack pnpm e2e:mock` OK. Not verified: PgDb (stubs; BE-02).

**Judgement calls.** `parseOwnerProfile` takes an optional third argument `now` (default `new Date()`) so a test never depends on the clock; the contract's two-argument call still works. Order of checks per field: required, then refused (mode), too_long (raw length), then refused (sanitiser). The first failing field in the order mode, offer, audience, category is returned.

## FE-04 — Every surface that describes the product (2026-11-11)

**What.** Landing and FAQ copy (NL + EN), the docs, the assistant check and the jargon test. No legal text touched.

### Customer-facing sentences, old and new (Julian approves line by line)

**1. `copy.landing.werkt.steps[0].body` ("Zo werkt Vidalo", step 1)**
- NL old: "Je gegevens één keer goed: adres, telefoon, openingstijden, wat je wel en niet doet. Wij vullen vooraf in, jij bevestigt."
- NL new: "Eerst lezen wij wat je bedrijf doet: uit Google, je website en één AI-zoekopdracht. Dan leg je je gegevens één keer goed vast, zoals telefoon, openingstijden en wat je wel en niet doet. Wij vullen vooraf in, jij bevestigt."
- EN old: "Your details right, once: address, phone, opening hours, what you do and do not do. We fill them in beforehand, you confirm."
- EN new: "First we read what your business does: from Google, your website and one AI search. Then you record your details right, once, such as phone, opening hours and what you do and do not do. We fill them in beforehand, you confirm."
- Note: "adres" dropped from the list because an online business has none.

**2. `copy.landing.werkt.steps[2].body` (step 3, Controleren)** — one clause only
- NL old: "...in het Nederlands de vragen die je klanten stellen. Meerdere keren..." / new: "...in het Nederlands de vragen die bij jouw soort bedrijf passen. Meerdere keren..."
- EN old: "...in Dutch, the questions your customers ask. Several times..." / new: "...in Dutch, the questions that fit your kind of business. Several times..."
- Not in the ticket's table; added because the sentence would otherwise contradict step 1. Easy to revert if Julian wants only step 1 changed.

**3. `copy.landing.vragen.items` — new entry (before "Wat als AI mijn concurrent noemt?")**
- NL q: "Werkt dit ook als ik geen winkel heb?"
- NL a: "Ja. Eerst kijken we wat voor bedrijf je hebt: een zaak waar klanten langskomen, een bedrijf dat naar de klant toe gaat, of een bedrijf dat online of door heel het land werkt. Een online bedrijf krijgt geen vragen over openingstijden of een adres, maar vragen over wat je doet, over je website en over wie AI noemt als iemand een aanbieder zoekt of een alternatief voor jou. In je rapport zie je als aantallen hoe vaak AI je noemt en wie het dan wel noemt. Of AI je noemt, kunnen wij niet bepalen; de stip gaat over of je feiten kloppen."
- EN q: "Does this work if I have no shop?"
- EN a: "Yes. First we look at what kind of business you have: a place customers visit, a business that goes to the customer, or one that works online or nationwide. An online business gets no questions about opening hours or an address, but questions about what you do, your website and who AI names when someone looks for a provider or an alternative to you. In your report you see, as counts, how often AI names you and who it names instead. Whether AI names you is not ours to decide; the dot is about whether your facts are right."
- Reaches the assistant through `buildKnowledge` (reads the FAQ); no chat code change.

**4. Plan line "1 vestiging" (`copy.landing.prijs`, `/prijzen`)**: unchanged on purpose (plans are generic, ticket row). The online report's plan panel reading "1 bedrijf" is FE-02's.

### Docs
- `docs/CRITERIA.md`: new section "Soorten bedrijven (11 nov 2026)" (profile step, family table door/visit/online, online free set of 6, criterium-11 "ander soort bedrijf", library rules, what is shown for online: counts only); criterium 11 row gains "beschreven als een ander soort bedrijf"; "Twee soorten vragen" mentions recommendation by category without a town; "Wat de scan bewust niet beoordeelt": the ranking/share-of-voice bullet now bans position, percentage and score and allows "3 van 10", and the competitors bullet says the names AI itself gives are shown per question as counts, still no "jij versus de buren" table; no promise of change.
- `docs/MESSAGING.md`: one paragraph with the rules for online businesses, the waiting page and the competition block (counts only, no ranking words, no promise, "1 bedrijf", the FAQ entry, the test).
- `docs/ARCHITECTURE.md`: Workflow A gains the understanding step and the question library (one longer clause each, in the existing one-paragraph style).
- Assistant (`core/chat`): no code change. Mails: BE-08. Terms, privacy, `docs/processors.md`: none changed.

### Tests
- New `packages/core/test/copy-profiles.test.ts` (8 tests): explicit key list (FE-04's three keys, NL and EN) against the banned-word pattern and the promise pattern from the ticket, plus `!`; the patterns themselves on known-bad strings; the new FAQ question in `buildKnowledge(copy,"nl")` and `buildKnowledge(copyFor("en"),"en")`. Shown to fail: putting "your score" into the EN FAQ answer turned that case red (1 failed), then restored. FE-01/02/03 add their keys to `PROFILE_KEYS` in this file.
- `npx vitest run test/legal.test.ts test/copy-profiles.test.ts test/chat.test.ts test/copy-intro.test.ts test/plan-copy.test.ts` in `packages/core`: 5 files, 50 tests pass. `corepack pnpm -r typecheck`: green (core, web, worker) at the time of running. Full `pnpm -r test` and `e2e:mock` not run by me (other tickets are mid-edit in the tree).

### Left for Julian / not checked
- Legal: not changed. I think none is needed for these strings (no new vendor or data kind). One thing for the legal desk: the privacy statement should be read once the understanding step ships, since it sends the business name and place to OpenAI for one more lookup, which the existing text on "OpenAI: ChatGPT voor de controles" likely already covers.
- Existing FAQ line "AI vindt helemaal niets over mijn bedrijf ... controleren of je genoemd wordt" and the 'criteria' body "geen rankings" were left alone: both stay true.
- I did not look at the pages in a browser; this is copy in the existing structures and the landing renders from the same keys.

## BE-07 — Progress events, waiting-room state v2, status endpoint (2026-11-11)

**What.** `runScan` emits the typed events; `runScanWithProgress` maps them to `stage`/`profile`/`questions`/`engines` only (no timers); the status endpoint returns the contract's fields and nothing else.

**Where.**
- `packages/core/src/scanner/index.ts`: `RunScanOptions.profile?: ProfileSummary` (BE-04 passes the result of `ensureProfile`; until then the door summary `{mode:"door", source:"fallback"}` is emitted). `profile` event before `loadPrompts`, `questions` after it (`{id, text: textNl}` in asking order), `start.perEngine` = first-round samples per engine, `escalate` = samples added per engine before round 2.
- `packages/core/src/scanner/progress.ts`: stage machine (`advance` only moves forward): `profile` -> `choose`; `questions` fills the list; `start` -> `ask` with `expected`; `escalate` adds to `expected`; `asked` -> `received++` (failed asks count too: the ask happened); `phase extract|compare` -> `compare`; the run returning -> `done` together with `status:"done"` (the `phase:done` event does not set it, so `done` never sits next to `running`). Step labels (`steps`) are no longer written or stored. New `scanStatusBody(state)` is the one place the response is shaped. `runScanWithProgress` also accepts `clients` and `profile` and passes them on.
- `apps/web/app/api/scan/[id]/status/route.ts`: returns `scanStatusBody(state)`; 404 `{status:"missing"}` unchanged.
- `apps/web/lib/core.ts`: `createScanState(businessId)` (copy argument dropped), `progressTemplate` removed. `apps/web/app/api/scan/route.ts`: caller updated; `GET /api/scan` returns `stages` keys instead of `steps` labels.
- Test: `packages/core/test/scan-progress.test.ts` (13 tests).

**Contract note.** The stage is `choose` (architecture, ticket, `ScanStage`), not `questions` as in the hand-off message; the `questions` list arrives while the stage is still `choose`.

**Verified.** Stage order and monotonicity on stored states; questions equal the asked prompts; per engine `received == expected == samples stored` (chatgpt 18, google_ai 6 on a mock free scan: the cap is in the plan, not a constant); an escalated cell grows `expected` and still ends equal; old state without `stage` reads `ask` with empty lists; response keys are exactly `status, stage, profile, questions, engines, reportUrl`, no error text (running and failed), no ids. Controls (each guarantee removed, test went red, restored): escalate emit (1 failed), compare stage (2), error in body (4), old-state default (2), `received++` (2), `perEngine: {}` (3). `pnpm -r typecheck` green, core 999 pass (1 failure in `online-judging.test.ts`, another agent's area), worker 24 pass, `pnpm e2e:mock` OK.

**Not verified / known.** The route file itself is not exercised by a test (apps/web has no unit runner); its body is `scanStatusBody`, which is. Queue consumer on Cloudflare not run. `apps/web/app/scan/[id]/ScanProgress.tsx` still reads `data.steps` from the endpoint, so the current waiting page shows no steps until FE-01/FE-04 land. The `steps?` field and `ScanProgressStep` type remain, deprecated, for that page.

## BE-06 — Judging an online business (2026-11-11)

**What.** `wat doet X` is judged on criterium 11, naming and namesake rules know about online businesses, recommendation summaries carry real `family` and `quotes`.

**Where.**
- `scanner/normalize.ts`: `factValue(facts, "identity", "kind")` is `"same"` when `profile.grounded`, `profile.offer` is set and `profile.basis` is not only `ai_lookup` (a second guard on top of `grounded`); else `null`. Other identity subjects unchanged. `describeValue` / `describeFact` word `same` / `other` / `kind`.
- `scanner/extract.ts`: new export `kindClaimFromAnswer(answer, facts)` (same / other / null; shared content word of >= 4 letters with offer or category wins over a listed other kind; the business's own name words are ignored; bounded by `MATCH_LIMIT`); the rules extractor uses it for `identity:kind`. LLM extractor: `profiel: {aanbod, categorie}` in the user JSON and the schema description for `kind` (`same` | `other`). `mentionsBusiness` drops the town requirement when `facts.profile?.mode === "online"`; `detectOtherEntity` returns after the heading test for online.
- `scanner/recommendations.ts`: `family` from `templateKey` (`online.alt.*` or intent alternative -> `alternative`, `online.rec.*` -> `rec_category`, else `rec_town`); new export `quotesFor` (<= 3, <= 240 chars clipped at a word boundary with an ellipsis, first sentence per engine first, drops any sentence naming a business seen in that question's answers, not only the top 5; none on `rec_town`; scans an 8000-char prefix). `samples` accept an optional `engine`, `prompts` an optional `templateKey`, `facts` an optional `profile`; the caller in `scanner/index.ts` already passes full objects.
- `test/online-judging.test.ts` (21 tests). `stip.ts`, `compare.ts`, `criteria.ts` untouched: `other` against `same` is a mismatch, `identity` already maps to criterium 11.

**Verified.** Core typecheck green; full core suite 1002 passed (includes `no-reference.test.ts`). AC-6 orange and green fixtures run through `runScan` with a fixed engine client against MemDb. Each guarantee removed in turn, test went red, restored: grounded check (3 failed), ai_lookup-only rule (1), town not required online (4), online skip in `detectOtherEntity` (1), competitor filter in quotes (1, after I tightened a test that first stayed green), cap of 3 (1), no quotes on `rec_town` (1), rules extraction of kind (2, incl. the orange fixture), prefix bound on quotes (1), family mapping (2).

**Not verified / gaps.** `runScan` does not yet copy `business.profileAuto/Owner` into `facts.profile` (the `withProfile` step); the fixtures put `profile` on the stored facts, which MemDb round-trips. MemDb `insertPrompts` does not store `templateKey` yet, so families through `runScan` read `rec_town` until BE-03 stores it; families are tested on `summarizeRecommendations` directly. The LLM extractor path is not run (no key); only its prompt/schema text changed. The `other` list is the ticket's short list; "same" is a stem match, so a compound like "winkelinrichting" counts as same as "winkel".

## BE-02 — Migration 0015 and PgDb (2026-11-11)

**What.** `supabase/migrations/0015_business_profiles.sql` (0015 was free on origin/main): `business.profile_auto`, `business.profile_owner`, `scan_run.profile`, `prompt.template_key` (<= 80, named `prompt_template_key_len`), the three shape checks, table `question_use` (RLS on, no policies, `revoke all` from anon and authenticated, also on its sequence), view `question_library` (`security_invoker`, revoked). One deviation from the contract SQL: the shape checks use `coalesce(x->>'mode','') in (...)`, because a CHECK that evaluates to NULL passes, so a profile with no `mode` key would have got through.

**Where.** `packages/core/src/db/pg.ts`: `mapBusiness` reads both profile columns; `mapScanRun` reads `profile`; `mapPrompt`/`insertPrompts` carry `templateKey`; `createScanRun` writes `profile`; `setAutoProfile`/`setOwnerProfile` each update their own column (throw if the business is missing); `recordQuestionUse` is one multi-row insert `on conflict (scan_run_id, template_key) do nothing`; `questionLibrary` reads the view with the optional category/mode filter. `upsertBusiness` is unchanged (its column list never contained the profile). `packages/core/src/db/mem.ts`: one token, `insertPrompts` now keeps `templateKey` (MemDb dropped it, so PgDb could not "behave like MemDb"). `scripts/verify-pg.sh` runs the new test file too, sequentially (`--no-file-parallelism`: both files truncate the same database).

**Tests.** `packages/core/test/db-profiles.test.ts` (20 cases: 3 shared on MemDb and PgDb, 17 PgDb only): own-column writes and `upsertBusiness` leaving both alone; run profile and `template_key` round-trip; the ledger inserts once per (run, template), a retry changes nothing, the library sums and filters; CHECKs refuse `mode:"shop"`, 121-char offer, 81-char audience, 61-char category, four competitors, `<script>`, a quote, a slash, a missing mode (on all three columns); boundary values pass; `usable > asked`, bad mode/family and empty key refused; deleting a business leaves its `question_use` rows with `scan_run_id` null and no row anywhere holds the profile text or the business name (compliance C-11, C-14 deletion half); RLS on, zero policies, and anon and authenticated get "permission denied" on select/insert/update/delete of `question_use` and select of `question_library` while the owner connection sees the row (control).

**Verified, on a local PostgreSQL 18.4 (throwaway cluster on port 5544; not the hosted project, not Supabase).** All 15 migrations applied in order. `PG_ADMIN_URL=... pnpm verify:pg`: db.test.ts + db-profiles.test.ts green (43 tests), then the whole mock pipeline on PgDb: "OK verify:pg — 1927 samples in Postgres". Each guarantee removed, the test went red, then restored (rebuilt from the migrations): profile_auto shape dropped (9 red), `usable <= asked` dropped (1), FK `on delete cascade` instead of `set null` (1), `grant select` to anon (1), RLS disabled (1), unique (scan_run_id, template_key) dropped (4). `typecheck` green.

**Not verified / open.**
- Migration not applied to `bbynmqvaxpjdnkaasutd`; the "rolled-back DO block" RLS proof on the hosted project is for the deploy step. Locally the roles are the shim's `anon`/`authenticated`; Supabase's default privileges on `public` differ, which the hosted proof must cover (including the view).
- Profile checks do not look inside `competitors` entries (contract only caps the count); `sanitizeSlot` in code is the only guard on those names.
- MemDb `deleteBusiness` does not null `scanRunId` on its `questionUse` rows (the type says non-null); only PgDb has the "keep rows, run id null" behaviour. Not changed (BE-01's file).
- Compliance C-12 (the data export holds `profileAuto`, `profileOwner`, each run's `profile`): `exportMyData` in `shared/my-data.ts` mentions no profile; not done here, belongs to a ticket that owns that file.
- Full `npx vitest run` in core: 3 failures in `scan.test.ts` (2) and `progress.test.ts` (1), present with and without my mem.ts line; from the scanner files other agents are editing.
- `insertPrompts` as one multi-row insert gives equal `created_at`, so `listPrompts` order within a batch is by random uuid (existing behaviour, my test sorts).

## BE-03 — Questions by profile mode (2026-11-11)

**What.** `door` is asked main's questions text for text; `visit` the same filtered by the A2 table; `online` code-held NL/EN templates with sanitised slots. `loadPrompts` takes the profile.

**Where.**
- `prompts/profile.ts`: `familyOf`, `applies`, `headNoun`, `competitorsInUse`, `onlineQuestions`, `selectQuestions`, types `PickTemplates`, `QuestionLibrary`, `SelectInput`.
- `prompts/online.ts` (`ONLINE_TEMPLATES`, `PLACEHOLDER_SLOT`, `ONLINE_SUBJECT`, type `OnlineTemplate`), `prompts/online.en.ts` (`ONLINE_TEMPLATES_EN`); all re-exported from `prompts/index.ts`.
- `prompts/slots.ts`: `SlotValue` (branded), `slotValue()`, `deriveSlot()`, `fillTemplate()` (null when a place has no value).
- `scanner/index.ts`: `loadPrompts(db, businessId, facts, kind, sector, promptIds?, now?, profile = null, library?)` is now exported; `null` is read as door. door/visit keep today's body, drop stored `online.*` rows, visit filters by `applies`; online inserts missing templates by text (with `templateKey`) and returns the stored rows in template order. `promptIds` still wins first.
- `scanner/onboard.ts`: `prepareBusiness` no longer inserts prompts (`Prepared.prompts` = stored list, may be empty); CLI line no longer prints the count.
- Small edits: `db/mem.ts insertPrompts` now keeps `templateKey`; `scanner/extract.ts` exports `NL_CITIES`.
- Tests: `test/online-questions.test.ts`, `test/online-templates.test.ts`, `test/prompt-fixtures.ts`, `test/fixtures/questions-5a1a40e.json` (generated in a git worktree of commit `5a1a40e` through `selectFreeScanPrompts`/`promptsForFullScan`, pinned moment `2026-03-15T12:00:00Z`; seven fixtures: kapper, bakkerij, horeca, winkel, loodgieter, loodgieter without open day, an English business). `storeDoorPrompts` helper in `scanner-fixtures.ts`; `scan.test.ts` and `progress.test.ts` call it because prepareBusiness no longer stores prompts.

**How verified.** 49 new tests green; full core suite 1059 passed; `pnpm -r typecheck` green; `pnpm e2e:mock` OK. Each guarantee removed and the tests went red, then restored: visit filter (8 failed), door `online.` row filter (1), sanitiser bypass (3), own-name-as-competitor drop (2), EN key renamed (2), online phone rule (1).

**Judgement calls.** NL `{de beste}` and `{Welke}` fill with the whole phrase including the category (grammar needs the inflected noun), so the NL placeholder set differs from the EN text but the declared slot kinds are equal (tested). `rec.audience` probes `existence:geschikt` (INTENT_SUBJECT has no `specialty`; `ONLINE_SUBJECT` extends it locally). BE-06 should give `existence:geschikt` a label. `competitorsInUse` hands `mentionsBusiness` the online profile, so the place is not required. Free-set order for door is the stored-row order, as on main.

## FE-02 — The report of an online business (2026-11-11)

**What.** `/r/[id]` for `profile.mode === "online"`: competition block next to the dot, town-free heading and question lines, plan panel without listing promises and with "1 bedrijf"; "Gecontroleerd als" on every report that carries a profile. Local reports keep "Wie AI wel noemt"; the dot (`stip`) is untouched.

**Where.** `apps/web/lib/report.ts` (`ReportView.checkedAs`, `.checkedAsNote`, `.competition`; helpers `checkedAsFor`, `competitionFor`; `online` threaded through question lines, h1, sources, plan), `apps/web/lib/questions.ts` (`questionFor(..., online)`, `identity:kind` reads "Wat doet X?" and "beschreven als een ander soort bedrijf"), `apps/web/app/r/[id]/page.tsx`, `apps/web/lib/demo.ts` (`/r/voorbeeld-online`, fictional "Vloedlijn Audio" and five made-up competitors, captioned on the page), `e2e/helpers.ts` (route added to `PUBLIC_ROUTES`), copy NL+EN (`result.competition`, `result.checkedAs`, `result.hero.h1Online/h1GreyOnline/h1UncheckedOnline`, `result.plan.online`, `report.question.identityKind`, `report.value.otherKind/sameKind`), tests `packages/core/test/report-online.test.ts` (22) and `PROFILE_KEYS` in `copy-profiles.test.ts`.

### New customer-facing strings (NL / EN)
- competition.h2: "Wie AI noemt bij jouw soort bedrijf" / "Who AI names for your kind of business"
- competition.body: "Wie jou niet kent, vraagt AI om een aanbieder of een alternatief. Dit antwoordde AI daarop, geteld uit deze controle." / "Someone who does not know you asks AI for a provider or an alternative. This is what AI answered, counted from this check."
- summary / you: "Genoemd in {n} van {m} antwoorden" / "Named in {n} of {m} answers" (singular: antwoord / answer)
- others: "Ook genoemd" / "Also named"; times: "{n} van {m}" / "{n} of {m}"
- quotesTitle: "Wat AI over jou schreef" / "What AI wrote about you"; quoteBy: "Volgens {AI}" / "According to {AI}"
- quotesNote: "Zinnen letterlijk uit de antwoorden van deze controle. Een zin die eindigt op … is ingekort." / "Sentences word for word from the answers of this check. A sentence ending in … has been shortened."
- note: "We tellen alleen of AI je noemt en wie het daarnaast noemt, nooit in welke volgorde. De stip gaat over of wat AI over je zegt klopt; of je genoemd wordt verandert zijn kleur niet. Of AI je noemt, bepalen wij niet." / "We only count whether AI names you and who else it names, never in what order. The dot is about whether what AI says about you is right; being named does not change its colour. Whether AI names you is not ours to decide."
- demoCaption: "Fictief voorbeeld: het bedrijf en alle namen zijn verzonnen." / "Fictional example: the business and every name are made up."
- checkedAs.line: "Gecontroleerd als: {x}" / "Checked as: {x}"; "{category} voor {audience}, {mode}"; mode words door "met een locatie waar klanten langskomen", visit "komt naar de klant toe", online "online" (EN: "with a place customers visit", "goes to the customer", "online"); mode-only (fallback): "een bedrijf met een locatie waar klanten langskomen" / "een bedrijf dat naar de klant toe gaat" / "een online bedrijf" (EN a business with a place customers visit / that goes to the customer / an online business)
- checkedAs.how: auto "Zo lazen wij je bedrijf, uit Google, je website en één AI-zoekopdracht. Het is onze lezing, geen feit over je bedrijf." / "This is how we read your business, from Google, your website and one AI search. It is our reading, not a fact about your business."; owner "Zo heeft de eigenaar het bedrijf vastgelegd." / "This is how the owner recorded the business."; fallback "We konden je bedrijf niet met zekerheid lezen en gingen uit van deze soort bedrijf." / "We could not read your business with certainty and assumed this kind of business."
- checkedAs.fixOwner: "Klopt het niet? Als eigenaar pas je het aan onder ‘Je gegevens’; de volgende controle stelt dan andere vragen." / "Not right? As the owner you change it under ‘Your details’; the next check then asks different questions."; fixOther: "Klopt het niet? Mail het naar support@vidalo.io." / "Not right? Mail it to support@vidalo.io."
- hero online: "{naam}: jouw stip is {kleur}." / "{name}: your dot is {colour}."; "{naam}: AI kent je niet."; "{naam}: we konden de antwoorden niet controleren."
- plan.online (no Google, Bing, Apple, directory lines): stepFacts "Een feitenpagina op {domein}, met datum, die AI kan lezen."; green steps 1-3 (step 2 "Een feitenpagina op je eigen domein, met datum, die AI kan lezen."); grey: "Je gegevens één keer vastleggen: wat je doet, voor wie, je website en wat je wel en niet doet. Vijf minuten." and recheck "…Je ziet wat er veranderd is." (replaces "wanneer de AI je gaat noemen"); excl "1 bedrijf · Excl. btw · geen opzegtermijn · …" / "1 business · Excl. VAT · …"
- identity:kind: "Wat doet {naam}?" / "What does {name} do?"; "beschreven als een ander soort bedrijf" / "described as another kind of business"; "beschreven als hetzelfde soort bedrijf" / "described as the same kind of business"

**Verified.** Core tests 22 new + copy-profiles pass; controls (each removed, test red, restored): cap of 5 others (2 red), online flag (12), plan wording (2). `pnpm -r typecheck` green. Browser (Playwright/Chromium against the running dev server on :3000): `/r/voorbeeld-online` NL and EN, 1280 and 375: no horizontal scroll, axe wcag2a/2aa 0 violations, no console errors; `/r/voorbeeld`, `/r/voorbeeld-grijs` (and EN) have no "Gecontroleerd als", no competition block, "Wie AI wel noemt" unchanged. Screenshots `out/journey-mock/online-{nl,en}-{desktop,375}.png`.

**Not verified / notes.** Local view "unchanged" is tested as equality with and without a profile, not against a pre-change snapshot (none existed). Keyboard pass left to QA. No real online scan seen (BE-03/04 not merged); the block was seen on the demo only. I did not start my own dev server: Next refuses a second `next dev` in the same app dir, so I used the already running one on :3000 (hot reload), temp launch entry removed. Online report with no category/alternative rows shows no block (judgement call). The quotes' questions are the stored Dutch prompts, also on EN pages (same as local "Wie AI wel noemt"). "Na 14 dagen dezelfde 1 vragen" grammar for a single question is existing wording. The demo's plan step says "op vloedlijn-audio.example".

## FE-01 — The waiting page shows what Vidalo is doing (2026-11-11)

**What.** `/scan/[id]` (EN `/en/scan/[id]`) is rebuilt on the typed state of BE-07. Four steps, each from the real `stage`: *Je bedrijf begrijpen* (with "We lezen {naam} als: {offer}, voor {audience}." once `profile` is known) -> *De juiste vragen kiezen* (the questions, numbered, entering one by one) -> *Vragen aan ChatGPT en Google AI* (one row per engine of this scan with "n antwoorden") -> *Antwoorden lezen en vergelijken*, then the existing redirect to the report. Above the steps a calm picture of the work: a blue Vidalo node; bars that are scanned (understand) and become the chosen questions (choose); then one lane per engine with a question travelling out and an answer coming back (ask); only answers coming back (compare); static when done or failed. Pure CSS, aria-hidden, the steps carry every fact.

**Where.**
- `apps/web/app/scan/[id]/page.tsx`: server render passes `scanStatusBody(state)` (the allow-list, never the stored state) plus the business name; `<noscript>` meta refresh (5 s) and a "Vernieuwen" link built with `localizeHref` and `encodeURIComponent`.
- `apps/web/app/scan/[id]/ScanProgress.tsx`: client component, polls `/api/scan/<token>/status` every 2 s, stops on done/failed, `router.replace(reportUrl)` on done. React text only.
- `apps/web/app/scan/[id]/waiting.css` (new): all motion.
- `packages/core/src/copy/index.ts` + `en.ts`: `scan.steps` replaced by `scan.stages` (understand, choose, `ask(engines: string[])`, compare, done), `scan.live`, `scan.state`, `scan.profileSentence`, `scan.answers`, `scan.moreQuestions`, `scan.refresh`. Keys added to `PROFILE_KEYS` in `test/copy-profiles.test.ts`.

**Judgement calls (the ticket and the hand-off message differ; I took the ticket where it is the safer reading).**
1. Counter is "n antwoorden", not "n van m": `expected` can grow in the second round, so "5 van 10" then "5 van 20" would read as going backwards. Say if you want "n van m" back.
2. A profile with no `offer` shows nothing under step 1 (hand-off message); when there is a `category` but no offer it shows "We lezen X als: {category}." The ticket's "mode words only" is not built (no copy for it). `profileSentence` returns null in that case; FE-02 can reuse it.
3. `ask(engines)` takes the engine names as an array so the copy joins them in its own language ("ChatGPT en Google AI"); the ticket sketched a string.
4. At most 8 questions are shown, then "en nog n vragen". A failed scan marks the step where it stopped "gestopt" with a red dot (status colours stay in dots).
5. Screen reader: one `aria-live="polite"` sentence per stage; the profile sentence is added once, in the stage in which it first arrived (a first version repeated it every stage; seen in the live-region history, fixed).
6. Question texts are in the scan language (Dutch) on the EN page, as the contract says.

**Verified (Playwright against `vidalo-demo`, mock, Chromium; screenshots in `out/journey-mock/wait-*.png`).**
- All stages, NL and EN, 1280 and 375: `wait-{d|m}-{nl}-{understand,profile,fallback,choose,many,ask,askrest,compare,failed,xss}.png`, `wait-d-en-ask.png`, `wait-m-en-ask.png`. No horizontal overflow in any (scrollWidth = clientWidth), zero console errors.
- A real queued scan state served by the real page and real status endpoint, with the status route answered by the BE-07 example sequence (understand -> choose with profile -> questions -> ask 0/3/5 -> compare -> done): the active step, question count, counters and `aria-current` followed each response; the page then replaced itself with `/r/voorbeeld` (NL) and `/en/r/voorbeeld` (EN). `wait-seq-{nl,en}-0..5.png`. Live-region history: exactly one sentence per stage.
- Reduced motion (Playwright `reducedMotion: reduce`): 0 running animations on the visual and steps; without it 7 (ring, packets, dot pulse). `wait-d-nl-ask-reduced.png`.
- No JavaScript (`javaScriptEnabled: false`) on a real queued token, NL and EN: server render shows the active step and the heading, carries the 5 s refresh meta and the "Vernieuwen"/"Refresh" link. `wait-nojs-{nl,en}.png`.
- axe-core (main, serious+critical and all): no violations on the real page NL 1280 and EN 375, and on the ask, compare, failed, choose, many, fallback and xss states. One contrast hit on the 10-question state appeared only when sampled 300 ms in (opacity mid-rise) and was gone after 2 s.
- XSS (S-32): `<img src=x onerror=alert(1)>` as offer and as question text renders literally, 0 `img` elements; grep of the three files: no `dangerouslySetInnerHTML`, no `innerHTML`, no `data-motion`.
- Copy tests: `npx vitest run test/copy-profiles.test.ts test/legal.test.ts` 50 pass. Control: putting "prompt" into `en.scan.live.choose` turned `en scan.live (FE-01)` red; restored. Legal test green: no new cookie or storage.
- A real mock free check ("Bakkerij De Vries, Haarlem") ended on `/en/r/...` before the first poll could be sampled: the mock scan finishes in well under a second, so the live stages were checked with the fixture sequence above, not on a real running scan.

**Not verified.** A real scan with real engines (stage timing, a long second round, a ten-question paid list). WebKit / Firefox / a real phone (Chromium at 375 only). VoiceOver / NVDA (only the live region's text history). The ticket's committed Playwright test files and a component test with the fixture sequence are not written: my checks were throwaway scripts (QA's lane to promote), and the temporary fixture routes I used were removed again. `corepack pnpm -r typecheck` is red right now on `packages/core/src/scanner/index.ts` (duplicate identifier `effectiveProfile`, another agent's in-flight edit); `apps/web` has no errors of its own. I did not run the full `pnpm -r test`, `e2e:mock` or the Playwright suites. `ScanProgressStep`/`steps?` in the scanner are untouched (another lane) and nothing reads them any more, so BE-07's deprecation note can now be closed. The old `/api/scan` GET still returns `stages` keys, unchanged. Not checked by a person: the visual itself is mine, inside design G, and is Julian's to accept.

## BE-05 — The question library (2026-11-11)

**What.** The usable rule, the ledger written after every scan, proven and retired templates in the online question choice, and `pnpm library`.

**Where.**
- `packages/core/src/prompts/library.ts` (new): `libraryStatus`, `isUsable`, `pickTemplates`, `templateKeyOf`, `templateTextOf`, `libraryCategory`, `useRows`, `libraryFromRows`, `loadLibrary`, `recordScanUse`. Not re-exported from `prompts/index.ts` (through the barrel, `prompts/profile.ts` and `prompts/index.ts` saw each other half built); import from `prompts/library`. The file starts with `import "./index"` for the same reason.
- `packages/core/src/scanner/index.ts`: `loadPrompts` (online) merges `loadLibrary(db, profile, facts)` into the library it passes to `selectQuestions` (a failing read means the built-in order); `runScan` calls `recordScanUse(...)` after `scan.finished`, with the profile BE-04 decided.
- `packages/core/src/cli/library.ts` (new) + root and core `package.json` script `library`; `docs/RUNBOOK.md` gains "Reading the question library".
- Migration `0015_business_profiles.sql` edited in place (not applied anywhere, not committed): `business.question_ref uuid not null default gen_random_uuid()`, `question_use.business_ref uuid not null`, and the view gains `count(distinct business_ref) as businesses`.
- `db/types.ts` (`LibraryRow.businesses`), `db/pg.ts` (`recordQuestionUse` looks up the business reference through `scan_run`; `questionLibrary` reads `businesses`), `db/mem.ts` (same; `deleteBusiness` now leaves the ledger rows with `scanRunId` null like PgDb).
- Tests: `test/question-library.test.ts` (40 cases on MemDb + PgDb), `test/db-profiles.test.ts` (+3).

**Thresholds as built (security S-23, Julian's delegate; they win over the ADR text and the ticket's 20 / 50).** Proven: asked of at least 5 different businesses and usable share >= 60 %. Retired: asked of at least 10 different businesses and usable share < 30 %. Exact integer comparison (no float at 0.6 / 0.3). Constants `PROVEN_MIN_BUSINESSES`, `PROVEN_MIN_SHARE`, `RETIRE_MIN_BUSINESSES`, `RETIRE_BELOW_SHARE`; `PROVEN_MIN_ASKED` and `RETIRE_MIN_ASKED` are gone. Only online `rec_category` and `alternative` rows can be retired; the fixed questions and everything door/visit are only counted (`libraryStatus` takes mode and family).
ADR-0004 still says 20 / 50 answers; it should be superseded by a short ADR (architect).

**Usable, in one sentence.** A recommendation answer is usable when it names the business or any business at all, and an about-answer is usable when it was judged (correct, wrong, another business, not found) or carried a value for its probe that could not be checked.

**Distinct businesses, and what happens on deletion (chosen: a random per-business reference).** `business.question_ref` is a random uuid created with the business; `Db.recordQuestionUse` copies it into `question_use.business_ref` (callers cannot pass one). The view counts `distinct business_ref`. Deleting the business removes `question_ref` with it, so the ledger rows keep their counts and the business is still one of the "n businesses", but nothing can link a row to it: `scan_run_id` is null (FK `on delete set null`) and the reference matches no row anywhere (test: `select ... from business where question_ref = <ref>` is 1 before, 0 after). Rejected: a hash of the business id (a done job keeps `businessId` in its payload, so the hash could be matched after deletion); counting through `scan_run -> business` at read time (deleted businesses would drop out of the count and old counts would lose their meaning); a secret-keyed hash (needs a secret in the Worker and breaks all counts if it rotates). A business deleted and later checked again as a new business counts as a new business.

**What a ledger row holds (compliance B2, C-14).** Template key, family, mode, category, intent, `asked`, `usable`, time. `template_nl` is the code-held template with its slots for online keys. For door and visit it is a generic label built from the key's own parts ("Vraag over hours", "Aanbevelingsvraag over service (specialty)"): no part of the real question text is kept, not even with name and place replaced, because today's questions embed policies, services, credentials, prices and the kind of business verbatim. `useRows` sums prompts that share a key (several policies -> one `door.about.policy` row). Category is the profile's category cleaned by `sanitizeSlot`, and `onbekend` when it is empty or contains the business's name. Only stored samples count as asked (an engine outage is not a bad template). Event payloads: `library.retired` `{category, mode, templateKey}` with business null, once per template (status compared before and after the insert); `library.record_failed` `{scanRunId}` only.

**Verified (observed).** Database: a throwaway PostgreSQL 18.4 on port 5546 (not Supabase, not the hosted project), all 15 migrations applied in order with the edited 0015 and `scripts/local-auth-shim.sql`.
- `TEST_DATABASE_URL=... npx vitest run --no-file-parallelism test/question-library.test.ts test/db-profiles.test.ts test/profile-contract.test.ts`: 97 passed, on MemDb and PgDb. Without a database: 66 passed, 15 skipped (PgDb only).
- `PG_ADMIN_URL=... bash scripts/verify-pg.sh`: "OK verify:pg — 1927 samples in Postgres". `pnpm e2e:mock`: OK. `pnpm -r typecheck`: green. Full core suite earlier: the failures were mine (profile-contract's fake run ids, fixed) and `understand.test.ts` "answers a 100,000-character input in under 50 ms" (BE-04, a timing test; not mine, not re-run in isolation).
- AC-A7 on both: three scans in one category record their templates with counts (`trust`: asked 6, usable 6, businesses 3); a fourth business still gets the built-in pair (`rec.audience`, `rec.quality`); after five different businesses `trust` and `price` are proven and `audience` (0 usable) is not, and the next business's free check asks `rec.price` and `rec.trust`; a business in another category is unaffected.
- One visitor, 15 free checks on one business: `quality` asked 45, usable 45, `businesses` 1, trial; `audience` 45 asked, 0 usable, trial; no `library.retired`; the next free check still asks the default pair.
- Retirement: with 9 businesses at 0 usable the template is still trial and asked; the 10th business retires it; `library.retired` is logged once (still 1 after the 11th and 12th business); their full and free checks ask only the other three; another category still asks it. 2 businesses x 10 scans: `businesses` 2, still trial.
- Door and visit scans are recorded (`door.about.existence` ...), category `onbekend`, no name; the BE-03 snapshot tests still pass.
- Deletion: after `deleteBusiness` of an online business with distinctive offer, audience, competitor, service and policy strings and of a door business with policy/service/credential strings, the library sums are unchanged, no surviving row contains any of the strings or the names, and `scan_run_id` is null on every row (MemDb: the array; PgDb: `select count(*) from question_use where scan_run_id is not null` = 0).
- A failing `recordQuestionUse` (mocked to throw) leaves the scan finished, the ledger empty, one `library.record_failed` event with keys `["scanRunId"]` and none of the error text. A failing `questionLibrary` read gives the built-in order.

**Controls (guarantee removed, test went red, restored).** Thresholds counting answers instead of businesses: 12 failed (both databases). `pickTemplates` ignoring retired: 3. Ledger keeping the filled question (`prompt.textNl`): 10. MemDb `deleteBusiness` leaving the run link: 1. Record failure rethrown: 4. `library.retired` logged without the before/after comparison: 2. Category allowed to contain the business name: 1. Recommendation usable only when the business itself is named: 7. MemDb one reference per row instead of per business: 4. Proven at 1 business: 5. PgDb: the view counting rows instead of `distinct business_ref` (altered in the database, then rebuilt from the migrations): 4 failed.

**Sample `out/library.md`** (seeded on the throwaway Postgres: 10 businesses in one category, 6 in another; `out/` is gitignored; the seed script was deleted):

```
## Gestopt

| categorie | vraag | modus | gevraagd | bruikbaar | status |
|---|---|---|---|---|---|
| aanbieder van achtergrondmuziek | {Welke} is betaalbaar? | online | 20 keer, 10 bedrijven | 0 van 20 | gestopt |

## aanbieder van achtergrondmuziek

| vraag | modus | gevraagd | bruikbaar | status |
|---|---|---|---|---|
| Wat is een goed alternatief voor {naam}? | online | 20 keer, 10 bedrijven | 20 van 20 | bewezen |
| Is {naam} nog actief? | online | 20 keer, 10 bedrijven | 20 van 20 | vaste vraag |
| Bestaat {naam} nog? | online | 20 keer, 10 bedrijven | 20 van 20 | vaste vraag |
| {Welke} is goed voor {doelgroep}? | online | 20 keer, 10 bedrijven | 10 van 20 | in proef |
| {Welke} is betaalbaar? | online | 20 keer, 10 bedrijven | 0 van 20 | gestopt |
| Wat is {de beste}? | online | 20 keer, 10 bedrijven | 20 van 20 | bewezen |
| {Welke} raad je aan? | online | 20 keer, 10 bedrijven | 20 van 20 | bewezen |
| Wat is de website van {naam}? | online | 20 keer, 10 bedrijven | 0 van 20 | vaste vraag |
```

**Judgement calls.**
- The ticket and ADR say 20 / 50 asks; the review (S-23) says 5 / 10 businesses. Built the latter. AC-A7's "3 businesses" builds the library but cannot make a template proven any more; the test shows 3 -> counts, 5 -> proven.
- Door/visit text is a generic label, not the question with name and place replaced (the ticket's name/place replacement is not enough, B2). Julian sees counts per question type for shops, not per phrasing.
- MemDb `recordQuestionUse` accepts a run id that does not exist (PgDb refuses by foreign key), so `profile-contract.test.ts` (fake run ids) needed no change.
- `libraryCategory` is not clustered: "aanbieder van achtergrondmuziek" and "leverancier van achtergrondmuziek" are two libraries (A6, not in this ticket).
- If every built-in of a family were retired, the pick returns fewer questions, never a retired one. With four rec templates that takes all four failing in one category.
- Scans in the tests run as `baseline` with the owner profile set, because a `free` scan always runs the understanding step (network, or the mock keyword table); the free-check question choice is tested through `loadPrompts(..., "free", ...)`.

**Not verified / open.**
- Migration 0015 on `bbynmqvaxpjdnkaasutd`: not applied. `gen_random_uuid()` and the new `not null default` column on `business` (a table that exists in production) are untested on Supabase. The anon/authenticated denial for `question_use.business_ref` and the view is the existing S-19 proof (revoke on table and view) and still has to be run on the hosted project.
- `business.question_ref` is readable by an owner through the business row's RLS policy (a random uuid that only matches ledger rows; harmless, noted).
- The queue consumer on Cloudflare was not run with `recordScanUse`. The worker has no file system: production reads the view.
- `pnpm library` against the hosted project needs `DATABASE_URL`; not run. Reading the view in the SQL editor is in the RUNBOOK.
- `isUsable` was tested with scripted answers; how often real engines give usable answers per template is what the ledger will show.
- Compliance C-12 (export of the profile fields) is not done (not this ticket).

## BE-04 — Understanding step, mock, fallback, wiring into runScan (2026-11-11)

**What.** `runScan` now starts with the understanding step (kinds free, baseline, monthly, ondemand; a recheck skips it and keeps the profile the business has). Places rules decide what they can, then one `gpt-4.1-mini` lookup with `web_search`, then one tool-less classification with a strict `json_schema`. The profile is written to `scan_run.profile`, copied into the facts as `facts.profile` (`withProfile`), decides the questions (`loadPrompts(..., profile)`) and how answers are judged. It never blocks a check.

**Where.**
- `packages/core/src/scanner/understand.ts`: `decideMode`, `understandBusiness(input, deps?)`, `ensureProfile(db, business, facts, kind, deps?)`, `withProfile`, `mockUnderstand`, `understandInputFor`, `profileSummary`, `redactContacts`, `hostIsBusiness`, `classifyRequest`, `classifySystem`, `lookupQuestion`. `deps` (`openai`, `fetchImpl`, `now`) is the test seam; `RunScanOptions.understand` passes it through.
- `scanner/index.ts` (targeted edits): the step before `loadPrompts`; `createScanRun({... profile})`; the step's cost added to `costCents` before rounding; `scan.finished.mode`; `buildReport` and `buildSnapshot` judge with `withProfile(facts, scanRun.profile)`; `ScanReport.profile` from the run's profile. If an online profile leaves no question at all (the sanitiser refused the name), the door questions are asked: the check is not blocked.
- `scanner/util.ts`: `fetchPublicText` + `isPublicHttpUrl` (SSRF guard), `htmlToText` rewritten linear. `fetchText` untouched (its two old callers still follow redirects unguarded, as the checklist allows).
- `prompts/slots.ts`: `sanitizeSlot` normalises NFKC, strips control/format/zero-width characters, refuses bidi overrides, caps the raw text at 4x the slot limit, all before any test.
- `scanner/resolve.ts`: `pureServiceAreaBusiness` in the Text Search field mask -> `BusinessCandidate.serviceAreaOnly` -> `Facts.serviceAreaOnly`; `MOCK_ONLINE_RE`; `mockCandidate` returns an online-looking name without place id, address, phone, hours (website `https://www.<slug>.io`). `apps/web/app/app/gegevens/actions.ts`: `saveFacts` carries `serviceAreaOnly` over.
- `db/mem.ts`, `db/pg.ts`: `insertFacts` drops a `profile` key.
- `shared/typed-business.ts` (`typedBusinessProblem`, exported from `shared`): `apps/web/app/api/scan/route.ts` refuses a name over 120 or a place over 80 characters, markup (also fullwidth) and control/bidi/zero-width characters with the existing `?fout=leeg` redirect, before the e-mail check, Turnstile, Places or any event; `scan/kies/page.tsx` does not look anything up for such input.
- `shared/my-data.ts`: the export gains `profiles: {auto, owner}` (each run's profile is already on `scans[]`).
- Tests: `test/understand.test.ts` (47). Adjusted BE-06/BE-07 tests that relied on placeholders: `online-judging.test.ts` (profile now enters through `setOwnerProfile`, since facts never store it), `scan-progress.test.ts` (placeholder -> real profile; the "passed profile" test now uses a recheck).

**Review changes taken (they win over the ADR).** (1) the place is sanitised as well as the name before the lookup; a name that only trips the instruction-word list stops the lookup, not the check. (2) the mock runs on `VIDALO_MOCK=1` only; no key outside mock = fallback, nothing stored. (3) `sanitizeSlot` order. (4) citation host must equal the name; SSRF guard; HTML size capped by `fetchPublicText` (300 KB) and 4,000 characters reach the model. (5) e-mail addresses and phone numbers are removed before the classification call. (6) mock competitors are "Voorbeeld Klankwerk" and "Voorbeeld Geluidshuis". (7) a free check uses the automatic profile only, never the owner's correction. (8) the export holds the profiles.

**The two prompts.** Lookup: `instructions` = `systemFor(country)` (the engines' system text), `input` = `Wat is {naam} in {plaats}?` / `What is {name} in {place}?` with both cleaned by `sanitizeSlot(…, "name")`; `tools: [{type:"web_search", user_location, search_context_size:"low"}]`, `temperature: 0`, `max_output_tokens: 700`, SDK `{timeout: 30000, maxRetries: 1}`. Classification: Chat Completions, `temperature: 0`, `max_tokens: 400`, no `tools`, strict `json_schema` `{mode, offer, audience, category, competitors, website, confidence}`, system message `classifySystem(lang)` (fixed, no interpolated input), one user message `JSON.stringify({bedrijf:{naam,plaats,land}, google:{types,heeftAdres,alleenWerkgebied}, website:{host,tekst}, opzoeking:{antwoord}})`.

**Cost.** At 8,000 in / 300 out tokens for the lookup and 1,500 / 100 for the classification (the figures in the tests; real usage not measured): lookup 1.37 ¢ + classification 0.08 ¢ = about 1.45 ¢ per check, added to the run's `costCents`. Mock and failed-before-call paths cost 0; a failed classification still counts the lookup.

**Verified.** `corepack pnpm -r typecheck` green; `npx vitest run` in core 64 files / 1169 passed; worker 24; `pnpm e2e:mock` OK. Controls (guarantee removed, test red, restored; list in the report to the caller): NFKC, control/zero-width strip, bidi refusal, raw-length cap, place sanitised, mock gated on key, host equals name, SSRF address guard, scheme/credential guard, redirect re-check, e-mail and phone redaction, Places rule listing+sector=door, service-area visit, fallback never stored, earlier auto reused, store failure caught, empty-online guard, owner profile skips calls, free check ignores the owner (S-28), cost added, recheck skips, report keeps the run's profile, linear `htmlToText`, zod caps (offer, competitors), website from the page not the model, export profiles, `insertFacts` drops profile, `withProfile` borrow rule, S-04 length and markup, classify without tools, untrusted text in the system message, text caps, mock fictional names, mock offline, one fetch when the known site was read, lookup timeout, `profile.decided` key set.

**Not verified.** No live OpenAI call: `web_search` plus the `json_schema` output on the real API, the real token counts and the real cost per check are unmeasured. A rebinding hostname that resolves to a private address is not caught (checks are on literal hosts; Workers cannot reach private networks, the CLI can). `PgDb` was not run for the new writes (`pnpm verify:pg` needs a local Postgres; the CHECK shapes accept the mock and fallback profiles by reading, not by running). Both Playwright suites were not run. The `/api/scan` route and the `kies` page are not exercised by a test (apps/web has no unit runner); their check is `typedBusinessProblem`, which is. The privacy statement already names OpenAI for the checks; the legal desk should read it once with this step.
