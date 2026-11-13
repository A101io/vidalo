# 003 — QA verification

QA agent, 11 Nov 2026, worktree `claude/scan-mail-confirm` (uncommitted change). Standard: `01-brief.md` AC-1..AC-10.

**Verdict: gate closed. Two P0s: AC-3 (a link works more than once under a double submit) and AC-4 (the link secret is stored in clear in the job queue).** Everything else passes, with evidence below.

## How it was tested

Three setups, so that the caps (switched off in mock mode) and real database latency could be seen:

| Setup | What | Why |
|---|---|---|
| Unit | `packages/core/test/scan-confirm.test.ts` (12 tests) | token, `findPending`, `ipBucket`, mail wording |
| Mock server | `next dev --webpack --port 3118`, `VIDALO_MOCK=1`, MemDb, all keys empty | Playwright specs, the GET guarantee |
| Real-engine server, no keys | same port, `VIDALO_MOCK` unset (so `env.realEngines` is true and every cap is on), every key in `.env.example` empty (every engine's `available()` is false, Places returns `[]`), `DATABASE_URL` = a throwaway Postgres on :5544 with every migration applied, `FREE_SCANS_PER_DAY=3` (site mail cap 12) or 100 | caps, the queued mail, the double-submit race on a real database. No paid API can be reached in this setup |

The scripts are in the QA scratchpad, not in the repo: `caps.mjs` (AC-2/5/7/8), `race-pg.mjs` (AC-3 double submit), `route-controls.sh`, `get-control.sh`, `unit-controls.sh`. The connection is set with `x-forwarded-for` (what `clientIp` reads off Cloudflare).

## Acceptance table

| AC | Result | Evidence |
|---|---|---|
| AC-1 Post from a visitor not signed in never starts engine calls; stores a pending request; queues one confirmation mail | **pass** | `apps/web/app/api/scan/route.ts:107` calls only `requestConfirmation`; no `createScanState`/`startFreeScan` left in the route. Real-engine server, one post: `Location: /scan/mail`; Postgres afterwards: `scan_run` 0, `scan.requested` 0, one event `scan.confirm_requested {hash, lang, marketing}` and exactly one job `email / scan_confirm / to qa1@example.nl`. Playwright `free-check.spec.ts` "nothing starts before the mail link is pressed…" |
| AC-2 The link page starts nothing; only the POST button starts, through the daily cap and per-visitor allowance | **pass** | Page `apps/web/app/scan/bevestigen/page.tsx` only reads; form `method=post action=/api/scan/bevestigen`. New test `e2e/scan-confirm.spec.ts` "opening the link starts nothing; only the button does (AC-2)": 3 GETs, 8 s, then a new request for the same business must get a new waiting room (a GET-started check would hand back its report). Caps on the button (`lib/free-check-start.ts:46`), real-engine server, cap 3: press 1, 2 from 100.64.0.1 → `/scan/<token>`; press 3 from same IP → `/scan/druk` (`ip_cap`, allowance 2); same link from 100.64.0.2 → starts (refusal leaves the link usable, as designed); press 4 → `/scan/druk` (`daily_cap`). Refusal events: `{"cap":2,"reason":"ip_cap"} {"cap":3,"reason":"daily_cap"}` |
| AC-3 Works once and for 24 h; second press goes where the first went; unknown, malformed or expired starts nothing and says so | **FAIL (P0, QA-01)** | Sequential: passes — `findPending` (`scan-confirm.ts:63-70`), unit tests "works once…", "expires after the TTL", "refuses what cannot be a token"; mock server: third sequential press → same `/scan/<token>`; `t=nope` and an unknown secret → 303 to `/scan/bevestigen?t=…` which renders "Deze link klopt niet of is verlopen…". **Concurrent: fails.** Real-engine server on Postgres, `race-pg.mjs`: 2 simultaneous presses of one link started 2 checks in **9 of 10** rounds; 5 simultaneous presses from one IP started **5 checks in 3 of 3** rounds (19 and 15 `scan_run` rows). See QA-01 |
| AC-4 Address never in a URL; only a hash of the link secret is stored | **FAIL (P0, QA-02)** | Address: never in a URL — pass (`Location: /scan/mail` in real mode; `?link=` carries the token, not the address, and only with mock engines; `/scan/druk?mail=1`; the e-mail link is `/scan/bevestigen?t=<businessId>.<secret>`). Event store: pass — only `hash` (`pendingPayload`, Postgres row above); the per-address counter event is a hash (`confirmAddressEvent`). **Job store: fails** — `job.payload.text` and `job.payload.html` of the `scan_confirm` job hold the full link with the secret (`apps/web/lib/scan-confirm.ts:46`; query `regexp_match(payload->>'text','bevestigen\?t=…')` → `t` for both text and html), and `completeJob` (`packages/core/src/db/pg.ts:607`) keeps the payload after sending. See QA-02 |
| AC-5 Caps per address 3/day, per connection 5/day (IPv6 /64), site-wide 4 × FREE_SCANS_PER_DAY per 24 h, while engines are real | **pass** | `apps/web/lib/scan-confirm.ts:29-38`. Real-engine server: address a@ from 4 different IPs → mail, mail, mail, `/scan/druk?mail=1`; 6 addresses from one /64 → 5 × mail, 6th `/scan/druk?mail=1`; FREE_SCANS_PER_DAY=3, 13 addresses from 13 IPs → 12 × mail, 13th `/scan/druk?mail=1`, 12 `scan.confirm_requested` stored. Mock mode: no caps (`env.realEngines &&`), as the brief says |
| AC-6 The reason is stated in the mail, on /scan/mail and /scan/bevestigen, and in the privacy statement, NL and EN | **pass** | Copy `packages/core/src/copy/index.ts:1408` (pages), `:3135` (mail), `:1007` (privacy); `en.ts:1371`, `:3047`, `:984`. Rendered: `/scan/mail` "kwaadaardige bots buiten de deur te houden"; `/en/scan/mail` and `/en/scan/bevestigen?t=…` "malicious bots out"; `/privacy` and `/en/privacy` both carry it; the queued NL mail text line 9 "kwaadaardige bots buiten de deur te houden… De link werkt 24 uur en één keer"; unit "scanConfirmEmail carries the link and says why, in both languages" |
| AC-7 IPv6 in one /64 share one allowance; IPv4 counting unchanged | **pass** | `ipBucket` `scan-limit.ts:30`, used by both `scanIpEvent` and `confirmIpEvent` (`:55`). Unit "counts IPv6 per /64…", "one /64 shares one allowance". Route: 2001:db8:1:2::1..::6 → 6th refused, 2001:db8:1:3::1 (next /64) → mail. IPv4: 203.0.113.9 six times → 5 × mail, 6th refused; 203.0.113.10 → mail (no /24 grouping). The event key for a plain IPv4 is `sha256("<day>|<ip>")` as before, so the counts of the day of deploy carry over |
| AC-8 Daily cap and per-visitor allowance checked before the Places lookup on POST /api/scan | **pass** | `route.ts:66-71` (`freeCheckRefusal`) precedes `resolveBusiness` at `:75`. Real-engine server after the daily cap was used up: form post → `/scan/druk`, event `{"at":"form","reason":"daily_cap"}`, `business` row count unchanged (4 → 4), so neither the lookup nor `prepareBusiness` ran |
| AC-9 Cloudflare rate-limit rule written down for Julian with exact values (go-live X9) | **pass** | `docs/go-live-checklist.md` row X9: both zones, menu path, name `free-check posts`, expression `(http.request.method eq "POST" and http.request.uri.path in {"/api/scan" "/api/scan/bevestigen"})`, per IP, 5 per 10 s, block 10 s. Note QA-04 (no direct link) |
| AC-10 typecheck, unit tests, e2e:mock, Playwright mock suite green | **not confirmed by QA; re-run after the QA-01 fix** | QA re-run on the tree as built: `pnpm -r typecheck` done (web, worker, core); `pnpm -r test` core 1262 passed / 15 skipped, worker 24 passed; `pnpm e2e:mock` "OK e2e-mock". Playwright: both QA runs were spoiled, see "Runs". The builder reports 112/112 on the tree before the fix work began |

## Controls

Every guarantee was broken on purpose, the test watched go red, and the file restored (md5 compared to the copy taken before).

| Guarantee | Test | What I did to make it fail | Red |
|---|---|---|---|
| Link works once | unit "works once; a used link points where the first press went" | `findPending`: `if (used)` → `if (false && used)` | 1 failed |
| Link expires after 24 h | unit "expires after the TTL" | `> SCAN_CONFIRM_TTL_MS` → `> Infinity` | 1 failed |
| Malformed link starts nothing | unit "refuses what cannot be a token" | `parseConfirmToken` accepts any string | 1 failed |
| IPv6 counted per /64 (unit) | unit `ipBucket` ×3 | `ipBucket`: return the raw address for IPv6 too | 3 failed |
| IPv6 counted per /64 (route) | `caps.mjs mail` | same break, live server | "ipv6 same /64 #6" FAIL (`/scan/mail`) |
| No start on GET | new e2e "opening the link starts nothing; only the button does (AC-2)" | page calls `startFreeCheck` and logs `scan.confirmed` on render | 1 failed: received `/r/43f388f5-…` |
| Per-address mail cap 3 | `caps.mjs mail` | `>= CONFIRM_MAILS_PER_ADDRESS` → `>= 99` | "address a@ #4" FAIL (`/scan/mail`) |
| Per-connection mail cap 5 | `caps.mjs mail` | `>= CONFIRM_MAILS_PER_IP` → `>= 99` | "ipv6 same /64 #6" FAIL |
| Site-wide mail cap 4 × cap | `caps.mjs site` | `>= siteCap` → `>= 9999` | "site #13" FAIL, 13 mails stored |
| Caps before Places (AC-8) | `caps.mjs start` | route: `if (refusal)` → `if (false && refusal)` | "form post after the cap" FAIL, business rows 4 → 5 |
| Caps on the button (AC-2) | `caps.mjs start` | `startFreeCheck`: refusal forced to `null` | "press 3 (allowance 2)" and "press 4 (daily cap 3)" FAIL, both started |

No control for AC-3 concurrent: there is nothing to break, it already fails (QA-01). The Playwright double-submit test I first wrote passed on MemDb even against the broken code (the in-memory store has no I/O between read and write, so the race never opens); a test that cannot fail is not a test, so I removed it. The race only shows on Postgres (`race-pg.mjs`).

The existing `free-check.spec.ts` test "nothing starts before the mail link is pressed…" does not protect the GET guarantee: if opening the link started the check, the button would still lead to the same report. That is why the new spec exists.

## Findings

| ID | Sev | Claim | Evidence | Proposed fix | Cost |
|---|---|---|---|---|---|
| QA-01 | **P0** | AC-3: one link starts as many checks as there are simultaneous presses; it also walks past the per-visitor allowance (2) because every press reads the counts before any of them writes | `race-pg.mjs`, Postgres: 2 presses → 2 checks in 9/10 rounds; 5 presses from one IP → 5 checks in 3/3 rounds. Cause: `apps/web/app/api/scan/bevestigen/route.ts:24` reads `findPending`, `:33` runs `startFreeCheck` (10+ queries), and only `:35` writes `scan.confirmed`. A double-click on "Start de controle" is enough; a script with one confirmed mailbox can fill the day's 25 checks in one burst | Claim the link atomically before starting. Add to `Db` `claimConfirm(hash): Promise<boolean>`: PgDb `insert into scan_confirm_use (hash) values ($1) on conflict do nothing returning hash` (new table, primary key `hash`, RLS on, no policies, like `waitlist`), MemDb a `Set`. In the route: claim first; if not claimed, look up `scan.confirmed` for `to` and redirect there, or to `/scan/bevestigen?t=…` (it shows the button again) when the first press has not written it yet; if `startFreeCheck` returns `/scan/druk`, release the claim (`delete`), so the link keeps working as now. Test: a case in `packages/core/test/db.test.ts` (runs on MemDb and PgDb in `verify:pg`) where `Promise.all` of 5 claims yields exactly one `true`; rerun `race-pg.mjs` → 0 of 10. The same read-then-write race exists for `freeCheckRefusal` vs `scan.requested` (pre-existing, P1, see QA-03) | 2–3 h |
| QA-02 | **P0** | AC-4: the link secret is stored in clear, in the job queue, after the mail is sent | `apps/web/lib/scan-confirm.ts:46` puts `text`/`html` with the full link in `job.payload`; `pg.ts:607` `completeJob` keeps the row. Postgres: both fields contain `bevestigen?t=<businessId>.<secret>`. Anyone who can read `job` for 24 h can start a check in that requester's name; the stored hash is pointless while the secret sits next to it | When the email job for `kind: "scan_confirm"` completes (worker email handler), strip the link: `update job set payload = payload - 'text' - 'html' where id = $1` (or store only `{ template: "scan_confirm", businessId, lang }` plus the token and drop `token` on completion). Test: worker test that after sending a `scan_confirm` job its payload holds no `bevestigen?t=` | 30–60 min |
| QA-03 | P1 | The daily cap and per-visitor allowance are read-then-write: concurrent presses of different links (or of one link, QA-01) can each pass the count | `free-check-start.ts:46-52`: `freeCheckRefusal` counts, `scan.ip`/`scan.requested` are logged after. Not an AC on its own (the brief asks that the caps apply, which they do sequentially); existed before this change in `/api/scan` | After QA-01, the remaining exposure is one press per link; tolerable with the Cloudflare rule. If tighter: count-and-insert in one statement (`insert … select … where (select count(*) …) < $cap returning`) | 1–2 h |
| QA-04 | P2 | X9 has the menu path but no direct link, against CLAUDE.md rule 8 | `docs/go-live-checklist.md` X9 | Add `https://dash.cloudflare.com/37c9615a0d7d9629154eca03d7de59a6/vidalo.ai/security/security-rules` and the same for `vidalo.io` | 5 min |
| QA-05 | P2 | The NL · EN switch on `/en/scan/bevestigen?t=…` drops `?t=`; switching language turns a working link into "Deze link klopt niet" | Rendered page: lang-switch hrefs `/scan/bevestigen` and `/en/scan/bevestigen` | Keep the query string in the switch for this page (or hide the switch here) | 30 min |
| QA-06 | P3 | `scan-confirm.ts:15` says "A signed-in visitor proved the address with the sign-in link and skips this"; no code does that (signed-in visitors also get a mail; `signed-in.spec.ts` goes through the link) | grep: no caller of `startFreeCheck` other than `/api/scan/bevestigen` | Either implement the skip in `route.ts` (session email equals the requester) or delete the sentence | 10 min / 1 h |

## Runs

- Unit: `npx vitest run test/scan-confirm.test.ts` 12/12; `pnpm -r test` core 1262 passed, 15 skipped; worker 24 passed.
- `pnpm -r typecheck`: done for web, worker, core.
- `pnpm e2e:mock`: OK.
- Playwright mock suite, run 1 (against QA's mock server on :3118, 17:36): 111 passed, 2 failed: `consent.spec.ts:31`, which needs `GA4_MEASUREMENT_ID`, and that server did not set it (playwright.config sets it, QA's server did not), and `free-check.spec.ts:25 @smoke`, the first test to run on a cold server (the known cold-compile flake, CLAUDE.md 22 Oct). Neither one says anything about this change.
- Playwright mock suite, run 2 (`E2E_PORT=3117 npx playwright test --workers=2`, its own server, 18:40–18:46): 106 passed, 7 failed. **This run is void.** Another session started a QA-01 fix in this worktree during the run: `Db.withLock` in `db/types.ts`, `mem.ts`, `pg.ts`, used from `lib/scan-confirm.ts` and `core/shared/scan-confirm.ts`, plus `test/scan-confirm-race.test.ts`, all edited from 18:42. The server logged `TypeError: db.withLock is not a function` on every `/api/scan` post while those files were half-written, and the 7 failures all go through that path (`signed-in.spec.ts` ×5, `scan-website.spec.ts` ×2).
- The QA controls ended before that work began. Last restore 18:35:40 (`page.tsx`); every restored file matched its md5 from before the control. The fix's first edit was at 18:42:03. **This report describes the tree as it was at 18:40.** The fix in progress has not been verified: QA-01 stays open until `race-pg.mjs` gives 0 of 10 against it and the full suite is green.

## New test

- `e2e/scan-confirm.spec.ts` — "opening the link starts nothing; only the button does (AC-2)". Desktop project only. It waits 8 s for the mock check of a GET to finish; that is its cost.

No test added for the caps in the repo: they are switched off in mock mode, which is the only mode the Playwright and e2e suites run in, and the web app has no unit runner. The caps were proven with `caps.mjs` against a keyless real-engine server and Postgres (above). Making that permanent needs either a Playwright mode `caps` (server with `VIDALO_MOCK` unset, keys empty, `FREE_SCANS_PER_DAY=3`) or moving the decision in `requestConfirmation` into a pure core function with a unit test; P2 for the backend, about 1 h.

## Not tested, and why

- A real confirmation mail through Resend and the link in a real mailbox (Gmail/Outlook link scanners pressing GET): sending mail needs Julian; the GET guarantee is covered by the test above. Open in X9.
- The Cloudflare rate-limit rule: a dashboard setting, not built yet.
- Workers/Hyperdrive: the race was shown on local Postgres (~1 ms per query). On Hyperdrive to eu-west-1 each query is slower, so the window is wider, not narrower.
- Expiry at route level with a real clock: covered by the unit test on `findPending`, which both the page and the route call; not waited out for 24 h.
- Mobile width and the visual layout of `/scan/mail` and `/scan/bevestigen`: not looked at in a browser; the a11y spec in the suite covers pages it lists, not these two.
- Midnight UTC rollover of the per-address and per-connection counters (`dayStart`): not tested; the counters reset at 00:00 UTC (01:00 Dutch time), which is how the free-check allowance already worked.
- Security (exploitability of the token format, enumeration via `/scan/bevestigen`) and compliance (the privacy text, the legal version date of 12 November 2026 while today is 11 November): the security and compliance lanes.
