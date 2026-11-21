# Security checklist — 006 Productlijnen

*security · phase 1 (shape) · 2026-11-21 · written against `02-architecture.md`, ADR-0010..0014,
tickets BE-01..BE-06 and FE-01..FE-05, `01-brief.md`, the standing list
`docs/process/checklists/security.md` and `_OS/playbook/SECURITY.md` (S1–S12). Read against the
code on this branch where the design reuses it: `prompts/slots.ts` (`sanitizeSlot`, `plainText`),
`apps/web/lib/owner.ts` (`requireOwnerOf`, `businessFromForm`), `db/pg.ts` (`withLock`,
`paidScanCentsSince`), `fixer/index.ts` (`markFixedByOwner`, correction mails),
`reporter/templates.ts` (`esc`, `linkify`), `prompts/profile.ts` (`competitorsInUse`), migrations
0001, 0004, 0016.*

This is the list phase 4 verifies, item by item, with evidence. Each item names its ticket, what
must be true, and the proof that counts (a red-then-green test, a refused request, a read-back).
"Sev if open" is what a failure found in phase 4 is filed as. Nothing in the design as written is
a P0 (see the end).

## Trust boundaries in this feature

| # | Boundary | Untrusted input | Where it goes |
|---|---|---|---|
| T1 | Signed-in member → server actions `saveProductLine`, `setProductLineStatus` | hidden `business`, hidden `line`, `status`, every form field (name, category, use cases, markets, spec label/value, certificate name/number/date, outlet market/name/url, replaces, replacedBy) | `product_line`, `product_line_facts.data`, engine questions, extraction prompt, owner pages, monthly mail, owner instruction mail, correction letters to third parties |
| T2 | Owner text → AI engines (with `web_search`) and the extraction model | name, category, use cases, spec labels, certificate names, replaced names (as slots) | `generateLinePrompts` → engines; `extractClaimsLlm` user message |
| T3 | AI answers → judging, report, mail | answer text, named outlets and products, cited hosts, `others` names | claims, findings (`wrongValue`), "Wie AI wel noemt", line mail section, correction letters |
| T4 | Member JWT / anon key → PostgREST | the JWT, the anon key | `product_line`, `product_line_facts`, new columns on `scan_run`, `finding` (and internal `prompt`, `sample`) |
| T5 | Owner page params | `[id]`, `?markt=`, `?fout=`, `?opgeslagen=`, `?betwist=`, `?nieuw`, `?bewerken` | service-handle reads; rendered messages |
| T6 | Queue payload → worker | `ScanJob.productLineId/market`, `ReportJob.lines/waited`, recheck `fixId` | `runScan`, gating, spend |
| T7 | Public by id | `/r/[id]`, `/api/report-email` (`scan` field), `/api/scan/[token]/status` | a line run must not appear on any of them |

## A. Data layer: RLS, grants, scope invariants (migration 0020, BE-02)

- [ ] **S-01 · BE-02** `product_line` and `product_line_facts`: RLS on; policies are by
  **membership** (`business_member`), never by `business.owner_user_id`; `revoke all … from anon,
  authenticated` then `grant select … to authenticated` only. No insert/update/delete policy and no
  write grant for either role.
  *Proof:* `scripts/rls/product-lines.sql` as BE-02 specifies (rolled-back block, identity and JWT
  claims set **inside** it, login 1 control sees 2 lines + 2 versions, login 2 sees 1, anon 0;
  insert, update, delete as `authenticated` denied on both tables), and the `-v broken=1` run that
  recreates the policy as `using (true)` printing `RLS-FAIL`. Add a second control: login 2 is
  given a `business_member` row for B only and still sees 0 of A's versions through
  `member_product_line_facts` (the join path). *Sev if open:* P0 if any cross-business read or any
  write through the Data API; else P1.
- [ ] **S-02 · BE-02** Line rows on the shared tables stay as private as the business's:
  `member_scan`, `member_finding`, `member_fix` (0016) unchanged and still membership-based; `prompt`
  and `sample` keep no policy and no grant for anon/authenticated (0004). The new columns add no
  write grant: as `authenticated` with owner A's JWT, `update finding set product_line_id = …` and
  `update scan_run set product_line_id = …, market = …` on A's and B's rows → error or 0 rows, rows
  re-read unchanged.
  *Proof:* the same RLS script, extended with those statements; plus anon `curl` on
  `/rest/v1/product_line`, `/rest/v1/product_line_facts`, `/rest/v1/prompt?product_line_id=not.is.null`
  → empty or permission denied once D4 applies 0020 (follow-up, the hosted run). `get_advisors`
  (security) shows nothing new after D4. *Sev:* P0 if cross-tenant; else P1.
- [ ] **S-03 · BE-02** Scope cannot cross a business. Composite FKs `prompt_line_same_business`
  and `scan_run_line_same_business` reject a line of business B on A's prompt or run. **Add to the
  trigger:** `inherit_line_scope` also checks, for `finding`, `new.business_id = run.business_id`,
  and for `sample`, that the prompt's `business_id` equals the run's. Today (0001) nothing ties
  `finding.business_id` to its run's business, and the trigger now copies the run's line onto the
  finding: a finding of A pointing at B's line run would carry B's line id into A's member view and
  into `getProductLine` on A's finding page.
  *Proof:* PgDb tests: line of B on A's prompt → FK error; A's finding on B's line run → trigger
  error; A's sample on B's prompt → trigger error; a business sample in a business run keeps nulls
  (BE-02's list). *Sev:* P1 (writers are the service role; no client path writes these).
- [ ] **S-04 · BE-02** `inherit_line_scope` does not need `security definer`: every writer of
  `sample` and `finding` is the service role / table owner, which already reads `scan_run` and
  `prompt`. Make it `security invoker` (the default). If the build keeps `definer`, then: owner is
  the migration role, `set search_path = ''`, every name schema-qualified (as written),
  `revoke execute … from public, anon, authenticated` (as written), and the PR says why definer is
  needed. `refuse_update` stays invoker.
  *Proof:* `\df+ public.inherit_line_scope` read-back (security, owner, config); grep of 0020.
  *Sev:* P2 (a trigger function cannot be called through PostgREST RPC; this is least privilege).
- [ ] **S-05 · BE-02** Immutability and versions: `product_line_facts_immutable` raises on update
  for every role, including the owner role; `Db` has no update or delete method for versions;
  `product_line` row and version 1 are written in **one** transaction (a row without a version breaks
  "every line has one" and every reader that dereferences `current`).
  *Proof:* RLS script (owner-role update raises); PgDb test that a failure between the two inserts
  leaves no row. *Sev:* P2.
- [ ] **S-06 · BE-01 / BE-02** Every business reader defaults to `product_line_id is null`, and the
  isolation test covers at least: `listPrompts`, `listScanRuns`, `lastScanRunStartedAt`,
  `listFindings`, `deleteScanRun`'s move target, `listReportArchive`, `runSummaries`, `dashboardRows`,
  `openFixesByFinding`, `buildReport(businessRun)`, **and the source of competitor names**
  (`competitorsInUse`'s "previous online scan", `prompts/profile.ts`) and the reporter's `lastRun`
  (`reporter/index.ts`). A line run's "Wie AI wel noemt" names (AI-chosen text, T3) must never become
  competitor slots in the business's questions.
  *Proof:* isolation test green on MemDb and PgDb, red when any one filter is removed (shown for at
  least two readers); a test that a business full scan after a line run with `others` asks no
  question naming them. *Sev:* P1.
- [ ] **S-07 · BE-02** The backstop CHECK also bounds what it does not today: the outlet `url`
  scheme (`$.outlets[*].url ? (@ != null && !(@ like_regex "^https?://"))` must not exist), and the
  total size (`pg_column_size(data) <= 32768` or per-string lengths). The CHECK is the only wall if a
  later path (import, script, D3 tooling) writes without `parseProductLine`.
  *Proof:* PgDb test: a version with `javascript:alert(1)` as outlet url and one of 1 MB are rejected;
  1,000 `parseProductLine` outputs insert without error. *Sev:* P2.

## B. Server actions: who may write, and how much (FE-02, BE-01)

- [ ] **S-08 · FE-02** Both actions start with `requireOwnerOf(businessFromForm(form))`
  (membership of the **form's** business, `listMyBusinesses`, never the active-business cookie), then
  `productLineAccess(business, session.userId)`. No field other than `business` chooses the business;
  the hidden `line` id is resolved **inside** `saveProductLine` / `setProductLineStatus` under the lock
  against that business (`not_found` otherwise).
  *Proof:* action tests (FE-02 list): signed out → `/inloggen`, nothing written; member of B posting
  `business=A` → redirect `/app`, A's lines and versions re-read unchanged; member of A posting
  `business=A&line=<B's line id>` → `not_found`, B's line re-read unchanged, no version added
  anywhere; same for `setProductLineStatus`. *Sev:* P0 if another business's line can be written or
  its status flipped; else P1.
- [ ] **S-09 · FE-02** Access refusal is enforced on the server for every write, not only by hiding
  the form: not verified, `plan: "setup"`, not paying, paused → `fout=toegang:<reason>`, nothing
  written, `product_line.refused`. Reactivation (`discontinued → active`) goes through the same
  access check and the same limit.
  *Proof:* crafted POSTs (JS off, form absent) per refusal. *Sev:* P1 (each active line is ~€5–8
  of AI spend a month; P0 only if an unpaid business gets lines **scanned**, see S-20).
- [ ] **S-10 · BE-01 / BE-02** The active-line limit holds under concurrency: count and write happen
  after the advisory lock is held; on PgDb `withLock` holds the lock in its own transaction while
  `fn`'s queries run on other connections (`pg.ts` comment), so `fn` must read the count **after**
  acquiring and commit its writes **before** returning.
  *Proof:* 20 parallel `saveProductLine` (new) and 20 parallel reactivations at `lines: 2` on PgDb →
  exactly the allowed number `ok`; the same test with the lock removed oversells (shown red). *Sev:* P1.
- [ ] **S-11 · BE-01** `parseProductLine` is the authority for limits that cost money:
  `marketsPerLine`, `useCases`, `specs`, `certificates`, `outletsPerMarket`, `replaces`; extra indexed
  groups past the limit are refused (`too_many`), not truncated silently; `formInput` stops reading at
  a fixed maximum index (e.g. 100) so a POST with 100,000 `spec.{i}` fields is not iterated.
  *Proof:* unit tests at limit and limit + 1 per field; a 5,000-group POST returns in < 50 ms with
  `too_many`. *Sev:* P2.
- [ ] **S-12 · FE-02** Cross-origin POSTs to the actions are refused (Next's Origin/Host check), and
  `serverActions.allowedOrigins`, if set, is an exact host list with no wildcard — the facts hosts
  `{slug}-feiten.vidalo.ai` are same-site with the owner area (standing rule, 20 Nov 2026).
  *Proof:* `curl` POST with the action id and `Origin: https://x-feiten.vidalo.ai` and
  `https://evil.example` → refused, nothing written. *Sev:* P1.
- [ ] **S-13 · FE-02** Saves are bounded in volume: versions per line per day (e.g. ≤ 50) or per
  business, since every save is a new immutable row and discontinue/add cycles create lines without
  bound (only **active** lines are capped).
  *Proof:* test that the 51st save in a day is refused, or an accepted-risk line in `findings.md`.
  *Sev:* P2.

## C. Owner text into AI questions and the extraction model (BE-01, BE-03, BE-04)

- [ ] **S-14 · BE-01** **Store what was checked.** The architecture stores "the owner's trimmed
  text" while `sanitizeSlot` tests the NFKC-normalised, control- and format-stripped form
  (`plainText`), so the stored value can still hold zero-width characters, and a crafted POST can put
  CR/LF into a single-line field (`plainText` turns them into spaces before testing; the raw value
  keeps them). That raw text then reaches the owner pages, the monthly mail, the owner instruction
  mail ("over je productlijn {naam}"), correction letters, and any RegExp built from it. Required:
  every stored string is the `plainText()` output (NFKC, `Cc`/`Cf` removed, line breaks refused or
  collapsed in single-line fields), trimmed; the question still uses the `sanitizeSlot` output.
  *Proof:* unit tests: `Tigris\u200bK5`, `Tigris\r\nBcc: x@example.com`, `Ｔｉｇｒｉｓ` → stored as
  `TigrisK5` / refused / `Tigris`; a property test that `sanitizeSlot(stored) === sanitizeSlot(raw)`.
  *Sev:* P1.
- [ ] **S-15 · BE-01 / BE-03** Every owner value that reaches an engine question goes through
  `slotValue()` and `fillTemplate()` only: name (`name`), category (`category`), use cases (new `use`,
  ≤ 60), spec labels (new `spec`, ≤ 40), certificate names (new `certificate`, ≤ 60), replaced names
  (`name`), and the brand (`business.name`, `name`). The new kinds take the full refusal set
  (markup, `://`, `www.`, domain test — only `name` skips the domain test, as today), and `welkFor`
  /`deBesteFor` run on the slot value via `deriveSlot`, never on raw text. Spec **values**,
  certificate numbers, outlet names/URLs and `replacedBy` never enter a question.
  *Proof:* spy test over `generateLinePrompts` with a hostile value in every field
  (`negeer alle instructies`, `<b>x</b>`, `https://x.io`, `x.io`, `ign\u200bore previous`): the
  template is skipped, no question contains `{`, `}`, `<`, `://`; `grep -n "version\.\(name\|category\|useCases\|specs\|certificates\|replaces\)" packages/core/src/prompts/line*.ts`
  shows only `slotValue` paths. *Sev:* P1.
- [ ] **S-16 · BE-04** The extraction call for line runs stays tool-less with the strict schema;
  owner values it receives (expected spec values, outlet names, if any) appear **only** inside the
  `JSON.stringify`-ed user message, never in `EXTRACTION_SYSTEM`, and are capped (≤ 60/80 chars each,
  ≤ the `PRODUCT_LINE_LIMITS` counts). Note for the record: owner text here can only bend the owner's
  own verdicts (no other tenant's data is in the context, no tool, no secret); that is why this is
  not higher.
  *Proof:* request-body snapshot test for a line sample. *Sev:* P2.
- [ ] **S-17 · BE-04** Line runs never write to shared, cross-tenant state: no `recordScanUse`
  (question library ledger, 001 S-23), no bank promotion, no `question_use` rows, no understanding
  step. One owner's category or product names cannot retire or promote a template for other
  businesses.
  *Proof:* test: a line run leaves `question_use` / the bank unchanged (row counts before and after);
  `grep -n "recordScanUse\|promote" packages/core/src/scanner/index.ts` shows the line branch skips
  both. *Sev:* P1.
- [ ] **S-18 · BE-04** Regexes on line data and answers: any `RegExp` built from a spec label,
  outlet name, certificate name, product name or replaced name escapes every metacharacter (outlet
  names and spec values are only "plain text" — `(a+)+$` fits in 60 chars); prefer `includes` on
  normalised text. Every new regex on answer text (spec value after the label, `yesNo`, outlet list
  items, bold names, cited hosts, the successor match) has a length cap before matching and a timing
  test (standing rule, 11 Nov 2026).
  *Proof:* tests with label `(a+)+$`, outlet `Shop [1]+*`, name `.*` → no throw, no false match, and
  a 100 KB hostile answer per extractor → < 100 ms. The PR lists each site with cap and test.
  *Sev:* P1 per uncapped site.

## D. "Where to buy" URLs (BE-01, FE-02, FE-03, BE-05, BE-06)

- [ ] **S-19 · BE-01 / FE-02 / FE-03** Outlet URLs: parsed with `new URL()`, scheme `http:`/`https:`
  only, ≤ 300 chars, **no credentials** (`user:pw@` refused), stored as `url.href`. Rendered as a link
  only after the same scheme check **at render time** (not trusting stored data), as React `href`
  (never `dangerouslySetInnerHTML`), with `rel="noopener noreferrer nofollow ugc"`; the link text is
  the outlet name or the host, as text. Today only the owner sees them; with D3 (colleagues) a bad
  URL is stored XSS between members, so the render check is required now.
  *Proof:* `parseProductLine` refuses `javascript:alert(1)`, `JaVaScRiPt:…`, ` javascript:…`,
  `data:text/html,…`, `https://u:p@x.example`, `//x.example`; a page test with a seeded version whose
  url is `javascript:alert(1)` (written directly to MemDb) renders no anchor. *Sev:* P1.
- [ ] **S-19b · BE-04 / BE-05** No server-side fetch of an owner-entered outlet URL. Judging
  compares names and hosts only. If any step does fetch one (e.g. to verify an outlet), it goes
  through the S7 SSRF guard (scheme, no private/loopback/link-local IPs, `redirect: "manual"` with the
  check per hop, timeout, size cap).
  *Proof:* `grep -rn "outlets" packages/core/src/scanner packages/core/src/fixer packages/core/src/publisher`
  shows no fetch; or the guard tests from 001 S-11 run on this call site. *Sev:* P1 if fetched unguarded.
- [ ] **S-21 · BE-05 / BE-06** Outlet URLs and owner-entered free text do not become links in our
  mails. `textToHtml`'s `linkify` turns every `https?://…` in an owner mail into an anchor, and
  outlet names, spec values and `replacedBy` are only "plain text" (no `://` refusal): refuse `://`,
  `www.` and `<`, `>` in those fields too (same rule as slots, without the instruction words), or
  render them through a path that does not linkify. Correction letters to third parties (text only,
  sent in the owner's name from our domain) carry the line's name and the owner's values but no URL
  the owner typed.
  *Proof:* mail-lab fixture with outlet name `https://phish.example/login` and spec value
  `zie www.x.example`: refused at the form, or the HTML shows no anchor for them; a
  `correctionRequestEmail` test for an `outlet` finding whose text contains no owner URL. *Sev:* P2.

## E. Worker gating and cost (BE-05)

- [ ] **S-20 · BE-05** A line scan or line recheck runs only for a business that is paying
  (`trial`/`active`), not paused, verified, on `plan = "monitor"`, checked **at run time** in
  `paidOnlyBlock` (not only at enqueue: an owner may stop paying between the cron and the job), then
  `lineScanRefusal`: the line exists, `line.businessId === job.businessId`, active (except recheck),
  and `market` is in the **current** version's markets. A refused job calls no engine.
  *Proof:* gate tests (BE-05 list) with an engine spy at zero calls per refusal, including a payload
  whose `productLineId` belongs to another business. *Sev:* P0 if an unpaid or other business's line
  can be scanned at our cost on a path a client influences; else P1.
- [ ] **S-22 · BE-05** No web path starts a line scan. "Controleer nu" (`apps/web/app/app/actions.ts`)
  keeps enqueuing a business scan with no `productLineId`/`market`, and nothing reads those fields
  from a form or query.
  *Proof:* `grep -rn "productLineId" apps/web/app` shows only reads; action test asserts the enqueued
  payload. *Sev:* P1.
- [ ] **S-23 · BE-05** The cron clamps to today's limits at enqueue time: `scannableLineMarkets`
  takes at most `PRODUCT_LINE_LIMITS.lines` active lines (oldest first) and `marketsPerLine` markets
  per line, so lowering a limit (D2) stops the spend at once instead of on the owner's next edit
  (the backstop CHECK allows 10 markets). Enqueue is idempotent per (line, market, month): a second
  cron pass or a retried cron does not enqueue twice.
  *Proof:* cron test with a version holding 5 markets and 4 active lines at limits 2 × 2 → 4 jobs;
  cron run twice in one month → still 4. *Sev:* P2.
- [ ] **S-24 · BE-05** The daily AI ceiling counts line runs in flight. `paidScanCentsSince` sums
  `cost_cents` of every non-free run started today, finished or not; a run still sampling reports
  little, and line jobs arrive in bursts (business slot + 2 min × i). Count running paid runs at an
  estimate (`greatest(cost_cents, estimate)` as `freeScanCentsSince` does) — standing rule 004,
  14 Nov 2026. Note: a `monthly` job deferred once runs the next day whatever the ceiling
  (`DEFER_ONCE`); lines multiply that ×(lines × markets).
  *Proof:* test: 4 line runs `running` with `cost_cents = 0` and the ceiling at 3 × estimate → the
  5th scan job is deferred. *Sev:* P1.
- [ ] **S-25 · BE-05 / FE-04** "Ik heb dit aangepast" on a line finding cannot be pressed into
  unbounded rechecks. `markFixedByOwner` enqueues a recheck per press with no claim; each recheck is a
  line run on paid engines, and discontinued lines keep rechecks. Claim atomically (conditional update
  of `fix.recheck_at` / `ownerMarkedFixedAt` within a window, e.g. once per fix per 24 h) before
  enqueuing (standing rule, 11 Nov 2026).
  *Proof:* 20 parallel presses on one line finding → one recheck job, one line run. *Sev:* P1
  (pre-existing on business findings; lines add findings and markets to press).
- [ ] **S-26 · BE-05** The report job's wait is bounded by the server: `waited` is incremented by
  the handler, `LINE_REPORT_MAX_WAITS` (8) is a constant, and the `lines` list comes from
  `scannableLineMarkets` at the business scan, never widened later. One monthly mail per business per
  month even when line runs fail.
  *Proof:* report tests (BE-05 list) plus a payload with `waited: -100` → treated as ≥ 0 and sent
  within 8 waits. *Sev:* P2.

## F. Owner pages and public pages (FE-01..FE-04)

- [ ] **S-27 · FE-01 / FE-03 / FE-04** Reads through the service handle are scoped to the active
  business after `requireOwner`: `listProductLines(business.id)`; `loadProductLineDetail` returns
  null when `line.businessId !== business.id` (→ `notFound()`); `?markt=` is accepted only when it is
  one of the line's markets (else the default), and every scoped read passes both `business.id` and
  the line; `loadFinding` keeps its business check and derives the line from the finding, then checks
  the line's `businessId` as well.
  *Proof:* page tests: B's line id on A's session → 404, no B data in the HTML; `?markt=ZZ` and
  `?markt=<script>` → default market, no echo. *Sev:* P0 if another business's line, findings or
  samples render; else P1.
- [ ] **S-28 · FE-01 / FE-02 / FE-04** Query values are never echoed: `?fout=<field>[.<index>]:<reason>`
  maps through an allow-list of known `ProductLineField` × reason pairs (and `toegang:<LineAccessRefusal>`,
  `limiet`) to copy; anything else renders nothing. `?betwist=<findingId>` only switches the fixed
  sentence on; if the id is used to read anything, it is a finding of this business and this line.
  *Proof:* `?fout=<img src=x onerror=alert(1)>:x`, `?fout=name.999999999:refused`,
  `?betwist=<B's finding id>` → no markup, no B data. *Sev:* P1.
- [ ] **S-29 · FE-01 / FE-02 / FE-03** Owner text and AI text (line name, category, spec
  label/value, certificate, outlet names, AI-named outlets and products, "Wie AI wel noemt" names)
  render as React text only; no new `dangerouslySetInnerHTML` or `innerHTML`.
  *Proof:* `grep -rnE "dangerouslySetInnerHTML|innerHTML" apps/web/app apps/web/components apps/web/lib`
  shows only the existing hits; a mock page test with `<img src=x onerror=alert(1)>` as an AI-named
  outlet shows the literal text and no `img`. *Sev:* P1 (owner-only pages; P0 if script runs on a
  page reachable by someone else).
- [ ] **S-30 · FE-04** A line run is not reachable on any public surface: `/r/[id]` → `notFound()`
  when the run has a `productLineId`; `/api/report-email` refuses a line run's `scan` id (no event, no
  mail); line runs never create a waiting-room token, so `/api/scan/[token]/status` cannot return
  line questions; the facts page, `llms.txt` and JSON-LD never include line data (`insertFacts`
  strips `productLine`, `lineFacts` is never persisted).
  *Proof:* route tests for the first three with a seeded line run id; publisher test with a business
  that has lines → facts page bytes unchanged. *Sev:* P1.

## G. Mails (BE-05, BE-06)

- [ ] **S-31 · BE-06** Every interpolation in the line section of the monthly mail (line name,
  market name, finding cards' `wrongValue`/`correctValue`, `others`) goes through the template's
  `esc()`; `detailUrl` is built from the dashboard origin and the line's uuid only. The subject stays
  the business's (no owner line text in a header).
  *Proof:* mail-lab fixture with a line name holding `&`, `"` and (if S-14 lets it through at all)
  `<`, and an AI-named outlet `<script>x</script>` → escaped; template test that the subject is
  unchanged. *Sev:* P1.
- [ ] **S-32 · BE-05** Owner instruction and correction mails that name the line take the
  stored (S-14-normalised) name; no line text enters `subject` without CR/LF removal; recipients of
  correction letters stay exactly today's rule (known directory contact, else operator), never a host
  taken from an owner-entered outlet URL.
  *Proof:* `thirdPartyAddress` test for an `outlet` finding whose source host equals an owner outlet
  host → operator, not `info@<host>` outside mock. *Sev:* P2.

## H. Secrets, bundle, mock, hygiene

- [ ] **S-33 · FE-02** `LineForm.tsx` (client) imports `parseProductLine` and `PRODUCT_LINE_LIMITS`
  from a module that pulls in no server code: no `db`, no OpenAI client, no `process.env` read beyond
  `NEXT_PUBLIC_*`.
  *Proof:* build as CI ships it (`DATABASE_URL=` empty), grep `.next/static` and `.open-next/assets`
  for `sk-`, `OPENAI_API_KEY`, `service_role`, `DATABASE_URL`, `postgres://` → no hits; control: a
  planted string is found. *Sev:* P0 if a key is found; else P1.
- [ ] **S-34 · BE-01** `seedDemoLines` runs only in mock mode (`env.mock`, as `seedDemo` in
  `lib/core.ts`), never on "MemDb because `DATABASE_URL` is missing" (the Workers/Hyperdrive case in
  CLAUDE.md). The mock engine answers for line prompts are reachable only through the mock engine.
  *Proof:* test with `VIDALO_MOCK` unset and no `DATABASE_URL` → no lines seeded. *Sev:* P1.
- [ ] **S-35 · all** Events and logs carry no names, outlet URLs or free text: `product_line.confirmed`,
  `.status`, `.refused`, `report.waiting`, `scan.*` with line fields have exactly the architecture's
  key sets.
  *Proof:* key-set assertions in the action and worker tests. *Sev:* P2.
- [ ] **S-36 · all** No literal control, bidi or zero-width character in any new source, copy,
  fixture, migration or doc (fixtures for S-14/S-15 use `\u` escapes).
  *Proof:* the standing `grep -rP` over the diff. *Sev:* P2.
- [ ] **S-37 · all** The money path is untouched: no change under `billing`, checkout, the Stripe
  webhook; `productLineAccess` reads `plan`/`status` written only by the webhook; nothing a client
  sends raises a plan, a limit or a scan's size.
  *Proof:* `git diff --stat main…` for those paths. *Sev:* P0 if a client-written value grants a
  scan or a plan; else P1.

## Standing items that do not apply here, and why

- Webhook signature scope, amounts in minor units, rates snapshotted: no payment, price or rate in
  this feature (D1 open); S-37 proves the path is untouched.
- Capacity under lock is the line limit (S-10), not money.
- New unauthenticated endpoints counted against the pool: none added; S-30 keeps the existing ones
  from serving line runs.
- Static sites, DNS, vendored JS: none added.
- Membership instead of ownership: data access is by membership (S-01, S-08); **spending** rights
  are `productLineAccess` → `isVerifiedOwner` (owner id). Equal today (`business_member.role` allows
  only `owner`, one per business); when D3 admits colleagues, that function must read the role from
  `business_member`, and S-01/S-08/S-19 become the multi-member tests.

## P0 in the design as written

None. No designed path reaches another business's data or money: the actions take the business
from membership and resolve the line inside the locked `Db` method against that business; the new
tables grant only SELECT through membership policies; the composite FKs and the trigger keep line
rows inside their business; line runs are internal and refused on `/r/[id]`; owner text reaches
the engines only through the slot sanitiser, and the models that read it have no secrets and no
other tenant's data.

Changes the architecture should take before build (none blocks, each is cheap):
1. "Stored values are the owner's trimmed text" → store the `plainText()`-normalised text (S-14).
2. `inherit_line_scope`: also assert the row's business equals the run's (S-03); drop
   `security definer` unless a reason is written down (S-04).
3. Outlet names, spec values and `replacedBy`: refuse `://`, `www.`, `<`, `>` (S-21); outlet URL:
   no credentials, scheme checked again at render (S-19); add the url scheme to the CHECK (S-07).
4. Worker: clamp lines × markets to `PRODUCT_LINE_LIMITS` at enqueue (S-23); count running paid
   runs at an estimate in the daily ceiling (S-24); one recheck per fix per window (S-25).
