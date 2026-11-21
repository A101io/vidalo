# 006 Productlijnen: security verify (phase 4)

*security · 21 Nov 2026 · against `git diff origin/main...HEAD` (8fdd35e) plus the uncommitted tree on
`claude/005-productlijnen`. Checked against my phase-1 list `checklists/security.md` (S-01..S-37, S-19b), then
beyond it. Severity per `_OS/playbook/templates/pipeline/SEVERITY.md`. Nothing was changed or committed. Nothing ran
against the hosted Supabase project.*

**Runs used as evidence.** `PG_ADMIN_URL=postgresql://a101@localhost:5432/postgres DATABASE_URL= pnpm verify:pg`:
exit 0, 171 db tests on PgDb, `rls/product-lines: RLS-OK login1[product_line=2 product_line_facts=2 others_versions=0
line_runs=1 prompt=0] login2[product_line=1 product_line_facts=1 others_versions=0 line_runs=1 prompt=0]
anon[product_line=0 product_line_facts=0]`, control `broken=1` gives `RLS-FAIL`; e2e-mock on PgDb OK. `pnpm -r typecheck`
green. Core 1,645 passed / 30 skipped, worker 67 passed (`DATABASE_URL=`). `next build --webpack` with `DATABASE_URL=`
empty, then a grep of `.next/static`. Crafted server-action POSTs against the mock dev server on :3100. Two
proof-of-concept scripts (MemDb, run from the scratchpad, nothing in the repo): the cron poc and the parse timing.

## Verdict

**One P0, SEC-V01. It blocks the gate.** It is a live path on main (it does not need this feature), and this branch
rewrites the function it lives in, multiplies what it costs (each repeat now also enqueues every line-market job), and
adds two new event sources the owner can write without limit. The foreseeability cap does not apply to a live exploit.
The fix is 2–3 h in `enqueueMonthlyScans`, and it should also ship to main on its own, without waiting for 006.

## Findings

| ID | Sev | Claim | Evidence | Proposed fix | Cost |
|---|---|---|---|---|---|
| SEC-V01 | **P0** | The monthly cron's "once per month" check reads only the newest **500 events** of the business. An owner can fill that window, so every 10-minute cron tick on the anniversary day enqueues the full monthly scan again (and, on this branch, every line-market job again). The daily AI ceiling does not stop it: a deferred `monthly` job runs the next day whatever the ceiling (`DEFER_ONCE`). | `apps/worker/src/cron.ts` `events()` → `listEvents(businessId, 500)`, then `lastEvent(evs, scan.enqueued … sameAmsterdamMonth)` (same on `origin/main` lines 79–81). `pg.ts:785` `order by at desc limit 500`. `jobs/spend.ts:42` `if (… DEFER_ONCE … && payload.deferredOnce) return null`. Event writers the owner controls, no limit: `saveMailPrefs` (`account.mail_prefs_set`, on main), and on this branch `product_line.confirmed` (each save; S-13 not built) and `product_line.refused` (each "add" pressed at the limit). **PoC** (6 cron passes, 500 unchanged line saves between passes): **6 business monthly jobs + 24 line jobs**, against 1 + 4 when the owner does nothing. **Exploit path:** (1) a verified owner on Vidalo Monthly (proof of Google Business Profile + a paid subscription); (2) on their anniversary day, a script posts 500 saves (mail preferences on main; on this branch, one product line saved unchanged) every 10 minutes; (3) the `*/10` cron (`cronTick` → `enqueueMonthlyScans`) no longer sees this month's `scan.enqueued` and enqueues the full scan again, plus 4 line jobs; (4) once the €30 daily cap is spent, each job is deferred once and runs the next day without a cap. Up to 144 full scans (€11–22 each, `docs/cost-per-client.md`) + 576 line runs (estimate €2.50) ≈ **€2,000–4,500 per anniversary day**. Every other customer's paid check that day is pushed to the next day, and each extra business scan queues another monthly report job. **No attacker is needed either** (plausible, not measured): a scan in an engine outage logs one `scan.sample_failed` per failed sample (340 per engine per full scan), which can push the business's own `scan.enqueued` out of the window, so it loops by itself. | Decide "already enqueued this month" with a keyed query, never a window: a unique dedupe key on the job (`scan:monthly:<business>:<yyyy-mm>` and `…:<line>:<market>`), inserted with `on conflict do nothing`, or a Db method `hasEventSince(businessId, type, since, payloadMatch)` with an index on `(business_id, type, at)`. In the same query, cap line-market jobs per business per month at `lines × marketsPerLine` (this closes SEC-V02 too). Test: 600 unrelated events between two cron passes still give one business job and four line jobs; the same test with the old window lookup goes red. Ship the business half to main as a hotfix. | 2–3 h |
| SEC-V02 | P1 | The active-line limit caps lines that are **active now**, not runs per month. An owner who discontinues their lines and adds new ones between cron ticks gets new line-market jobs each tick. | PoC scenario B (6 passes, discontinue both lines and add two new ones between passes): **24 line jobs** instead of 4. `cron.ts` idempotency is per `(productLineId, market)`, and a new line has a new id. Jobs run 2 min after enqueue, before the owner discontinues. Bounded per day only by the ceiling, and by `DEFER_ONCE` not even that (see V01). Capped at P1: S-13 (unlimited saves and lines, "only active lines are capped") and S-23 named this in phase 1, and the switch `VIDALO_PRODUCT_LINES` is off in production. **Must be fixed before the switch is turned on.** | The per-business monthly budget from V01: count `scan.enqueued` (or job keys) with a `productLineId` for this business this month, and enqueue only while the count is below `PRODUCT_LINE_LIMITS.lines × marketsPerLine`. Also build S-13 (≤ 50 saves per line per day). | in V01; S-13 +30 min |
| SEC-V03 | P2 | `parseProductLine` removes duplicates from the use-case and "replaces" textareas in O(n²), **before** it cuts them to `MAX_ROWS`. One owner POST takes minutes of CPU. | `shared/product-lines.ts:143-151` `lines()` (`out.some(...)` per line), called before `.slice(0, MAX_ROWS)` at 190 and 262. Measured: 10,000 lines 0.6 s; 40,000 lines (194 KB) 16.4 s; **130,000 lines (715 KB, fits the 1 MB action body) 174 s**. On Workers the CPU limit kills the request, but that isolate stops serving other requests until then. S-11 asked for < 50 ms. Only an owner who passes the access gate can reach it (the gate runs before parsing, `lib/product-lines.ts` `gate`). | In `lines()`, stop after `MAX_ROWS + 1` kept lines and cap the raw field (e.g. `String(raw).slice(0, 5000)`), or remove duplicates with a `Set` of lowercase values. Add a test that a 700 KB textarea returns `too_many` in < 50 ms. | 15 min |
| SEC-V04 | P2 | A literal U+202E (right-to-left override) byte is in a committed test fixture. | `packages/core/test/product-lines.test.ts:148` (`"Tigris ‮K5"` written as the raw byte), found by the standing `grep -rP` over the diff. No CI step runs that grep (`.github/` has none). S-36. | Write it as `"Tigris ‮K5"` (escape). Optionally add the grep to CI. | 5 min |
| SEC-V05 | P3 | `/api/report-email` does not refuse a line run's id (S-30 asked for that). | `apps/web/app/api/report-email/route.ts:46-60` checks only that the run belongs to the business. It is not reachable in practice: line runs exist only for paying businesses, which have `ownerEmail` (that branch sends nothing), and a line run's id is never shown on a public page (`/r/[id]` returns 404 for it). | `if (run?.productLineId) return NextResponse.redirect(back, 303);` | 5 min |
| SEC-V06 | P3 | `seedDemoLines` runs when `env.mock` is true, and `env.mock` is also true when only `DATABASE_URL` is missing (S-34 asked for `VIDALO_MOCK` only). | `lib/core.ts:51` (seedDemo → seedDemoLines), `lib/env.ts:10`. This was already the case for `seedDemo`; the seed only goes into a `MemDb`, `productLinesEnabled` needs `VIDALO_MOCK=1` or the switch, and `worker.ts` sets `DATABASE_URL` from Hyperdrive. | Leave it with `seedDemo`. If either is changed, gate both on `VIDALO_MOCK === "1"`. | — |

Not security, passed on to QA/frontend: `loadProductLineDetail` (`apps/web/lib/product-lines.ts`) calls
`openFixesByFinding(db, business.id)` with no line, and that function defaults to business findings only. So the detail
page's `fixes` map never holds a line finding's fix, and "wat we doen" stays empty per line error. It should pass
`{ productLineId: line.id }`.

## Checklist, item by item

| Item | Result | Evidence |
|---|---|---|
| S-01 RLS by membership, select only | pass | 0020 §5: both policies join `business_member` on `auth.uid()`; `revoke all … grant select … to authenticated`. `rls/product-lines.sql`: login1 2/2, login2 1/1, anon 0; the join path (`others_versions=0`); insert, update and delete as `authenticated` are denied on both tables, including the owner's own row; `has_table_privilege` loop. `broken=1` → RLS-FAIL. |
| S-02 shared tables unchanged, no write via new columns | pass (local) | Same script: login 2 `update finding … product_line_id`, `update scan_run …` on A's rows → 0 rows, re-read unchanged; `prompt=0` for both logins; `line_runs=1` each (own only). The anon `curl` on the hosted project and `get_advisors` wait for D4. |
| S-03 scope cannot cross a business | pass | Composite FKs `prompt_line_same_business`, `scan_run_line_same_business`, `scan_run_line_version`. `inherit_line_scope` asserts `finding.business_id = run.business_id` and the sample's prompt is the same business, line and market. PgDb tests "a finding of one business cannot point at another business's run (S-03)" and "prompt/run/sample scope". |
| S-04 trigger function privilege | pass | 0020 has no `security definer`; `set search_path = ''`, qualified names, `revoke execute … from public, anon, authenticated`; the RLS script asserts no EXECUTE for the Data API roles. |
| S-05 versions immutable, row + v1 in one transaction | pass | `refuse_update` trigger; the RLS script's owner-role update raises "never changed". `pg.ts saveProductLine`: count, insert line and insert version inside one `sql.begin`; PgDb test "a version that fails leaves no line". |
| S-06 business readers default to null line | pass | `lineClause` (`pg.ts`), the same in MemDb and `owner-area.ts`. `product-lines-isolation.test.ts` covers dashboardRows, listReportArchive, runSummaries, openFixesByFinding, buildReport, listPrompts, listScanRuns, lastScanRunStartedAt, listFindings and deleteScanRun's move target, on MemDb and PgDb. Competitor slots: `competitorsInUse`'s `previous` is not filled anywhere in the code, so no run's names can become slots. Reporter `lastRun` uses `listScanRuns(id, 20)` = business only. Red-without-filter was not shown. |
| S-07 backstop CHECK | pass | 0020: url `^https?://` (case-insensitive), `octet_length(data::text) <= 32768`, market codes, array bounds. PgDb test refuses `javascript:` and a huge version. |
| S-08 actions: business from the form, line under the lock | pass | `actions.ts` → `requireOwnerOf(businessFromForm(form))`; `pg.ts` `select … where id = $line and business_id = $business for update` → `not_found`. Tests: "a crafted line id of another business writes nothing" (web), "not_found for another business's id, in save and in status" (MemDb + PgDb). |
| S-09 access on the server for every write | pass | `gate()` runs before `formInput`/parse in both writes. Tests: "refuses a user who is not the verified owner", "refuses plan setup, an unpaid and a paused business, and the switch being off". Reactivation goes through `setProductLineStatus` with `maxActive`. |
| S-10 limit under concurrency | pass | Count and write after `pg_try_advisory_xact_lock`, committed inside `fn`. Tests "two parallel saves at the limit" and "parallel reactivations" on PgDb in verify:pg. The test with the lock removed (red) was not shown. |
| S-11 parse limits, bounded iteration | **partial** | `GROUP_CAP = 101`, `MAX_ROWS = 100`, `too_many` beyond the limits: pass. The textareas are quadratic before the cut: **SEC-V03**. |
| S-12 cross-origin action POST refused | pass | No `allowedOrigins` set (Next checks Origin = Host). Probe on :3100: `Origin: https://evil.example` and `https://x-feiten.vidalo.ai` → 500 "Invalid Server Actions request"; same origin → 400 "Invalid Server Action request" (action lookup, so the origin check passed). |
| S-13 saves bounded per day | **fail** | Not built (`04-build.md` deviation 6). It feeds SEC-V01 (event flood) and SEC-V02 (cycling). |
| S-14 store what was checked | pass | `plain()` (NFKC, Cc/Cf and zero-width out, line breaks → space, bidi → refused) is what is stored; test "stores the normalised text, never the raw one (S-14)". |
| S-15 owner text into questions via slots only | pass | `prompts/line.ts` uses only `slotValue` for name, brand, category, use, spec label, certificate and old name; the grep shows no raw field in a template. Tests "a hostile value in any field never reaches a question" and "spec values … never enter a question". |
| S-16 extraction call | pass | `extract.ts`: `productlijn {naam ≤80, merk ≤80, categorie ≤60, markt}` only inside the `JSON.stringify`-ed user message; no owner values and no outlets; one fixed sentence added to `EXTRACTION_SYSTEM`; still tool-less with the strict schema. There is no request-body snapshot test (P3). |
| S-17 no shared-state writes from line runs | pass | `scanner/index.ts`: `recordScanUse` and the bank promotion are skipped when `lineRun`; no understand step. Test "never writes to the shared question library (S-17)". |
| S-18 regexes | pass | Every line extractor slices to `MATCH_LIMIT` / `LINE_WINDOW`; owner text is matched with `indexOf`/`split`/`includes`, never `RegExp`; quantifiers are bounded. Test "hostile labels and outlet names do not throw … and a 100 KB answer is fast (S-18)". |
| S-19 outlet URLs | pass | `httpUrl()`: `new URL`, http(s), no credentials, ≤300, stored as `href`. Render: `safeHttpUrl()` checked again, React `href`, `rel="noopener noreferrer nofollow ugc"` (`[id]/page.tsx:309-316`). Tests S-19 (parse + render). |
| S-19b no fetch of outlet URLs | pass | `outlets` is only read in parse, prompts (presence), `lineFacts`, extract (host compare) and the mock engine; no `fetch(` added in the diff. |
| S-20 line scans gated at run time | pass | `jobs/paid.ts lineBlock`: `productLineAccess` then `lineScanRefusal` (exists, same business, active unless recheck, market in the current version); a recheck of a line finding is gated too; `runScan` refuses again (`line_not_scannable`). Worker tests "a line scan is gated when it runs (S-20)" with no engine call. |
| S-21 no links from owner free text in mails | pass | Outlet name, spec value, certificate number and replacedBy refuse `<`, `>`, `://`, `www.`; `linkify` needs `https?://`. Letters carry the line name, the owner's certificate number/date and the slot-checked old name; no URL the owner typed. |
| S-22 no web path starts a line scan | pass | `productLineId` in `apps/web/app` appears only in a redirect and a comparison; `checkNow` unchanged. |
| S-23 cron clamps, idempotent | **partial** | Clamp passes (`scannableLineMarkets`, test "4 active lines with 5 markets give 2 × 2"). Idempotency holds for a plain second pass, but not under an event flood (SEC-V01) or a discontinue/add cycle (SEC-V02). |
| S-24 ceiling counts line runs in flight | pass | `paidScanCentsSince`: `greatest(cost_cents, LINE_RUN_ESTIMATE_CENTS)` for running line runs; test "four running line runs at cost 0 … the fifth job is deferred". Note: `DEFER_ONCE` makes the ceiling a one-day delay, not a cap (V01). |
| S-25 one recheck per press window | pass | `markFixedByOwner`: a line finding is claimed under `withLock(recheck:<fix>)` once per 24 h; test "twenty presses on one line finding make one recheck". Business findings keep the old behaviour, which was already there before this feature. |
| S-26 report wait bounded | pass | `waited` clamped `0..8` by the handler; `lines` filtered to today's `scannableLineMarkets` and sliced to 40; tests incl. a bad `waited`. |
| S-27 owner reads scoped | pass | `loadProductLineDetail`: uuid check, `line.businessId !== business.id` → null → `notFound()`; `pickMarket` allow-list; `loadFinding` returns null when the line's business differs. Tests in `web-product-lines.test.ts`. |
| S-28 query values never echoed | pass | `parseFout` exact grammar + field/access allow-lists, `fieldErrorText` `Object.hasOwn`; message shown only when `access.ok`; `?betwist` only a boolean compared with `line.id`. |
| S-29 React text only | pass | `grep dangerouslySetInnerHTML\|innerHTML` in `apps/web/{app,components,lib}`: only the three existing hits (`feiten/*`, `seo.tsx`). |
| S-30 not on public surfaces | **partial** | `/r/[id]` → 404 for a line run before anything is built; `latestScanReport` reads only business runs; the facts page has no line code; `insertFacts` strips `productLine` (Pg + Mem). `/api/report-email`: SEC-V05 (P3). |
| S-31 monthly mail escaping | pass | Line blocks go through `layout.ts` (`esc` before `linkify`); the subject is unchanged; test "escapes the line's name and what AI named (S-31)". |
| S-32 owner/correction mails | pass | Line name only in the body (`O.forLine`), never in the subject. `thirdPartyAddress` unchanged (known directory contact, `info@host` only in mock). |
| S-33 no secret in the client bundle | pass | `next build --webpack`, `DATABASE_URL=` empty: no `sk-…`, `service_role`, `postgres://`, `sk_live/sk_test`, `whsec_` in `.next/static`. The `LineForm` chunk holds no OpenAI code. Pre-existing, unrelated: an orphan chunk `2308` holds the ChatGPT engine with the env var *name* `OPENAI_API_KEY` (no value); most likely pulled in through `FactsForm` → `@vidalo/core/prompts`. P3. |
| S-34 seed in mock only | partial | SEC-V06 (P3, pre-existing gate shared with `seedDemo`). |
| S-35 events without free text | pass | `product_line.confirmed {productLineId, version, markets (count), created}`, `.status`, `.refused {reason}`, `report.waiting {waited, missing}`, `scan.* + {productLineId, market}`. The existing `scan.sample_failed` carries the question text (now with the line name): an existing pattern, the business's own log. |
| S-36 no control/bidi bytes | **fail** | SEC-V04. |
| S-37 money path untouched | pass | No diff under `packages/core/src/billing`, `apps/web/app/api/checkout`, the Stripe webhook, `lib/stripe.ts`. `plan`/`status` are only read. |

## Standing list

I added two rules to `docs/process/checklists/security.md` (Learned, 21 Nov 2026, 006 verify) and to the playbook
template `_OS/playbook/templates/pipeline/checklists/security.md`, because they hold for every venture:
- A "once per period" check never reads a bounded window of a log that clients can write to.
- A cap on what is active now is not a cap on spend per period.

## Round 2 (21 Nov 2026, last verify round)

*Against the working tree on `claude/005-productlijnen` (no commits since 8fdd35e; everything is uncommitted, so the
diff is `git diff 8fdd35e` plus untracked files). Nothing changed, committed, or run against the hosted project;
`verify:pg` not run (another process may hold it). Evidence: round-1 PoCs re-run from the scratchpad on MemDb,
`DATABASE_URL= pnpm --filter @vidalo/worker test` 69 passed, core `product-lines` + `db-product-lines` 37 passed / 7 skipped.*

**Verdict: no open P0. SEC-V01 is closed on this branch.** The gate is not blocked by security.

| Id | Round 2 | Evidence |
|---|---|---|
| SEC-V01 (P0) | **closed** | `cron.ts` `enqueueMonthlyScans` reads `db.listEvents(b.id, 500, "scan.enqueued")`; `PgDb.listEvents` adds `and type = ${type}` before `limit` (`pg.ts:784-788`), `MemDb` filters before `slice` (`mem.ts:678`). Writers of `scan.enqueued` (grep over apps, packages, scripts): the cron (monthly, line, re-engagement) and `jobs/setup.ts` (baseline). No web route, server action or owner path writes it. At most 1 + 4 (+ setup baselines) per month, so 500 rows hold years. PoC `cycle.mts` scenario C (500 events between 6 passes): **1 business job + 4 line jobs** (round 1: 6 + 24). Test `apps/worker/test/lines.test.ts` "an owner flooding other events…" (600 `account.mail_prefs_set`). The self-loop (`scan.sample_failed` flood) is closed by the same filter. |
| SEC-V02 (P1) | **closed** | Per-business monthly `lineBudget = lines × marketsPerLine −` this month's `scan.enqueued` with a `productLineId`. PoC scenario B (discontinue both, add two new, between 6 passes): **4 line jobs** (round 1: 24). Test "lines discontinued and re-added… (SEC-V02)". |
| SEC-V03 (P2) | **closed** | `dedupe.mts`: 10k / 40k / 130k lines (715 KB) → 2 / 2 / 6 ms, `too_many` (round 1: 0.6 s / 16.4 s / 174 s). |
| SEC-V04 (P2) | **closed** | `product-lines.test.ts:157` now `"Tigris ‮K5"`; `grep -P` for U+200B–200F, 202A–202E, 2066–2069, FEFF over the diff and untracked files finds only the removed line and this report's quote of it. Still no CI step runs the grep. |
| SEC-V05 (P3) | **closed** | `api/report-email/route.ts`: `if (run.productLineId) return NextResponse.redirect(back, 303)` after the business-match check, before any event or job. |
| SEC-V07 (P2) | **closed** | `lib/product-lines.ts:100` `openFixesByFinding(db, business.id, { productLineId: line.id })`; the Pg query keeps `finding.business_id = ${businessId}` and adds the line scope, UUIDs checked first. No cross-tenant widening. |
| S-13 | **partial, P2** | An unchanged save writes nothing (`saveLineFromForm`: `sameData(now.current, parsed.data)` → redirect, no version, no event; the line is checked to be this business's first). Not built: the ≤ 50 saves per line per day. Alternating two values still adds a version and a `product_line.confirmed` per POST, and `product_line.refused` / `product_line.status` are unbounded. Since V01/V02 no event count reaches a spend decision, so the remaining effect is table growth at request rate: P2, not a gate item. |
| SEC-V06 (P3) | unchanged | As round 1, shared with `seedDemo`. |

**Regressions looked for in the fixes.** None found. Checked: `listEvents` with `type` keeps the business filter in
both Dbs; the line budget counts only this month's in-window line events, and the window can no longer be flooded;
`spendBlock` key now includes line and market (spreads deferred line jobs, changes nothing about the cap);
`paidOnlyBlock` → `lineBlock` re-checks plan, switch, line ownership, status and market at run time and fails closed;
report wait is bounded (`waited` clamped by the handler, `lines` sliced to 40 and intersected with today's active lines);
`/r/[id]` returns 404 for a line run before building anything; `loadFinding` returns null when a line finding's line is
not the business's; the finding page drops `/r/` proof links for a line. One P3: the type filter uses the index
`event (business_id, at desc)` and filters `type` row by row; add `(business_id, type, at desc)` when event volume grows.

**New, outside this feature (pre-existing on main), P1: SEC-V08, repeated baseline through Google reconnect.** Path:
(1) a verified owner of a paying business; (2) runs `/api/google/start` → Google consent (`prompt=consent`, one click,
scriptable with their own Google session) → `/api/google/callback`, again and again; (3) every successful callback with
status `trial`/`active` enqueues `setup` (`callback/route.ts:124`; the phone path `google/actions.ts:81` likewise, only
while unverified), and `setup` enqueues a full `baseline` scan every time with no "already this month" check
(`jobs/setup.ts:35`); (4) `baseline` is in `DEFER_ONCE`, so above the €30 daily ceiling each one is moved once and then
runs. Each loop costs us one full scan (€11–22). Not P0 here: it needs a real Google consent per scan, every loop leaves
`owner.verified` + `google.connected` events under the payer's own account, and it is not in or changed by 006. Fix
(30 min): in `setup`, enqueue the baseline only when no `scan.enqueued` of kind `baseline`/`monthly` exists for the
business in the last 30 days (same typed `listEvents` call); a test that two setups give one baseline. Ship with the
V01 hotfix or right after.

**Main hotfix scope for SEC-V01 that I accept.** Exactly the business half, nothing of 006:
1. `packages/core/src/db/types.ts`: `listEvents(businessId, limit?, type?)`; `mem.ts` and `pg.ts` as on this branch
   (filter by type before the limit; Pg `and type = ${type}` in the query). Only these two Db implementations exist.
2. `apps/worker/src/cron.ts` `enqueueMonthlyScans`: `const evs = await db.listEvents(b.id, 500, "scan.enqueued")` in
   place of `events(b.id)`; the `already` predicate unchanged. No line budget, no line loop, no other cron function.
3. One worker test: a business with this month's `scan.enqueued`, 600 `account.mail_prefs_set` events, a second
   `enqueueMonthlyScans` pass → still one monthly job. It must fail on main's current code.
4. Optional, accepted but not required: the `(business_id, type, at desc)` index as a new migration; the SEC-V08 setup
   guard as a separate commit in the same PR.
Out of scope for the hotfix: `spend.ts` (the `DEFER_ONCE` semantics stay as decided in CMP-05), other `events()`
callers in `cron.ts` (they read owner-independent markers or are bounded elsewhere).
