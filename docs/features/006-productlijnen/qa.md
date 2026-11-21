# QA — 006 Productlijnen in het dashboard

*qa · 21 Nov 2026 · worktree `claude/005-productlijnen`, uncommitted build (BE-01..06, FE-01..05). Tested against `01-brief.md` AC1–AC8. Nothing fixed in product code; one test added (`packages/core/test/db-product-lines-race-qa.test.ts`). Every mutation below was made on a copy and restored byte-for-byte (`cmp`).*

## Verdict
AC1–AC7 pass. **AC8 fails (P0, QA-01)**: FAQ, pricing and `/organisaties` are not updated in this PR and Julian has not approved. That is a decision as much as work: either do the surfaces here or Julian amends AC8 to "at the launch switch" (`VIDALO_PRODUCT_LINES=1`).

## Suites (all with `DATABASE_URL=` empty)
| Run | Result |
|---|---|
| `pnpm -r typecheck` | exit 0 |
| `pnpm -r test` | core 119 files, 1645 passed / 30 skipped; worker 8 files, 67 passed |
| `pnpm e2e:mock` | `OK e2e-mock`; prints `line: 2 runs, 21 findings, 21 fixes; mail with a product line section written` |
| `PG_ADMIN_URL=postgresql://a101@localhost:5432/postgres pnpm verify:pg` | 12 files, 171 passed on PgDb; `rls/product-lines: RLS-OK login1[product_line=2 …] login2[product_line=1 …] anon[product_line=0 product_line_facts=0]`; control `broken=1`: `RLS-FAIL`; e2e on Postgres `== product line: Haarlems Speltbrood, NL + BE`; `OK verify:pg — 3469 samples` |
| New `db-product-lines-race-qa.test.ts` on MemDb + PgDb | 2 passed (2.9 s) |

## Acceptance criteria
| AC | Result | Evidence |
|---|---|---|
| AC1 add, edit, discontinue; unverified/unpaid sees page, cannot save, reason shown | **pass** | Browser, :3100, 375 px, demo owner. Discontinue Kerststol → `?status=1`, "De status is aangepast.", badge "Niet meer leverbaar". Add "Volkoren Waldkorn QA" (NL) → `/app/productlijnen/c20f7307…?opgeslagen=1`, "Versie 1". Edit Speltbrood → "Versie 3 … 3 versies bewaard". Reactivate Kerststol at the limit → `?fout=limiet`, sentence shown. Switched to "Bakkerij de Vries, Amsterdam" (unverified): page shows "Bevestig eerst dat je de eigenaar bent…", no form even on `?nieuw=1`. Crafted POST of the save action naming the Amsterdam business → redirect `?fout=toegang:not_verified`. Unpaid/plan/paused/switch-off: `web-product-lines.test.ts` "refuses plan setup, an unpaid and a paused business…" (controls 4, 5) |
| AC2 confirmed line enters next monthly check, per market in `scanLang` | **pass** | `apps/worker/test/lines.test.ts` "one business job and one job per (active line, market)…", "a line added after the month's business check is still picked up…"; `line-scan.test.ts` "…the BE run is asked in English"; `line-prompts.test.ts` NL Dutch / BE English (control 9) |
| AC3 list: per-market dots per AI system, open errors, "genoemd als aanrader n van m"; no score or position | **pass** | Browser list text: "Haarlems Speltbrood · Nederland · ChatGPT Misleidt / Google AI Klopt / Perplexity Klopt · 1 fout open · Genoemd als aanrader: 3 van 10 keer"; new line "Nog niet gecontroleerd". EN `/en/app/product-lines`: "Named as a recommendation: 3 of 10 times". No number other than counts; copy test "no jargon, no price, no promise" green. 375 px: `scrollWidth` 375 on list, detail and finding |
| AC4 line finding on `/app/fouten/[id]` with line, samples, source, fix actions; "Ik heb dit aangepast" works | **pass** | `/app/fouten/5edbf98e…`: "Productlijn: Haarlems Speltbrood · Nederland" (link to the line, `?markt=NL`), 5 raw samples, "Bron: broodwiki.example", "Correctieverzoek namens jou gestuurd naar redactie@broodwiki.example". Pressed "Ik heb dit aangepast" → `?hercontrole=ingepland`, "Dank. We vragen het binnen een uur opnieuw.", log "Jij: aangepast", recheck moved 21 dec → 21 nov. The recheck run itself (no worker on :3100): `line-fixer.test.ts` "'Ik heb dit aangepast' runs a line recheck for that market and engine and resolves…" (control 8). "Dit klopt wél" posts to the line edit form |
| AC5 monthly mail, section per line, owner's language | **pass** | `line-mail.test.ts` NL and EN sections, link `/en/app/product-lines/<id>` for EN, discontinued line absent, business mail unchanged by snapshot (control 10); e2e writes the mail with a line section |
| AC6 RLS proven with rolled-back DO block | **pass** | `scripts/rls/product-lines.sql` via verify:pg: owner sees own 2 lines, other owner 1 (own), anon 0; writes through the Data API denied; stored version immutable. Control `broken=1` (member policies `using (true)`) → `RLS-FAIL`. Local Postgres only; hosted project not touched (D4) |
| AC7 typecheck, test, e2e:mock green; mock pipeline includes a line | **pass** | Suites table above |
| AC8 every surface updated in the same PR; Julian approves before merge | **FAIL** | Done: owner pages, nav, mails, terms/privacy wording (`copy.legal`, version 21 Nov, `legal:lock`), processors, records, CRITERIA, ARCHITECTURE, MESSAGING, cost-per-client. Not done: `copy.landing.faq` (0 mentions of productlijn), chat knowledge (`core/chat`, 0 mentions), pricing, `/organisaties` (unmerged corporate branch), terms "what a line includes" (waits on D1/D2). No approval recorded. → QA-01 |

## Controls (guarantee removed → test red → restored)
| # | Guarantee | Test | What I did | Result |
|---|---|---|---|---|
| 1 | Active-line limit holds under parallel saves (PgDb) | `db-product-lines.test.ts` "two parallel saves at the limit"; new `db-product-lines-race-qa.test.ts` | `pg.ts` `saveProductLine`: replaced `this.withLock(...)` with a pass-through | existing test red in **2 of 6** runs (weak bulb, QA-02); new test red 3 of 3 |
| 2 | Reactivation obeys the limit under races (PgDb) | existing "parallel reactivations…"; new race test | `pg.ts` `setProductLineStatus`: lock removed | existing test **green 3 of 3** (no free place, nothing to race: QA-02); new test red 3 of 3 |
| 3 | Business readers never see line rows | `product-lines-isolation`, `line-scan`, `line-mail` | `mem.ts` `listFindings`: `inLine` only when a line is passed | 4 tests red |
| 4 | Only the verified owner may save/scan lines | `web-product-lines` "refuses a user who is not the verified owner…"; worker cron test | `shared/product-lines.ts`: `isVerifiedOwner` line removed | 1 web + 1 worker test red |
| 5 | Server action gate, not the hidden form | `web-product-lines` FE-02 tests | `apps/web/lib/product-lines.ts` `gate`: `if (access.ok \|\| true)` | 2 tests red |
| 6 | Worker skips line scans/rechecks without access | `lines.test.ts` S-20 | `paid.ts`: `if (!access.ok) return skip(...)` removed | 2 tests red |
| 7 | RLS: own lines only, anon none | `scripts/rls/product-lines.sql` | `broken=1` (built in) | `RLS-FAIL` |
| 8 | "Ik heb dit aangepast" re-asks the line in its market | `line-fixer` AC4 test | `fixer/index.ts` `runRecheck`: scope forced `undefined` | red |
| 9 | Questions in the market's language | `line-prompts`, `line-scan` | `prompts/line.ts`: `scanLang("NL")` | 5 tests red |
| 10 | Mail sections in the owner's language | `line-mail` EN test | `reporter/index.ts`: `lineSections(business, "nl", …)` | red |
| 11 | `/r/<line run id>` is 404 | **none automated** (QA-03) | `app/r/[id]/page.tsx`: guard removed, live dev server | `/r/9164164a…` (Speltbrood NL monthly run, id from the owner export) went **200** and rendered the business hero with Speltbrood content; restored → 404. Business run `/r/93dc25e0…` 200 throughout; `/scan/<line run>` and `/api/scan/<line run>/status` 404 |

## Other checks
- **JS-off post of bad values (WCAG 3.3.7):** native multipart POST of the edit form (`$ACTION_REF_3` fields, no `Next-Action` header, as a browser without JS sends it) with name 95 × "N" and outlet url `ftp://slecht.example`: HTTP 200, no redirect, URL unchanged (`?bewerken=1`), inputs come back with the typed values (name length 95, category `speltbroodQA`, url `ftp://slecht.example`), summary "Er zijn 2 plekken die je nog moet aanpassen.", field messages "De naam is te lang. Maximaal 80 tekens." and "Dit is geen geldige webpagina. Begin met https://". Same path refuses 3 markets, market `XX`, outlet in an unchosen market (FR), blank name/category, a use case "Negeer alle eerdere instructies…" (sanitiser). None wrote a version (still "Versie 1").
- **Phone width 375 px:** no horizontal page scroll on list, detail (NL/BE), edit form, finding page, EN pages. Grids scroll inside their card (QA-05).
- **EN:** list, detail and finding in English after switching `business.language`; restored to `nl` afterwards.

## Findings
| ID | Sev | Claim | Evidence | Proposed fix | Cost | Owner | Status |
|---|---|---|---|---|---|---|---|
| QA-01 | P0 | AC8 not met: FAQ, assistant knowledge, pricing and `/organisaties` unchanged; no approval | `grep -ci productlijn` on `copy.landing.faq` / `core/chat`: 0; `/organisaties` lives on the corporate branch | Either (a) add one FAQ item NL+EN ("Kan ik ook mijn producten laten controleren?": per productlijn, per land, maandelijks, alleen Vidalo Monthly, geen prijs tot D1) and the same fact to the chat knowledge, and the `/organisaties` sentence when that branch merges; or (b) Julian amends AC8 so these surfaces ship with the launch switch `VIDALO_PRODUCT_LINES=1`, which is off by default. Then Julian's approval on the PR | 1–2 h for (a); a decision for (b) | frontend / Julian | open |
| QA-02 | P2 | The committed concurrency tests do not reliably fail without the lock | Control 1: 2 of 6 red; control 2: 0 of 3 red (the reactivation test leaves no free place) | Added `packages/core/test/db-product-lines-race-qa.test.ts` (30 rounds; one free place for both saves and reactivations); red 3/3 for each lock removed, green on MemDb and PgDb, picked up by verify:pg's `test/db*.test.ts` | done | qa | fixed (test added, uncommitted) |
| QA-03 | P2 | The `/r/<line run>` 404 guard has no automated test | Control 11: removing it serves the line run as a public report; only a manual check catches it | Move the check to `apps/web/lib/report-access.ts` `isLineRun(id, db)` (uuid test + `getScanRun(id)?.productLineId`), call it from `r/[id]/page.tsx`, unit-test it on MemDb with the seed's line run and a business run | 30 min | frontend | open |
| QA-04 | P2 | An invalid outlet URL marks the market and name fields invalid, not the URL field | Server-rendered form after POST: `outlet.0.market`/`outlet.0.name` `aria-invalid=true` + `aria-describedby=e-outlets-0`; `outlet.0.url` no `aria-invalid`, describedby only `h-outlet-0-url` (`LineForm.tsx:345,357,363`) | Carry which part failed in `ProductLineFieldError` (e.g. `part: "url"`), set `aria-invalid` and `aria-describedby="e-outlets-i h-outlet-i-url"` on the failing input only | 30 min | frontend | open |
| QA-05 | P2 | Dot grids scroll horizontally at 375 px in a container that is not focusable or named | `DotGrid.tsx:23` `overflow-x-auto`, measured 480/338 px, no `tabindex`/role/label (same pattern as `/app/voortgang/page.tsx:62`) | `tabIndex={0} role="region" aria-label={title}` on the wrapper | 10 min | frontend | open |
| QA-06 | P3 | Saving an edit without touching markets reorders them | Speltbrood v2 markets NL, BE; after a v3 that changed only "Opgevolgd door" the list shows België before Nederland | Keep the previous version's order for markets still chosen (append new ones) in `readLineForm`/`parseProductLine` | 15 min | frontend | open |
| QA-07 | P3 | EN finding page words a Dutch spec label into the English question | `/en/app/fouten/5edbf98e…`: "Asked \"What gewicht does Haarlems Speltbrood have?\"" | For an NL-market line finding on an English page, quote the asked Dutch question as stored (as for business questions), not the EN template with the Dutch label | 20 min | frontend | open |
| QA-08 | P3 | Back link on a line finding goes to the business overview | `/app/fouten/<line finding>`: "← Overzicht" → `/app` | For a line finding link "← {line name}" to `/app/productlijnen/<id>?markt=<m>` | 10 min | frontend | open |

Outside this feature, seen while testing (pre-existing on main, not counted against 006):
- P2: on English finding pages the "What now" line is Dutch for business findings too ("We maken op je feitenpagina…", "We dienen een correctie in bij de gids.") and for the line finding ("We vragen de bron uit jouw naam…"). Fix: English wording per fix path (`labelEn`/`describeEn`) in `fixer/paths.ts`. 1 h.
- P2: the owner header is `position: sticky` and 292 px tall at 375 px (36 % of an 812 px screen), so focused fields can sit under it (WCAG 2.4.11). Fix: not sticky below `sm`, or collapse the nav into a menu. 30 min.

## Not tested, and why
- Real AI engines, Resend, Stripe: no keys in this run; judging is tested with the mock engine and rules extraction only. The architecture's own risk (spec units "16 bar" vs "PN16", resellers not in the owner's list) needs real answers before launch.
- The recheck actually running after "Ik heb dit aangepast" in the browser: no worker on :3100; covered by `line-fixer.test.ts` only.
- Owner pages on PgDb: the dev server runs MemDb; PgDb is covered at the `Db` level and by e2e on Postgres.
- Hosted Supabase (D4): not touched, by instruction.
- WebKit/iPhone, an axe run, Playwright specs (FE-01..03 ask for them; not written by build either), screen reader.
- The report wait across DST and month end with real timing: unit-tested with fixed dates only.
- Mail rendering in real clients: snapshot and HTML only.
- Security's checklist items (S-13 daily version cap etc.) and compliance's: their lanes.

## Round 2 (21 Nov 2026, last round)

*qa · same worktree, uncommitted fix round r1. Browser evidence from Playwright 1.64 (Chromium) against the mock dev server on :3100, signed in as the demo owner, at 375 × 812 and 1280 × 900; the no-JS checks use a context with `javaScriptEnabled: false`, so the form posts natively. `verify:pg` not run (another process may hold `vidalo_verify`). QA-01 (AC8) unchanged and not re-argued: still a decision for Julian.*

### Suites (`DATABASE_URL=` empty)
| Run | Result |
|---|---|
| `pnpm -r typecheck` | exit 0 |
| `pnpm -r test` | core 121 files, 1655 passed / 30 skipped; worker 8 files, 69 passed (incl. `db-product-lines-race-qa.test.ts` on MemDb) |
| `pnpm e2e:mock` | `OK e2e-mock`; `line: 2 runs, 21 findings, 21 fixes; mail with a product line section written` |

### Round-1 findings re-checked
| ID | Result | Evidence |
|---|---|---|
| QA-03 `/r/<line run>` guard has a test | **not fixed** | No `isLineRun` / `lib/report-access.ts`; the guard is still inline in `app/r/[id]/page.tsx:42`, and no test imports it (`report-online.test.ts`, `namesake-wiring.test.ts` do not cover line runs). Behaviour still right: line run `9164164a…` gives 404 on `/r/`, `/scan/` and `/api/scan/…/status`, both as owner and anon. Stays open P2 |
| QA-04 outlet URL error marks the URL field | **pass** | JS-off POST, name 95 × "N", `outlet.0.url=ftp://slecht.example`: `#f-outlet-0-url` `aria-invalid=true`, `aria-describedby="e-outlets-0 h-outlet-0-url"`; `#f-outlet-0-market` and `#f-outlet-0-name` no `aria-invalid`, no describedby. No automated test (UI only) |
| Error summary, links and focus without JS (CMP-611) | **pass** | Same POST: HTTP 200, URL stays `?bewerken=1`, `document.activeElement` = `#error-summary` (`role=alert`, `tabindex=-1`, `autofocus`), text "Er zijn 2 plekken die je nog moet aanpassen.", links `#f-name` and `#f-outlet-0-url`, both targets exist; following the second link puts focus on `#f-outlet-0-url`. Typed values come back. Nothing written: still "Versie 3" |
| QA-05 dot grids named and focusable | **pass** | Detail NL and BE: two `role=region` `tabindex=0`, `aria-label` "Per onderdeel" / "Per AI-systeem" (EN "Per item" / "Per AI system"); at 375 px they scroll inside (480/339), page `scrollWidth` 375 |
| QA-06 market order kept | **pass from the UI**, residual → QA-11 | Untouched JS save of a line stored NL, BE: stays "Versie 4", order NL, BE. A version stored in another order (round 1's v3 BE, NL) is rewritten on the first untouched save (v3 → v4, BE, NL → NL, BE): the form always posts `LINE_MARKETS` order |
| QA-07 EN page quotes the Dutch question | **not fixed** | `/en/app/fouten/5edbf98e…` (owner language set to `en` by `/api/lang`, restored to `nl` afterwards): still `Asked "What gewicht does Haarlems Speltbrood have?"`. Stays open P3 |
| QA-08 back link to the line | **pass** | NL finding `5edbf98e…`: "← Haarlems Speltbrood" → `/app/productlijnen/449aefb1…?markt=NL`; BE outlet finding `0923a731…` → `?markt=BE`; EN → `/en/app/product-lines/…?markt=NL`. Both widths |
| CMP-607 outlet finding: no "Ik heb dit aangepast", no "binnen een uur" | **pass** | `0923a731…` (BE outlet): button count 0, "binnen een uur" absent, "Geen hercontrole" present; EN the same. The NL spec finding keeps its button. A crafted post of the action still gets `hercontrole=geen` (`markFixedByOwner` returns null) |
| S-13 unchanged save writes no version | **pass**, with QA-11 | Test "saving the same data again writes no version and no event (S-13)"; in the browser an untouched JS save left "Versie 4" |

### Controls (guarantee removed → test red → restored, `cmp` identical)
| Guarantee | Test | What I did | Result |
|---|---|---|---|
| S-13: same data, no version | `web-product-lines` S-13 test | `apps/web/lib/product-lines.ts:279`: `if (false && …)` | red |
| CMP-607: an outlet finding queues no recheck | `line-fixer` CMP-607 test | `fixer/index.ts:346`: guard replaced by `if (false)` | red |
| QA-03, QA-04, QA-05, QA-08, focus without JS, the page hiding the CMP-607 button | **none automated** | — | browser evidence only (BLD-04: Playwright specs still not written) |

### Regressions AC1–AC7
No regression. AC1: discontinue and reactivate "Volkoren Waldkorn QA" at 375 and 1280 ("De status is aangepast.", buttons swap), edits at 375 (above), refusal at the limit and the access refusals through the green `web-product-lines` tests. AC3: list at both widths has per-market dots per AI system, "1 fout open", "Genoemd als aanrader: 0 van 5 keer"; no score, percentage or position. AC4: finding page with line, market, samples, back link; AC2, AC5, AC7: suites above. AC6: its RLS run lives in `verify:pg`, not re-run this round, so AC6 rests on round 1's evidence. Page `scrollWidth` equals the viewport on list, detail NL/BE, both findings, NL and EN.

### New finding
| ID | Sev | Claim | Evidence | Proposed fix | Cost | Owner |
|---|---|---|---|---|---|---|
| QA-11 | P3 | The S-13 "no change, no version" check is order-sensitive: a post that only swaps the market order writes a new version, so a crafted swap followed by a normal save grows the version table without limit | JS-off context, edit form with the two ticked market labels swapped in the DOM (posts `markets=BE&markets=NL`): v4 → **v5**; a plain untouched save then posts NL, BE: v5 → **v6**. Every pair repeats. `sameData` compares `markets` as an ordered array (`apps/web/lib/product-lines.ts:262`) | Put markets in `LINE_MARKETS` order in `parseProductLine` (`packages/core/src/shared/product-lines.ts` ~line 212), which also makes QA-06 hold for any post; or compare markets as a sorted set in `sameData`. Add a case to the S-13 test that posts BE, NL against a stored NL, BE | 15 min | frontend (or backend for the parser) |

Dev data changed by this round (mock MemDb on :3100 only): Speltbrood now at version 6 (NL, BE); Waldkorn active; owner language back to `nl`.

### Not tested in round 2, and why
- `verify:pg` (PgDb, RLS DO block, race test on Postgres): skipped by instruction, a concurrent run may hold `vidalo_verify`.
- SEC-V07 (open fixes on the line detail), SEC-V01..V05, CMP-601..604: other lanes or not in this round's scope.
- WebKit/iPhone, axe, screen reader; still no Playwright specs for the line pages (BLD-04).
- Real engines, Resend, Stripe, hosted Supabase: as in round 1.
