# 005 Scan identity: QA (verify phase)

QA agent, 16 Nov 2026. Tested against `01-brief.md` AC-1..AC-8 (AC-6 as amended in phase 4: CMP-01 / SEC-01).
Working tree: branch `claude/scan-identity`, uncommitted. Mock mode, dev server on :3119 (`next dev --webpack`,
the keyless env of `playwright.config.ts`), `DATABASE_URL=` throughout. Nothing committed, pushed or mailed.

**Verdict: gate closed on QA.** AC-2 fails for one written-down case (QA-01, P0). Everything else passes with
evidence. Two P1s (QA-02, QA-03) should be fixed this cycle; QA-03 becomes a P0 the day `KVK_API_KEY` is set.

## Acceptance

| AC | Result | Evidence |
|---|---|---|
| AC-1 no identity → `fout=herken`, before bot check and lookup; field invalid; page says what to enter | **pass** | `route.ts:78` (`(typed \|\| !chose) && !identity` → `backToField("herken")`) sits before `passesTurnstile` (`:80`), `freeCheckRefusal` and `resolveBusiness` (`:90`). e2e `free-check.spec.ts` "a check without postcode or website comes back to the field, nothing looked up" (URL `fout=herken`, `input[name=identity][aria-invalid=true]`, h1 "…postcode en het huisnummer of de website"). e2e `scan-identity.spec.ts` "AC-1: …": a typed but unreadable identity ("Vidalo") is refused even with a usable identity in the cookie; a pick from `/scan/kies` needs none. Order "before the lookup" is by code reading: mock mode has no observable Places call. |
| AC-2 auto-take only on exactly one postcode + whole house number or host match; the name never decides | **FAIL** (QA-01) | Passes: `business-identity.test.ts` (postcode forms, whole number "1"≠"12", other postcode, host with/without www), `business-identity-qa.test.ts` (suffixes `80-a`, `80 bis`, `80 1hg`, `3071AV-80`; refusals `Factorij 80, 3071 AV`, `3071-AV 80`, foreign postcodes), e2e "a name alone never picks a business". Fails: any number in the street line counts as the house number, see QA-01. |
| AC-3 no/several matches → `/scan/kies` lists street, postcode, website; nothing before the click + mail | **pass** | `kies/page.tsx:48` renders `address, postcode · website · KvK`. e2e `scan-identity.spec.ts` "AC-3: …" (row text matches `<Street> <n>, <dddd> <XX>` and the website; `/scan/mail` only after "Dit bedrijf"). Confirmation is feature 004's, unchanged (`scan-confirm.spec.ts` green). |
| AC-4 "Mijn bedrijf staat er niet bij" / "My business is not listed" checks as typed; empty field → typed identity website; after the mail | **pass** | `kies/page.tsx:100-150`, `route.ts:100` and `:117`. e2e `free-check.spec.ts` "a name alone never picks…" (button reaches `/scan/mail`), e2e `scan-identity.spec.ts` "AC-4: …" (listed name, website identity that matches nobody, "not listed" with the field empty → report says "Gecontroleerd als: aanbieder van achtergrondmuziek", which only the typed website can produce). EN label: `business-identity-qa.test.ts` "AC-8 field copy…". |
| AC-5 website identity + nothing listed → check on that website, no pick page | **pass** | `route.ts:107`. e2e `scan-identity.spec.ts` "AC-5: …" (`Vloedlijn Music …` + `www.vloedlijn-music.example` → straight to `/scan/mail`, report "Gecontroleerd als: aanbieder van achtergrondmuziek"). See QA-03 for a KvK-only candidate that also satisfies this branch. |
| AC-6 postcode never stored/logged/in a URL; rides only in the signed 15-min cookie; a typed website stored only for an unlisted business | **pass** (with the latent gap in QA-03) | Cookie: `route.ts:96`, `free-check.ts` (core) `signCheckCookie`/`readCheckCookie` with `i`; `CHECK_COOKIE_OPTIONS` `httpOnly`, `maxAge: 900`. Tests: `business-identity.test.ts` "the identity in the check cookie" (round trip, old cookie reads `null`); e2e `scan-identity.spec.ts` "AC-6: …" (kies redirect carries only `q`, `place`, `k`; `Set-Cookie: vidalo_check=…; HttpOnly; Max-Age=900`; an unreadable value is not in the `fout=herken` URL nor in the page). Events: `pendingPayload` (`scan-confirm.ts:63`) and `freeCheckEvents` (`free-check.ts:40`) pick fields by name, so the `identity` key now riding on `requester` cannot reach an event; no `console`/`logEvent` in the route touches it. Website on a listed business: `onboard.ts` guard + `unlisted-website.test.ts` (security's SEC-01 fix). |
| AC-7 privacy NL + EN, cookie row, new date, lock | **pass** | `copy/index.ts` / `en.ts` "Herkennen:" / "Recognising:" item and `vidalo_check` rows; `legal.lock.json` re-hashed; `legal.test.ts` green. New test `business-identity-qa.test.ts` "AC-7 …" asserts the item names postcode + house number, home address, compare only, not kept (NL + EN) and the cookie row mentions the postcode. Date 17 Nov while today is 16 Nov: compliance CMP-06. |
| AC-8 copy NL + EN; label, hint by `aria-describedby`, error tied the same way | **pass** | `ScanField.tsx` (sr-only `<label for>`, `aria-describedby` = hint, + error when invalid, `aria-invalid`). e2e `scan-identity.spec.ts` "AC-8: …" on `/scan/kies?fout=herken` and `/en/scan/kies?fout=herken`: label found by `getByLabel`, two ids in `aria-describedby` resolving to hint and error text, axe WCAG 2.2 AA clean in both languages. "@mobile 375 px" test: field ≥ 44 px, no sideways scroll, NL and EN, desktop and Pixel 7. |

## Controls (each guarantee broken on purpose, then restored)

| Guarantee | Test that went red | What I did to break it |
|---|---|---|
| Whole house number, not a prefix | `business-identity.test.ts` "matches exactly the postcode and the house number" | `business-identity.ts:47` `String(Number(n)) === id.number` → `n.startsWith(id.number)` |
| Postcode must match | same test | deleted the `c.postcode … !== id.postcode` line |
| Host without `www.` | `business-identity.test.ts` "reads a website" + "matches the website's host…" | removed `.replace(/^www\./, "")` from `hostOf` |
| Identity survives the cookie | `business-identity.test.ts` "survives the round trip…" | `readCheckCookie` returned `identity: null` |
| AC-1 refusal before anything | `free-check.spec.ts` "a check without postcode or website…", `scan-identity.spec.ts` AC-6 and AC-1 (3 red) | deleted `route.ts:78` |
| AC-2 the name never decides | `free-check.spec.ts` "a name alone never picks…", `scan-identity.spec.ts` AC-3, AC-4, AC-6 (4 red) | `route.ts:105` `hits.length === 1 → hits[0]` replaced by the old `candidates.length === 1 → candidates[0]` |
| AC-5 website when nothing listed | `scan-identity.spec.ts` "AC-5: …" (stays on `/scan/kies`, timeout) | `route.ts:107` branch disabled (`false && …`) |
| AC-4 identity website used when the field is empty | `scan-identity.spec.ts` "AC-4: …" ("Gecontroleerd als" not found) | `route.ts:117` → `parsed.url ?? null` |
| AC-4 "not listed" is the typed business, not Google's | `scan-identity.spec.ts` "AC-4: …" ("Gecontroleerd als" not found) | `route.ts:100` → `candidates[0]` |
| AC-7 privacy item present | `business-identity-qa.test.ts` AC-7 assertion | ran it on `copy.legal` with the "Herkennen:" item stripped (data-level; the copy files were being edited by the compliance fix at the time, so I did not touch them) |

After every control `route.ts` / `business-identity.ts` / `shared/free-check.ts` were compared byte for byte with a
copy taken before (`cmp`), and matched.

## Findings

| ID | Sev | Claim | Evidence | Proposed fix | Cost |
|---|---|---|---|---|---|
| QA-01 | **P0** | AC-2 fails: every number in the candidate's street line counts as its house number, so a number in the street *name* or a unit number makes a candidate "have" a house number it does not have, and it is taken without a click. | `business-identity.ts:47` `(c.address.match(/\d+/g) ?? []).some(…)`. Failing cases (`business-identity-qa.test.ts`, the two `it.fails` "QA-01"): candidate `2e Hugo de Grootstraat 12`, `1052 LB`; visitor types `1052 LB 2` → `identityMatches` true. Candidate `Kerkstraat 12-2` (no. 12, unit 2), `1234 AB`; visitor types `1234 AB 2` → true. Also `Plein 1944 3` matches `… 1944`. Real streets of this shape are common in Amsterdam ("1e/2e/3e … straat") and elsewhere ("Plein 1944", "Laan 1940-1945"). Path to a victim: the visitor's own business at no. 2 is not among Google's three answers to the name, another business on the same postcode at no. 12 is: the check runs on that business, which is the 13/16 Nov incident again. | Match only the trailing house-number group of the street line, and read `a-b` as a range only when `b > a`: `const m = c.address.match(/(\d+)\s*[a-z]{0,3}(?:\s*[-/]\s*(\d+)\s*[a-z]{0,3})?\s*$/i); if (!m) return false; const first = Number(m[1]); const second = m[2] ? Number(m[2]) : null; const n = Number(id.number); return n === first \|\| (second !== null && second > first && n === second);` Then flip the two `it.fails` "QA-01" to `it`. Keeps "Laan 3-5" matching 3 and 5 (test "a range on the street line…"). | 20 min |
| QA-02 | P1 | A website on a shared host matches any business on that host: `facebook.com/vidalo` matches a candidate whose Google website is `facebook.com/voiladamesmode`, and that candidate is taken without a click. The AC's letter (host without `www.`) is met; its purpose ("the name never decides") is not, since only the name lookup links the two. P1 not P0 because the code does what the AC says; I would call it P0 in substance, as it is the original incident through a different door, and many small Dutch businesses give Google a Facebook or Instagram page as their website. | `business-identity-qa.test.ts` `it.fails` "QA-02". `parseBusinessIdentity("facebook.com/vidalo")` → host `facebook.com`; `identityMatches({website:"https://www.facebook.com/voiladamesmode"}, …)` → true. Same for `sites.google.com/view/…`, `linktr.ee/…`, `instagram.com/…`. | In `identityMatches`, when either side has a path beyond `/`, compare host + first path segment (lower case, no trailing slash) instead of host alone; or keep a short list of shared hosts (`facebook.com`, `instagram.com`, `linktr.ee`, `sites.google.com`, `business.site`, `wixsite.com`) where the first path segment must match too. Flip the `it.fails` "QA-02" to `it`. Brief: amend AC-2 to say so. | 30 min |
| QA-03 | P1 (P0 once `KVK_API_KEY` is set) | With the KvK lookup on, a single KvK-only candidate looks like "nothing listed" to `route.ts:107` (no `placeId`, no `website`), so a website identity takes that KvK business without a click: the name decides. `prepareBusiness` then stores the typed website on it, because the SEC-01 guard checks `existing?.kvk` but not `candidate.kvk` for a new business: also breaks amended AC-6 ("never on a business … the KvK lists"). Not reachable today: `KVK_API_KEY` is optional and not set (`docs/launch-todo-2026-10-26.md:20`). | Probe (MemDb-free vitest, removed afterwards): `KVK_API_KEY=probe`, Places key empty, `fetch` stubbed with one KvK result "Voila Damesmode, Hoogstraat 12, 3011AB" → `resolveBusiness("Vidalo","Rotterdam")` returned one candidate with `placeId:null, website:null, kvk:"12345678"`; route line 107's condition is true for it. `resolve.ts:198-215` (KvK candidates always `website: null`); `onboard.ts` `listed = Boolean(existing?.googlePlaceId \|\| existing?.kvk)`. | `route.ts:107`: add `&& !candidates[0]!.kvk` (or test `candidates[0]!.source !== "kvk"`). `onboard.ts`: `const listed = Boolean(existing?.googlePlaceId \|\| existing?.kvk \|\| candidate.kvk);`. Add a case to `unlisted-website.test.ts` with a KvK-only candidate. | 15 min |
| QA-04 | P2 | The most natural Dutch way to write it, street first (`Factorij 80, 3071 AV`), and `3071 AV nr. 80` / `3071-AV 80` are refused with `fout=herken`. Safe (the visitor is asked again, never guessed) but costs a round trip and retyping. | `business-identity-qa.test.ts` "refuses what it cannot read…". | Also accept `<street> <n>[suffix], <dddd> <XX>` and an optional `nr.`/`no.` and a hyphen between digits and letters: try a second regex `/(\d{4})\s*-?\s*([a-z]{2})\b/i` for the postcode anywhere plus the number next to it, before the website parse. | 30 min |
| QA-05 | P2 | When the form comes back with `fout=herken` (or `fout=mail`), the e-mail address the visitor already typed is gone; with both missing only the mail error shows, and the identity error comes on the second try. | `kies/page.tsx` renders `ScanField` without `defaultEmail`; `route.ts:72` checks the address before the identity at `:78`. | Check both, redirect once with `fout=mail,herken` (or two flags) and mark both fields. Prefilling the address would need it in the URL or the cookie; the cookie is the right place (set it on `backToField` when the address was valid). | 1 h |
| QA-06 | P3 | `requester` now carries `identity` (from the cookie) into `requestConfirmation` / `startFreeCheck`. Safe today only because both build their payloads field by field; one future `...requester` would write a home address into an event. | `route.ts:69` `requester = … cookie`; `scan-confirm.ts:63`, `free-check.ts:40`. | `const requester = … ? { email: cookie.email, marketing: cookie.marketing } : …` so the identity never travels beyond the route. | 5 min |
| QA-07 | P3 | A Belgian or other foreign business without a website cannot pass the form at all (the identity is Dutch postcode or website). By design per the brief, but nothing on the page says so. | `business-identity.ts:13` comment; EN error text mentions "Dutch postcode". | Hint EN/NL: "Not in the Netherlands? Give your website." Or accept a KvK number (compliance CMP-07). | 15 min |

## Tests added (keep them)

- `packages/core/test/business-identity-qa.test.ts`: AC-2 edge forms, AC-7 privacy/cookie text, AC-8 copy in both
  languages, and the open findings as `it.fails` (QA-01 ×2, QA-02). These pass while the bug is there; when the fix
  lands they go red and must become `it`.
- `e2e/scan-identity.spec.ts`: AC-1, AC-3, AC-4 (typed identity website used), AC-5, AC-6 (URL, cookie flags, no
  echo), AC-8 (aria, axe NL + EN), `@mobile` 375 px. Run:
  `DATABASE_URL= E2E_PORT=3119 pnpm exec playwright test e2e/scan-identity.spec.ts --workers=1 --reporter=line` (8/8).

## Not tested, and why

- **Real Google Places answers.** Mock mode only; no Places key in the test env and no spend without Julian. The
  street-line format (`formattedAddress` up to the first comma) is read from `resolve.ts:114`, not observed live.
  QA-01 rests on that format.
- **"Before any lookup" as an observed fact.** Mock lookups leave no trace; it is shown by line order only.
- **Turnstile on.** All runs had Turnstile off (keyless env). Order relative to the bot check is by code reading.
- **Real mail confirmation, Workers build, PgDb.** Out of scope for this change; feature 004's tests cover the link.
- **Double submit / back button on `/scan/kies`.** Unchanged by this feature (same lock and token as before); not re-run.
- **Concurrency.** Nothing here allocates capacity or money beyond the existing caps under `FREE_CHECK_LOCK`.
- **Gate mode** (`E2E_MODE=gate`). Not re-run; `route.ts` still returns `/binnenkort` before reading the form.

## Round 2: AC-9 (17 Nov 2026)

Scope: AC-9 only (namesake line, `copy.result.namesake`), uncommitted diff on `claude/namesake-line`.

**Result: AC-9 passes.** No P0. One test gap closed in this round (the mail's wiring had no test that could go red,
see C3/C4); one remaining wiring gap on the page loader (QA-R2-05), and smaller findings.

### Acceptance

| AC | Result | Evidence |
|---|---|---|
| AC-9 line on the report page and the free-check report mail of a local business Google does not list, NL + EN; not for a listed business, a demo, or an online business | **pass** | Page: `apps/web/lib/report.ts:541` `namesake: opts.notListed && !online`, `page.tsx:54` `notListed: !!business && !business.googlePlaceId`, rendered at `page.tsx:147` (`data-testid="namesake"`). Mail: `templates.ts:458` `d.notListed && !online`, `reporter/index.ts:232` `notListed: !business.googlePlaceId`. Tests: `report-namesake.test.ts` (local unlisted NL + EN shown; listed, demo, online not), `namesake.test.ts` (mail NL + EN shown; online, listed not), `namesake-wiring.test.ts` (new this round: a stored local unlisted business through `runScan` → `buildReport` → view, and through `sendBaselineSummary` → .eml, both carry the line; the same business with a place id, neither does), e2e `free-check.spec.ts` smoke (listed → 0), "a name alone…" (neutral unlisted → grey note, 0 namesake), `scan-identity.spec.ts` AC-4 (online unlisted → 0). Runs: core 102 files / 1472 tests green, `pnpm -r typecheck` green, Playwright `free-check` + `scan-identity` 20/20. |

### The questions asked

- **Is `business.googlePlaceId` the right signal?** Yes, and it is the same signal the scan itself uses:
  `understandInputFor` sets `listing: business.googlePlaceId != null` (`understand.ts:362`), so "not listed" for the
  line means what it meant for the questions. Page and mail both read the current business record. Caveat
  QA-R2-02: it is today's record, not the record at scan time.
- **Is the page's `online` the mail's `nf.online`?** Yes. Page: `report.profile?.mode === "online"` on
  `getScanReport` = `buildReport(scanRunId)` (`apps/web/lib/core.ts:147`). Mail: `isOnlineProfile(r.profile)` on
  `buildReport(scanRunId)` in `notFoundStats` (`reporter/index.ts:126`); `isOnlineProfile` is the same comparison
  (`types.ts:342`). Both rebuild from `scan_run.profile`. They differ only when `notFoundStats` throws (QA-R2-03).
- **Duplicate with the grey "Google kent je bedrijf niet en we vonden geen website" note?** No. That note is
  `checkedAs.neutral`, shown for `isNeutralProfile` = `source "fallback" && mode "online"` (`types.ts:193`), and the
  `!online` guard drops the namesake line in exactly that case, on page and in mail. Seen in e2e "a name alone…"
  (grey note visible, `namesake` count 0).
- **KvK-only businesses?** A KvK candidate has `placeId: null` (`resolve.ts:205`), so `notListed` is true. But KvK
  candidates never carry a website (`resolve.ts:207`) and a typed website is refused for them (`onboard.ts`
  `listed … || candidate.kvk`), so their profile is the neutral fallback (`decideMode`: no listing, no model → online)
  and they get the grey note, not the namesake line. Only a KvK-only business with an earlier grounded
  `profile_auto` would show it. Right by the AC's letter (Google does not list it). KvK is not live (`KVK_API_KEY`
  unset).
- **Other mails that summarise a report?** Follow-up day 7/21: yes, it should (QA-R2-04). Monthly report: no; it goes
  to a verified owner, and verification needs a Google place id (`shared/ownership.ts`), so an unlisted monthly
  customer exists only through manual support verification.
- **Mail lab** (`DATABASE_URL= pnpm mail:lab`: OK, 0 problems): 9 baseline mails in `out/mail-lab/mails.json`, none
  carries the line. Correct for all of them (listed locals, and the online `vloedlijn`/`tonic`/`zeilmaker` journeys,
  which are unlisted and must not show it). The lab has no local unlisted journey, so the line is never seen there
  (QA-R2-01).

### Controls (each guarantee broken on purpose, then restored)

| # | Guarantee | Test that went red | What I did to break it |
|---|---|---|---|
| C1 | Mail shows the line | `namesake.test.ts` "is there…", `namesake-wiring.test.ts` "a local business…" | `templates.ts:458` → `false && d.notListed && !online` |
| C2 | Mail drops it for online | `namesake.test.ts` "is not there for an online business", `mail-online.test.ts` "the free-check mail goes to the asker…" (LOCAL_WORDS hits "Google") | removed `&& !online` |
| C3 | Mail wiring passes "not listed" | `namesake-wiring.test.ts` "a local business…". **Without the new test: 30/30 green** | `reporter/index.ts:232` → `notListed: false` |
| C4 | Mail wiring drops it for listed | `namesake-wiring.test.ts` "the same business with a Google listing". **Without the new test: 30/30 green** | → `notListed: true` |
| C5 | Page shows the line | `report-namesake.test.ts` "is there…", `namesake-wiring.test.ts` | `report.ts:541` → `namesake: null` |
| C6 | Page drops it for online | `report-namesake.test.ts` "is not there for an online business" | removed `&& !online` |
| C7 | NL copy | `namesake.test.ts`, `namesake-wiring.test.ts` | NL namesake text → "Kent dit bedrijf niet. …" |
| C8 | EN copy is English | `namesake.test.ts`, `report-namesake.test.ts` | `en.ts` namesake → the Dutch sentence |
| C10 | Page loader drops it for listed | e2e `free-check.spec.ts` smoke: `getByTestId("namesake")` expected 0, received 1 | `page.tsx:54` → `notListed: true` (two runs first failed on a cold dev server, `ERR_CONNECTION_REFUSED`; the third failed on the assertion) |
| C11 | Page loader passes "not listed" | **nothing went red** (3/3 green) | `page.tsx:54` → `notListed: false`. See QA-R2-05 |

After the controls, `git diff -- apps packages e2e docs/features/005-scan-identity/01-brief.md` was compared with a copy
taken before (`cmp`): identical. (`compliance.md`, `security.md` and `docs/process/checklists/compliance.md` changed
during the round; that is the concurrent compliance/security work, not QA.)

### Findings

| ID | Sev | Claim | Evidence | Proposed fix | Cost |
|---|---|---|---|---|---|
| QA-R2-01 | P2 | The mail lab never shows the namesake line, so nobody reviewing mails sees it. | `out/mail-lab/mails.json`: 9 `baseline` mails, 0 with "Google kent dit bedrijf niet" / "Google does not know this business". `scripts/mail-lab.mts` journeys: listed free, online, paid. | Add a journey in `scripts/mail-lab.mts` `journeys()`: `prepareBusiness({ name, place, candidate: { ...mockCandidate(name, place), placeId: null, kvk: null }, website: "https://www.<slug>.example", db })`, then `db.setAutoProfile(id, { mode: "door", …, basis: ["website"], source: "auto", grounded: true })` (as `namesake-wiring.test.ts` does), `runScan` free, enqueue `baseline`; card label "Report after the free check, not on Google"; the lab's own check asserts `copy.result.namesake` in its text. | 30 min |
| QA-R2-02 | P2 | The signal is the business record now, not at scan time. A business first checked as "not listed" whose slug is later checked through a Google candidate gets `googlePlaceId` set (`onboard.ts:55` `existing?.googlePlaceId ?? candidate.placeId`); from then on the old report page drops the line while the mail sent for it carried it. | `onboard.ts:55`; `page.tsx:54` and `reporter/index.ts:232` read `business.googlePlaceId` at render/send time. | Keep the scan-time fact with the run: add `listed: boolean` to the profile summary stored on `scan_run.profile` (from `understandInputFor(...).listing` in `ensureProfile`), expose it on `ScanReport`, use `!report.listed` in `page.tsx` load and in `sendBaselineSummary`; runs without it fall back to `!business.googlePlaceId`. | 1–2 h |
| QA-R2-03 | P3 | If `notFoundStats` throws, the mail gets `online: undefined` → false, so an online unlisted business's mail shows the namesake line (and the other local wording) while its page does not. Existing degraded path, logged as `reporter.not_found_stats_failed`. | `reporter/index.ts:127-130` returns `null`; `:246` `online: nf?.online`. | `online: nf?.online ?? isOnlineProfile(run.profile)` in `sendBaselineSummary` (same in `sendMonthlyReport`). | 10 min |
| QA-R2-04 | P2 | The day-7/21 follow-up quotes one wrong answer as an example to a free-check business; for an unlisted local business that example may be about a namesake and the mail does not say so. Outside AC-9's letter (it names the report mail only). | `reporter/index.ts:355-395` `sendFollowUp` builds `example` from findings and passes no `notListed`; `followUpEmail` has no such field. | Pass `notListed: !business.googlePlaceId` (with the existing `online: isOnlineProfile(lastRun?.profile)`); in `followUpEmail` add `...(d.notListed && !d.online ? [{ kind: "note", text: C.result.namesake }] : [])` after the example block; one case each way in `namesake.test.ts`. Monthly report: not needed (verified owners have a place id). | 30 min |
| QA-R2-05 | P2 | The page loader's `notListed` has no test that goes red when it is switched off (C11 green). The positive case cannot be reached in e2e: `mockUnderstand` returns the neutral fallback for every unlisted business without an online keyword (`understand.ts:228-231`), so in mock mode an unlisted local business is always neutral and the line is always (rightly) suppressed. The spec comments point at each other: `scan-identity.spec.ts` says the local case "is in free-check.spec", `free-check.spec.ts` says it is in `report-namesake.test.ts`; neither runs the page loader for it. | C11 above. | Move the expression into `apps/web/lib/report.ts` as `export const notListedOf = (b: { googlePlaceId: string \| null } \| null) => !!b && !b.googlePlaceId;`, call it from `page.tsx:54`, use it in `namesake-wiring.test.ts` instead of the copied expression; point the `scan-identity.spec.ts` comment at `namesake-wiring.test.ts`. | 15 min |
| QA-R2-06 | P3 | The grey neutral note does not mention namesakes, though an unlisted business with no website is the case most exposed to them (answers shown unjudged). Not a duplicate problem; a wording choice for Julian. | `copy/index.ts` `checkedAs.neutral.how`. | If wanted, one clause in `neutral.how` NL + EN: "… je ziet wat AI zegt, en dat kan over een naamgenoot gaan." | 10 min |

### Tests added this round (keep them)

- `packages/core/test/namesake-wiring.test.ts` (untracked, not committed): the line through `runScan` → `buildReport`
  → `buildReportView` and through `sendBaselineSummary` → the written .eml, for the same local business without and
  with a place id. The only test that goes red for C3 and C4.

### Not tested, and why

- **The line on a real report page for an unlisted local business** (browser, NL/EN, 375 px). Not reachable in mock
  mode (QA-R2-05); copy, element and placement checked at view level and by reading `page.tsx:147`. The paragraph is
  `max-w-[56ch]` text with no fixed width.
- **Real understanding of a typed local website** (OpenAI). Mock only; the wiring test stores the profile the real
  model would return.
- **Paid (`kind: full`) reports and their baseline mail.** The line is kind-agnostic in both places; not run.
- **PgDb.** `googlePlaceId` is mapped in `pg.ts:73`; not run against Postgres this round.
