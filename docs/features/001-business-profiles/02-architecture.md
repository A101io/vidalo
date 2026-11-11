# Architecture — 001 Business profiles: questions per kind of business, and competition

*architect · 2026-11-11 · built against `01-brief.md` including Amendment A (which wins where it conflicts)*

## Shape

Every scan (free, baseline, monthly, on demand; not a recheck) begins with an **understanding
step** inside `runScan`, on the process that runs the scan: the queue consumer on Cloudflare,
the `after()` hook locally, the worker's `scan` job for paid scans, the CLI. Places rules
decide what they can (a pure service-area listing is `visit`, a listing with a local sector
is `door`), then one OpenAI lookup with web search and one schema-bound classification
call (no tools) produce a `BusinessProfile`. The profile is written to `business.profile_auto`
(an owner's correction lives in `business.profile_owner` and always wins) and snapshotted on
`scan_run.profile`, so a report is always judged against the profile it was asked with. When
the step fails or is unsure, a fallback profile is used and the scan goes on (AC-A3).

The profile's `mode` then picks the questions (`prompts/profile.ts`): `door` is today's code
path, unchanged text for text; `visit` is today's set minus the families the A2 table
excludes; `online` is built from code-held templates (`prompts/online.ts`, `online.en.ts`) whose
slots (`category`, `audience`, a competitor name) pass one sanitiser (`prompts/slots.ts`). For
the online recommendation slots, a **question library** (an append-only usage ledger,
`question_use`, read through the `question_library` view) prefers templates proven for the
category and never asks retired ones. The scan emits typed progress (profile, chosen questions,
answers per AI system, comparing) that the waiting page polls; the finished `ScanReport` gains
`profile` and, per recommendation question, its family and up to three quotes, from which the
report page draws a competition block for online businesses. The dot stays fact-only.

```
POST /api/scan ──► prepareBusiness (facts v1, no prompts any more) ──► queue / after()
                                                                          │
runScanWithProgress ── stage "understand" ──► runScan
   │                                            ├─ ensureProfile()   scanner/understand.ts
   │   ◄── {type:"profile"} ───────────────────┤      Places rules → lookup (web_search) → classify (json_schema, no tools)
   │                                            │      → business.profile_auto ; fallback on failure
   │   ◄── {type:"questions"} ─────────────────├─ loadPrompts(profile)  prompts/profile.ts + library.ts + online.ts
   │   ◄── {type:"start"/"asked"/"escalate"} ──├─ sample engines (unchanged sampling rules)
   │   ◄── {type:"phase"} ─────────────────────├─ extract (identity:kind) → compare → stip (unchanged rule)
   │                                            ├─ recordQuestionUse()  question_use ledger
   ▼                                            └─ ScanReport { profile, recommendations[].family/.quotes }
scan.progress event ◄── GET /api/scan/[token]/status ◄── waiting page (polls 2 s)
```

## Decisions

| ADR | Decision | Why | Alternative rejected |
|---|---|---|---|
| [ADR-0001](adr/0001-profile-decided-in-the-scan-stored-apart-from-facts.md) | The understanding step runs inside `runScan`, before the questions; the profile lives in `business.profile_auto` / `business.profile_owner` and is snapshotted on `scan_run.profile`; never in facts | One place for free, paid and CLI; the web request stays fast; facts stay owner-asserted; an old report keeps its own profile | Running it in the `/api/scan` request (adds 10–20 s before the waiting page, and on Workers it shares the request's budget); storing it inside facts (a new facts version only by the owner) |
| [ADR-0002](adr/0002-understanding-places-rules-then-lookup-then-classify.md) | Places rules first; then one `web_search` lookup in prose and one strict-JSON classification with no tools; deterministic mock; fallback profile | The classifier sees untrusted text only as data and can do nothing but fill a schema; Places facts are not overruled by a model; about 1.5 ¢ per check | One call with tools and JSON output together (couples reading untrusted pages with producing the profile; not relied on); asking the visitor (Julian rejected it in Amendment A1) |
| [ADR-0003](adr/0003-questions-chosen-by-mode-from-templates-with-sanitised-slots.md) | Questions per mode from code-held templates; local modes reuse today's generators and only filter; slots pass one sanitiser that cleans or refuses | AC-3/AC-A2 hold by construction; model text never becomes a question; one place decides which family applies | Three new sector-style packs (the category slot already carries webshop/software/service); model-written questions (A3 forbids) |
| [ADR-0004](adr/0004-question-library-is-an-append-only-ledger.md) | The library is an append-only ledger (`question_use`, one row per template per scan) plus a view; thresholds and status live in code (`prompts/library.ts`) | No hot counter row; nothing to repair; retirement is derived and permanent because a retired template is never asked again | Counter rows updated per scan (contention and lost updates on retries); a status column (two places to decide); an admin screen (A6) |
| [ADR-0005](adr/0005-competition-counted-per-question-outside-the-dot.md) | Competition is counts per recommendation question on the report; "wat doet X" is judged as same kind / other kind / not found on criterium 11; the stipregel is unchanged | Julian's decision of 25 Oct 2026 stands; AC-6 needs a dot that can turn orange on a wrong identity | Counting "named" into the dot; a share-of-voice percentage (CRITERIA.md forbids, AC-5 forbids) |
| [ADR-0006](adr/0006-waiting-page-reads-typed-progress-css-animation.md) | The waiting page polls a typed state (`stage`, `profile`, `questions`, per-engine counts); motion is CSS on React-rendered markup; `motion.js` is not involved | Real state only (AC-A9); no hydration risk; reduced motion is one media query | Server-sent events (Workers + OpenNext streaming not proven here); animating through `motion.js` (it must never change markup and does not know React state) |

## Data model

Migration **`supabase/migrations/0015_business_profiles.sql`** (main ends at 0014; the unmerged
branch `claude/domain-registrar-bc28c8` also carries a 0015: whichever merges second renumbers,
migrations are never edited after they are applied).

| Object | Shape | Invariant, and what enforces it |
|---|---|---|
| `business.profile_auto jsonb` | `BusinessProfile` written by the understanding step | Shape: CHECK `business_profile_auto_shape` (mode in `door`,`visit`,`online`; `offer` ≤ 120, `audience` ≤ 80, `category` ≤ 60 chars; `jsonb_array_length(competitors) <= 3`; no `<>{}[]"\`\\/@#$%^*=|~;:` in the four slot fields) |
| `business.profile_owner jsonb` | `BusinessProfile` with `source:"owner"` | Same CHECK `business_profile_owner_shape`. **An automatic profile never overwrites an owner's**: they are different columns; `Db.setAutoProfile` updates `profile_auto` only and `Db.setOwnerProfile` updates `profile_owner` only; `upsertBusiness` writes neither. The database cannot tell the two callers apart (both are the service role), so this is structural plus a test on MemDb and PgDb, not a trigger. Said plainly |
| `scan_run.profile jsonb` | The effective profile the scan was asked and judged with | CHECK `scan_run_profile_shape` (same rules). Written once by `createScanRun`; `updateScanRun` has no field for it |
| `prompt.template_key text` | `online.rec.audience`, …; null for today's generated prompts | CHECK `char_length(template_key) <= 80` |
| `question_use` (new) | `id bigserial pk`, `scan_run_id uuid references scan_run(id) on delete set null`, `category text not null`, `mode text not null`, `template_key text not null`, `template_nl text not null`, `family text not null`, `intent text`, `asked int not null`, `usable int not null`, `at timestamptz default now()` | CHECKs: `mode in (…)`, `family in (…the 11 families)`, `asked >= 0`, `usable between 0 and asked`, lengths (category ≤ 60, template_key ≤ 80, template_nl ≤ 300). `unique (scan_run_id, template_key)` makes a scan's rows idempotent. Index `(category, mode)`. RLS on, no policies, `revoke all … from anon, authenticated` (as `waitlist`). `on delete set null`: deleting a business removes its scan runs, the counts stay without any link to it |
| `question_library` (view) | `category, mode, template_key, template_nl, family, intent, asked, usable, usable_share` = `sum` over `question_use` grouped by category, mode, template_key | `with (security_invoker = true)` and `revoke all … from anon, authenticated`. No status column: the thresholds are decided in `prompts/library.ts` only (ADR-0004) |

`Facts` gains two in-memory or Places-derived fields, never owner-entered:
`serviceAreaOnly?: boolean | null` (Google's `pureServiceAreaBusiness`, stored in the provisional
facts like `googleTypes` and carried over by `saveFacts` like `googleTypes`), and
`profile?: BusinessProfile | null` (copied in by `withProfile()` wherever facts meet the scanner,
as `withCountry()` does; `insertFacts` strips it so it is never stored in facts JSON).

Rules the brief states, and where each is enforced:

| Rule | Enforced by |
|---|---|
| A slot value never reaches an AI system verbatim with markup, a URL or an instruction (AC-A8) | `sanitizeSlot()` in `prompts/slots.ts` (the only producer of slot values) + the DB CHECKs above as backstop for stored profiles |
| Model-written free text never becomes a question | Templates exist only in `prompts/online.ts` / `online.en.ts`; `fillTemplate()` accepts only `SlotValues` from `sanitizeSlot()` |
| A retired template is never asked again in that category | `pickTemplates()` in `prompts/library.ts` excludes `status === "retired"`; status is derived from the ledger, and a template that is not asked cannot leave "retired" |
| Owner correction never overwritten | Separate columns (above) |
| A report is judged against the profile it was asked with | `scan_run.profile`, read by `buildReport` / `buildSnapshot` |
| The business's own name is never a competitor | `competitorsInUse()` drops any name where `mentionsBusiness(name, facts)` or `normalizeName` equals the business's |
| Competition never changes the colour | `computeEngineStips` already excludes `named`/`not_named` verdicts; unchanged, and AC-6's green fixture tests it |

## Interface contract

Everything below is written into code by **BE-01** (types, `Db` signatures, MemDb in full,
`sanitizeSlot` and `parseOwnerProfile`) before any other ticket needs it. Frontend tickets compile against these exact names.

### Types (`packages/core/src/types.ts`)

```ts
export type ProfileMode = "door" | "visit" | "online";
export type ProfileBasis = "google" | "website" | "ai_lookup" | "owner";
export type ProfileConfidence = "high" | "medium" | "low";

export interface BusinessProfile {
  mode: ProfileMode;
  /** What it sells, one short phrase in the scan language; sanitised; ≤ 120 chars. */
  offer: string | null;
  /** For whom; sanitised; ≤ 80. */
  audience: string | null;
  /** The noun a buyer searches with, singular, lowercase ("aanbieder van achtergrondmuziek"); ≤ 60. */
  category: string | null;
  /** Up to 3 names seen next to it; sanitised; never the business itself. Owner profiles keep the automatic list. */
  competitors: string[];
  /** Host of the business's own site, only when its page names the business ("sonable.io"). */
  website: string | null;
  confidence: ProfileConfidence;
  basis: ProfileBasis[];
  /** auto: understanding step · owner: corrected on /app/gegevens · fallback: the step failed or was unsure */
  source: "auto" | "owner" | "fallback";
  /** true when offer/category rest on Google, the own website or the owner: then "wat doet X" can be judged. */
  grounded: boolean;
  decidedAt: string; // ISO
}

/** What visitors see of a profile (waiting page, report). */
export type ProfileSummary = Pick<BusinessProfile, "mode" | "offer" | "audience" | "category" | "source">;

export type QuestionFamily =
  | "existence" | "hours" | "address" | "payment" | "phone" | "what" | "website"
  | "rec_town" | "rec_category" | "alternative" | "other";

// changed
export type RecommendationIntent = "quality" | "trust" | "now" | "specialty" | "price" | "place" | "alternative";
export const INTENT_SUBJECT = { quality: "beste", trust: "betrouwbaar", price: "betaalbaar", place: "dichtbij", alternative: "alternatief" } as const;

// Prompt gains
templateKey?: string | null;

// Facts gains
serviceAreaOnly?: boolean | null;
profile?: BusinessProfile | null;   // in memory only (withProfile), never stored

// ScanRun gains
profile?: BusinessProfile | null;

// RecommendationSummary gains
family: "rec_town" | "rec_category" | "alternative";
/** Up to 3 sentences that name the business and none of `others`, ≤ 240 chars each. Empty for rec_town. */
quotes: { text: string; engine: Engine }[];

// ScanReport gains
/** The profile the scan was asked with; null on reports before this feature (read them as door). */
profile?: ProfileSummary | null;
```

Report rule the frontend relies on: `report.profile?.mode === "online"` means no question
contains the town, `report.recommendations` holds only `rec_category` and `alternative` rows, and
the about-questions are the families `existence`, `what` (`factKey: "identity"`, `subject: "kind"`),
`website`, `phone`. A finding with `factKey "identity"` and `subject "kind"` has
`wrongValue: "other"` and `correctValue: "same"`; its line reads "beschreven als een ander soort bedrijf".

### Waiting-room state and the status endpoint

```ts
// packages/core/src/scanner/progress.ts (replaces steps[])
export type ScanStage = "understand" | "choose" | "ask" | "compare" | "done";
export interface ScanJobState {
  token: string;
  businessId: string;
  scanRunId: string | null;
  status: "queued" | "running" | "done" | "failed";
  stage: ScanStage;
  profile: ProfileSummary | null;              // set when stage leaves "understand"
  questions: { id: string; text: string }[];   // set at "choose", in asking order, scan language
  engines: { engine: Engine; received: number; expected: number }[]; // one per asked engine, from "ask" on; expected can grow (second round)
  error?: string | null;                       // stored, never sent to the browser
}

// packages/core/src/scanner/index.ts ScanProgress gains / changes
| { type: "profile"; profile: ProfileSummary }
| { type: "questions"; questions: { id: string; text: string }[] }
| { type: "start"; scanRunId: string; total: number; perEngine: Partial<Record<Engine, number>> }
| { type: "escalate"; perEngine: Partial<Record<Engine, number>> }   // samples added per engine by round 2
```

Stage transitions (driven only by these events): created `queued/understand` → `profile`
event → `choose` → `questions` event (still `choose`, questions filled) → `start` → `ask` →
`phase: extract|compare` → `compare` → `phase: done` or the run returning → `done`.

| Operation | Input | Output | Errors | Who may call it |
|---|---|---|---|---|
| `GET /api/scan/[token]/status` | path `token` (`<businessId>_<12 hex>`) | `200 {status, stage, profile, questions, engines, reportUrl}`; `reportUrl` is `"/r/<scanRunId>"` when `status === "done"`, else `null`. Header `cache-control: no-store` | `404 {status:"missing"}` unknown token. A state stored before the deploy (no `stage`) is returned as `stage:"ask"` with empty `questions`/`engines` | Anyone holding the token (capability; unchanged) |
| `POST /api/scan` | unchanged | unchanged | unchanged | unchanged (Turnstile, per-IP and daily caps). The understanding step runs inside the queued scan and is covered by the same caps |
| Page `/scan/[token]` (NL, `/en/scan/[token]`) | — | Server-renders the current state with the same fields; client polls the endpoint every 2 s; redirects to the report when done | `notFound()` for an unknown token | Token holder |

Example (mock Sonable, mid-scan):

```json
{
  "status": "running",
  "stage": "ask",
  "profile": { "mode": "online", "offer": "achtergrondmuziek voor hotels en horeca", "audience": "hotels, restaurants en winkels", "category": "aanbieder van achtergrondmuziek", "source": "auto" },
  "questions": [
    { "id": "p1", "text": "Bestaat Sonable nog?" },
    { "id": "p2", "text": "Wat doet Sonable?" },
    { "id": "p3", "text": "Wat is de website van Sonable?" },
    { "id": "p4", "text": "Welke aanbieder van achtergrondmuziek is goed voor hotels, restaurants en winkels?" },
    { "id": "p5", "text": "Wat is de beste aanbieder van achtergrondmuziek?" },
    { "id": "p6", "text": "Wat is een goed alternatief voor Sonable?" }
  ],
  "engines": [ { "engine": "chatgpt", "received": 11, "expected": 18 }, { "engine": "google_ai", "received": 6, "expected": 6 } ],
  "reportUrl": null
}
```

### Core functions other tickets call

| Operation | Input | Output | Errors | Who may call it |
|---|---|---|---|---|
| `sanitizeSlot(raw, slot)` `prompts/slots.ts` | `raw: string`, `slot: "name" \| "category" \| "audience" \| "offer" \| "competitor"` | cleaned string, or `null` when refused | never throws | Core and the web's owner action; the only way to make a slot value |
| `parseOwnerProfile(fields, current)` `scanner/understand.ts` | `{mode, offer, audience, category}` as strings from the form; `current: BusinessProfile \| null` (competitors are kept from it) | `{ok:true, profile: BusinessProfile}` (`source:"owner"`, `basis:["owner"]`, `grounded:true`, `confidence:"high"`) or `{ok:false, field: "mode"\|"offer"\|"audience"\|"category", reason: "required"\|"refused"\|"too_long"}` | — | FE-03's server action |
| `effectiveProfile(business)` | `Pick<BusinessRecord, "profileAuto" \| "profileOwner">` | owner's mode/offer/audience/category over auto; competitors and website from auto; `null` when neither exists | — | Core; FE-03 to prefill the form |
| `Db.setAutoProfile(businessId, profile)` | `BusinessProfile` with `source:"auto"` (a fallback is never stored; it lives on `scan_run.profile` only) | `void`; writes `profile_auto` only | DB CHECK violation throws | Understanding step only |
| `Db.setOwnerProfile(businessId, profile)` | `BusinessProfile` with `source:"owner"` | `void`; writes `profile_owner` only | CHECK violation throws | FE-03 server action after `requireVerifiedOwner` |
| `Db.recordQuestionUse(rows)` | `QuestionUseInput[]` | `void`; one insert, `on conflict (scan_run_id, template_key) do nothing` | — | `runScan` only |
| `Db.questionLibrary(filter?)` | `{category?, mode?}` | `LibraryRow[]` (sums) | — | `loadPrompts`, `pnpm library` |
| `libraryStatus(row)` `prompts/library.ts` | `{asked, usable}` | `"proven"` (asked ≥ 20, usable ≥ 60 %), `"retired"` (asked ≥ 50, usable < 30 %), else `"trial"` | — | Core, CLI |

```ts
// packages/core/src/db/types.ts
interface BusinessRecord { /* … */ profileAuto: BusinessProfile | null; profileOwner: BusinessProfile | null; }
interface ScanRunCreate { /* … */ profile?: BusinessProfile | null; }
interface QuestionUseInput { scanRunId: string; category: string; mode: ProfileMode; templateKey: string; templateNl: string; family: QuestionFamily; intent: string | null; asked: number; usable: number; }
interface LibraryRow { category: string; mode: ProfileMode; templateKey: string; templateNl: string; family: QuestionFamily; intent: string | null; asked: number; usable: number; }
```

### Owner profile correction

| Operation | Input | Output | Errors | Who may call it |
|---|---|---|---|---|
| Server action `saveProfile(form)` in `apps/web/app/app/gegevens/actions.ts` | form fields `profileMode` (`door`\|`visit`\|`online`), `profileOffer`, `profileAudience`, `profileCategory` | redirect `/app/gegevens?profiel=1`; event `profile.corrected {from: mode, to: mode}`; the next scan uses it | redirect `/app/gegevens?profielfout=<field>:<reason>`; each error announced and tied to its field (AC-8) | Signed-in, verified owner (`requireVerifiedOwner`); the business is the session's, never an id from the form |

### Events (instrumentation)

| Event | Business | Payload | Emitted by |
|---|---|---|---|
| `profile.decided` | yes | `{mode, source, confidence, basis, costCents, scanRunKind}` (no free text) | understanding step |
| `profile.corrected` | yes | `{from, to}` (modes only) | FE-03 action |
| `library.retired` | null | `{category, mode, templateKey}` | `runScan` when a recorded use moves a template into retired |
| `scan.finished` | yes | gains `mode` | unchanged emitter |

## Authorisation model

| Data | Read | Write |
|---|---|---|
| `business.profile_auto`, `profile_owner` | Owner through the existing `owner_business` RLS select policy (their own business row); everything else through the service handle | Service handle only: understanding step (`profile_auto`), the verified owner's server action (`profile_owner`). No RLS write policy exists on `business`; the browser's anon key writes nothing |
| `scan_run.profile` | Owner via `owner_scan`; reports through the service handle as today | `createScanRun` only |
| `question_use`, `question_library` | Service role / table owner; Julian through the SQL editor | `runScan` only |
| Waiting-room state | Token holder via the status endpoint (no free text beyond the profile summary and question texts; never competitors, never the error message) | The process running the scan |

Vidalo has one owner per business and no membership table; this feature does not add one. The
owner check stays `requireVerifiedOwner`, which derives the business from the session (owner
user id or proven owner e-mail), never from a client-supplied id. That is the property the
"membership, not ownership" rule protects; a membership model is out of this cycle's scope.

Nothing the client writes grants value: the visitor cannot set a profile, and an owner's profile
changes which questions are asked within the same bounded count (online full scan ≤ 13 questions,
under today's 38).

## Failure modes

| What fails | Detected how | What the user sees | What we do |
|---|---|---|---|
| Lookup or classify call errors or times out (30 s each) | exception / timeout in `understandBusiness` | Waiting page moves on from "Je bedrijf begrijpen"; report says "Gecontroleerd als: …" from what was used | The business's earlier `profile_auto` when it has one; else a fallback profile (`source:"fallback"`): Places-decided mode when Places decides, else listing → `door` (today's questions), no listing → `online`. Event `profile.decided` with the source; scan continues (AC-A3) |
| Classifier returns `confidence:"low"`, or the lookup says it knows nothing and no site text exists | classify output / `looksNotFound` on the lookup | as above | Same as the row above; a low or fallback profile is never written to `profile_auto` (a later scan tries again), only to `scan_run.profile` |
| A slot value is refused by the sanitiser | `sanitizeSlot` returns null | Fewer questions (an online check without a category asks 4: existence, what, website, alternative) | Template needing the slot is skipped; a refused category or offer lowers confidence to low → fallback |
| Business name typed by the visitor is refused by `sanitizeSlot(…, "name")` | null | Check runs on today's or the fallback set | No lookup is made with it (security checklist to decide whether the name check should also gate the engines; today's behaviour is unchanged) |
| Own website unreachable or does not name the business | `fetchText` null / name not in text | Nothing visible | `basis` lacks `website`; offer not grounded → "wat doet X" answers are counted as unchecked (grey line), never green |
| `question_use` insert fails | exception in `recordQuestionUse` | Nothing | Logged as `library.record_failed`; the scan result stands (the ledger is not on the critical path) |
| Library read fails during question choice | exception | Nothing | Built-in default order is used |
| Status endpoint reads a pre-deploy state | no `stage` field | Steps show from "Vragen aan …" with counters missing | Returned as `stage:"ask"`; such states live minutes |
| Owner sets `online` for a business that is really local | — | Next check asks online questions | Their decision; the profile group on `/app/gegevens` shows what each mode asks |

## Cost

| Line | Per check | Note |
|---|---|---|
| Lookup: `gpt-4.1-mini` + `web_search` (search context low) | ≈ 1.4 ¢ ($10/1k calls + ~8k input tokens block + ~300 output) | prices in `engines/chatgpt.ts`, checked 30 Oct 2026 |
| Classify: `gpt-4.1-mini`, no tools, ≤ 4,000 chars of site text + lookup prose | ≈ 0.1 ¢ | |
| Site fetch | 0 | one page, 8 s, 300 KB, as `scrapeSite` |
| **Total** | **≈ 1.5 ¢ (€0.014)** | added to the scan run's `costCents`, so the paid daily ceiling (`spend.ts`) counts it |

Free check today ≈ €0.25 → ≈ €0.26 (+6 %). Monthly scan: < 0.2 % of €7–11. An online full check
asks ≤ 13 questions instead of up to 38, so it costs less than a local one. Sampling rules unchanged.

## Surfaces that change in the same PR (AC-7)

| Surface | Change | Ticket |
|---|---|---|
| Landing "Zo werkt Vidalo" (`copy.landing.werkt`) | first step mentions that we first read what the business does | FE-04 |
| Landing FAQ (`copy.landing.vragen.items`) | new entry "Werkt dit ook als ik geen winkel heb?" (NL + EN); reaches the assistant automatically (`chat/index.ts buildKnowledge` reads the FAQ) | FE-04 |
| Pricing (`copy.landing.prijs`, `/prijzen`) | none on the page (plans are generic); on an online report's plan panel "1 vestiging" reads "1 bedrijf" (Q5) | FE-02 |
| `docs/CRITERIA.md` | profile modes and the family table; online question set; criterium 11 gains "beschreven als een ander soort bedrijf"; the exclusion "Ranking en share of voice / Vergelijkingen met concurrenten" narrowed: counts per question allowed, never a position, percentage or score (Q4) | FE-04 |
| `docs/MESSAGING.md` | waiting-page and competition-block rules; no promise that AI will name you | FE-04 |
| `docs/ARCHITECTURE.md` | Workflow A: understanding step; question library | FE-04 |
| Assistant (`core/chat`) | no code change (reads the copy); FE-04 verifies the new FAQ line appears in `buildKnowledge` output with a test assertion | FE-04 |
| Mails | baseline/monthly mails for an online business: no town, no local question wording; competition block **not** added (out of scope) | BE-08 |
| Terms and privacy | **expected none**: no new vendor (OpenAI and the business's own site are already contacted for every check; privacy names "OpenAI: ChatGPT voor de controles"). Compliance confirms in phase 1; if they ask for a sentence, `legal:lock` with a new date | — (compliance) |
| `docs/processors.md` | none: OpenAI "Business facts only" still true (name, place, public site text) | — |

## Work split

| Ticket | Lane | Depends on | Estimate |
|---|---|---|---|
| [BE-01](tickets/BE-01.md) Contract: types, `Db` signatures, MemDb, `sanitizeSlot`, `parseOwnerProfile` | backend | — | 3 h |
| [BE-02](tickets/BE-02.md) Migration 0015 and PgDb | backend | BE-01 | 3 h |
| [BE-03](tickets/BE-03.md) Questions by profile: families, online templates NL/EN, `loadPrompts` | backend | BE-01 | 5 h |
| [BE-04](tickets/BE-04.md) Understanding step, mock, fallback, wiring into `runScan` | backend | BE-01, BE-03 (`loadPrompts` takes the profile) | 6 h |
| [BE-05](tickets/BE-05.md) Question library: usable rule, ledger, pick, retire, `pnpm library` | backend | BE-01, BE-03 | 4 h |
| [BE-06](tickets/BE-06.md) Judging an online business: identity:kind, town-free name and namesake rules, families and quotes | backend | BE-01 | 4 h |
| [BE-07](tickets/BE-07.md) Progress events, `ScanJobState` v2, status endpoint | backend | BE-01 | 2 h |
| [BE-08](tickets/BE-08.md) Mails, CLI markdown, `e2e:mock` with an online business | backend | BE-03, BE-04, BE-06 | 2 h |
| [FE-01](tickets/FE-01.md) Waiting page | frontend | BE-01 (types only) | 5 h |
| [FE-02](tickets/FE-02.md) Report for an online business: competition block, "Gecontroleerd als" | frontend | BE-01 (types only) | 5 h |
| [FE-03](tickets/FE-03.md) Profile correction on `/app/gegevens` | frontend | BE-01 (types, `parseOwnerProfile`, MemDb) | 3 h |
| [FE-04](tickets/FE-04.md) Every surface: landing, FAQ, CRITERIA, MESSAGING, ARCHITECTURE, jargon test | frontend | — | 3 h |

Frontend dependency, flagged: FE-01, FE-02 and FE-03 compile against BE-01, a three-hour
ticket of types, signatures, MemDb and two pure functions (`sanitizeSlot`, `parseOwnerProfile`);
no scanner logic. Nothing on the frontend waits for scanner behaviour: FE-01 builds against the
status JSON above with fixtures, FE-02 against a fixture `ScanReport` in its view-model test,
FE-03 end to end on MemDb the day BE-01 merges. Their browser checks with a real online business
in mock mode need BE-03, BE-04 and BE-06 merged; that is QA's phase, not a build block.

## Interpretations of the brief, named

1. **AC-3's "visit" clause vs the A2 table.** The amendment wins: for *ik kom bij de klant* the
   address and pinnen questions go, and the hours questions go when the facts have no open day.
   The free set is today's minus those, without replacements (it can be 3–5 questions).
2. **A2 row "wat doet X / website": door = no** conflicts with AC-A2 ("the questions asked on main
   today"), which include the website question. AC-A2 wins: door and visit keep today's website
   question; the row means the online `what` and town-free website questions.
3. **"Every question asked is a row in a library"**: every scan records every question (all
   modes). The library *chooses* and *retires* only online recommendation templates, because
   door and visit must stay identical to main (AC-A2, AC-3).
4. **"A file the worker writes"**: production runs the worker on Cloudflare, which has no file
   system. The list is the `question_library` view plus `pnpm library`, which writes
   `out/library.md` locally (retired templates listed first).
5. **Original AC-4 (competitor questions) is replaced** (owner-entered competitors out). A full
   online check asks one "alternatief voor {X}" per competitor in use (≤ 3): the profile's
   competitors, else the three most-named in the previous online check. The "compare with X on
   price/features" question is not asked: nothing in Amendment A asks for it.
6. **AC-8** now covers the waiting page, the competition block and the profile group on
   `/app/gegevens`; the `/scan/kies` choice and competitor field it named no longer exist.
7. **Success metric 3** (visitors changing the preselected profile) has nothing to measure;
   `profile.corrected` events by owners replace it.

## What this makes harder later

- **Two places hold "what kind of business is this"**: `business.sector` (picks local packs)
  and the profile's `category`/`mode`. They are allowed to disagree for now; a later merge needs
  a migration of `sector` into the profile, not the other way round.
- **Every scan now spends one search call before the first question.** A future cheaper engine
  plan has to keep this one, or move to "reuse the profile for 30 days", which re-opens the
  question of when a business changed.
- **The ledger cannot be corrected by hand.** A bad week (an engine outage making answers
  unusable) lowers usable shares permanently and can retire a good template. Undoing that means
  deleting ledger rows by SQL, with a reason in `LEARNINGS.md`.
- **Retirement is per category string.** "aanbieder van achtergrondmuziek" and "leverancier van
  achtergrondmuziek" learn separately until categories are normalised; we chose not to cluster.
- **Templates are code.** Julian approving a new template means a PR, not a click. That is the
  A6 non-goal working as intended, and it is also the next thing he will ask for.
- **The profile summary is in the scan language.** An English report page of a Dutch business
  shows a Dutch offer phrase, as the asked questions already are.
