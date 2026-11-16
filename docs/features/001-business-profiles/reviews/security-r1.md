# Security verification, round 1: 001 Business profiles

*security agent (Claude) · phase 4 (verify), round 1 · 2026-11-15 (night run started 2026-11-14 23:15 UTC) ·
branch `claude/verify-2026-11-15-001-business-profiles`. The feature code was read as merged in
`a8a7150..d6966c8` (PR #120, #127). The branch HEAD is `7945202`: `main` (`1cf3de5`) plus one QA test commit.
Checked against `checklists/security.md` (S-01..S-40), ADR 0007, `04-build.md` and the standing list.*

Nothing touched the hosted Supabase project, Stripe, Cloudflare or any mail. I edited no application code and
no migration. Every scratch control was put back with `git checkout --`, and the probe test files were
deleted after each run.

**What I ran myself**
- Core tests: `understand`, `typed-website`, `profile-contract`, `scan-progress`, `profile-correction`,
  `online-questions`, `question-library`, `mail-online`, `report-online`: **240 passed**.
- A throwaway PostgreSQL 16.15 on port 5561 in the scratchpad (stopped afterwards).
  - Database `sec001`: shim plus migrations 0001..0019, then `TEST_DATABASE_URL=… npx vitest run
    --no-file-parallelism test/db-profiles.test.ts test/question-library.test.ts`: **64 passed** (PgDb
    cases included).
  - Database `sec001s`: Supabase-style default privileges (`alter default privileges in schema public grant all
    on tables/sequences/functions to anon, authenticated, service_role`) set **before** the migrations, then a
    rolled-back `DO` block (`scratchpad/sec/rls-run.sql`). Result: `owner_qu=1 anon_qu=denied anon_lib=denied
    anon_ins=denied anon_biz=denied anon_upd=denied A_qu=denied A_lib=denied A_seesA=1 A_seesB=0
    A_seesRunB=0 A_seesRunA=1 A_updA=0 A_updB=0 A_updRuns=0 pwned_rows=0`. Control (`rls-ctl.sql`, the
    same block plus `grant select on question_use to anon`): `anon_qu=0`, so the assertion turns red.
- Scratch controls. Each guarantee was removed, the test went red, and the file was restored:
  - the redirect re-check in `fetchPublicText` (`util.ts:236`, re-check replaced by a bare `new URL`): 1 red,
    "none after a redirect to one";
  - NFKC replaced by NFC in `sanitizeSlot` (`slots.ts:29`): 1 red, "refuses fullwidth markup and URLs".
- Probes (temporary vitest files in `packages/core/test/`, deleted after each run):
  - SSRF address forms: IPv4-compatible, NAT64, 6to4, nip.io and others.
  - The redirect chain.
  - `sanitizeSlot` timing with NFKC-expanding input (100,000 x U+FDFA: 3 ms; 100,000 x `a-`: 1 ms).
  - The deep keys of `scanStatusBody`.
  - DB calls for junk tokens.
  - Timings of `namedBusinesses` and `redactContacts` on 100 KB hostile inputs (all at most 32 ms).
- Hidden characters: `perl -CSD` over every file in the diff (see S-38).

**Not run:** the web build and bundle grep (S-37); Playwright; any `next dev` (QA's lane); the hosted
project.

## Item by item

| S | Status | Evidence |
|---|---|---|
| 01 | PASS | `prompts/slots.ts:24-32`: bidi refused, then NFKC, then Cc/Cf/zero-width/soft hyphen stripped, before any test at `:38-40`. Tests are in `understand.test.ts:658-673` (zero-width, soft hyphen, bidi, fullwidth `<`, fullwidth `://`). My control: NFKC to NFC gave 1 red. |
| 02 | PASS | `slots.ts:26-28` caps the raw text at 4x the limit before any regex. Committed timing test `understand.test.ts:675`. My probe: 100,000 x `a-` took 1 ms; 100,000 x U+FDFA (NFKC expands it 18x) took 3 ms. |
| 03 | MOOT by ADR 0007 | ADR 0007 lines 62-63: "Security checklist items on the lookup (S-03 place in the lookup …) fall away". There is no lookup call. The place is still sanitised before the classification (`understand.ts:294-295`), and test `:400` checks it. |
| 04 | PASS | `shared/typed-business.ts:8-26` (120 and 80 characters, markup also after NFKC, Cc/Cf). `api/scan/route.ts:56` checks it before the e-mail check (`:58`), Turnstile (`:66`) and Places (`:71`), and before any `logEvent`. The route has no unit runner. Test `understand.test.ts:685-704`. |
| 05 | MOOT by ADR 0007 | ADR 0007 Decision 1: "The AI lookup is removed". `understand.ts` has no `responses.create`. Test `:392` checks that there is no `responses` member. |
| 06 | PASS | `understand.ts:196-216` `classifyRequest`: no `tools` and no `tool_choice`, strict `json_schema`, `max_tokens: 400`. The system message is fixed apart from `lang`. Untrusted text appears only in the `JSON.stringify`-ed user message. Site text is cut to 4,000 characters (`:299`). Zod caps every string (`:150-157`). Competitors are gone (ADR 0007 point 5). Tests `:511`, `:541`, `:589`. |
| 07 | PASS | `understand.ts:322-349`: every string goes through `sanitizeSlot`. A refused offer or category means `low`, which falls back and is not stored. `website` is `knownHost` of the page that was read, never the classifier's field. Tests `:560`, `:576`. |
| 08 | PASS | Questions are built only by `fillTemplate` with `slotValue`s (`prompts/profile.ts:155-195`). Previous `others` go through `slotValue(raw,"competitor")` (`:83`). My grep of `profile\.(offer|audience|category|competitors)` in `src/prompts`: one hit (`profile.ts:65`), which is then sanitised at `:83`. |
| 09 | PASS (by reading) | `extract.ts:530`: `profiel` carries `facts.profile.offer/category`, which are sanitiser or owner-parser output. The extraction call has no `tools`. The request-body test the item names does not exist. |
| 10 | PASS | Page text stays inside `understandBusiness`. Log lines: `profile.understand_failed {reason}`, `profile.store_failed {scanRunKind}`, `profile.log_failed {}` (`understand.ts:287,394,400`). `profile.decided` key set: `:398`, test `:744`. |
| 11 | PASS as listed, gaps filed | `util.ts:180-243`: http(s) only, no credentials, no localhost/.internal/.local, every listed range, `redirect:"manual"` with the check repeated on every hop, at most 3 redirects, 8 s, 300 KB. Tests `understand.test.ts:604-642`. My control on the hop check gave 1 red. Beyond the list, see **V1-SEC-02** (IPv4-compatible, NAT64 and 6to4 literals on hops; names that resolve to private addresses). |
| 12 | MOOT by ADR 0007 | There are no citations to fetch (ADR 0007 Decision 1, test `:598` "reads one page"). The ADR's own numbering is off: it calls the citation-host rule "S-11" (line 63). |
| 13 | PASS | `htmlToText` was rewritten linear (`util.ts:163-176`). Timing test `understand.test.ts:645`: 300 KB of `<script`, `<`, `<br` and whitespace each under 200 ms. |
| 14 | PASS | One classification per non-recheck `runScan` (`scanner/index.ts:258-264`). A recheck skips the step (test `:721`). An owner profile skips it on paid kinds (`understand.ts:384`, test `:265`). Refused input makes no call (`:249`, `:400`). The reuse path returns before any scan (`route.ts:118-125`). |
| 15 | PASS | `ensureProfile` catches the store, the log and every model failure (`understand.ts:390-401`). Tests `:166-247`. |
| 16 | PASS | `understandBusiness` has one caller, `ensureProfile` (`understand.ts:386`). `ensureProfile` has one caller, `runScan` (`index.ts:262`). The cost is added to the run: test `:707`. |
| 17 | PASS | `understand.ts:283`: the mock runs only on `VIDALO_MOCK === "1"`. No client means fail `no_client`, and nothing is stored. Tests `:357`, `:369` (the real-mode fallback candidate has `website: null`). |
| 18 | PASS | `profile.ts:112-113,166-188`. Free: 3 + 2 + 1 = 6. Full: 4 + phone + 4 + 1 + at most 3 competitors (`:89`) = 13. Tests `online-questions.test.ts:133,187`. |
| 19 | PASS (local); hosted not verified | `0015:94-97,101-107`. My `DO` block on a database with Supabase-style default privileges: anon and authenticated get `denied` on select and insert of `question_use` and on select of the view. The owner sees the row (control), and the `grant select … to anon` control goes red. Hosted project: not checked live, needs the Supabase connector or the project's service key (P2). |
| 20 | PASS (local); hosted not verified | Only SELECT policies exist (`member_business`, `member_scan`). Owner A updating `profile_owner` on A or B: 0 rows. Updating `scan_run.profile`: 0 rows. A sees B's business and run: 0. Anon: denied. Hosted: as for S-19. |
| 21 | FAIL (P2) | `0015:26-66`: the CHECKs cover mode, the three string lengths and a character class only. There is no per-element check on `competitors`, no check on `website` (length or `/@ `), and no enum check on `source` or `confidence`. Today the code never writes a bad value there (`website` is a normalised host, `competitors` is `[]` or a copy), so the backstop is missing but no exploit exists. **V1-SEC-05**. |
| 22 | PASS | `prompts/library.ts:102-111` `templateTextOf` returns the code template text or `Vraag over {category}`. It does no replacement at all, so there is no RegExp from a name. `0015:78-92` has no name, place or fact column. Test `question-library.test.ts:355` (deletion leaves no name, offer or policy). |
| 23 | PASS | Retirement needs at least 10 distinct `business_ref` (`04-build.md:197`, view `count(distinct business_ref)` at `0015:104`). PgDb test "one visitor running many free checks on one business cannot promote or retire a template" passed in my run. Residual risk: 10 made-up unlisted businesses, each grounded by an attacker page (see V1-SEC-01), can still retire an online template in one category. This is accepted by the threshold design, not a new finding. |
| 24 | PASS | `gegevens/actions.ts:123-132`: `requireVerifiedOwnerOf(businessFromForm(form))`, then `correctProfile` on the business returned from `listMyBusinesses(session)` (`lib/owner.ts:36-50`). The form's id only selects among the caller's own businesses: the 002 membership rule (F-020) replaces "session only". Signed-out and unverified requests are not exercised by a test (`04-build.md:313`); `profile-correction.test.ts` covers two businesses. |
| 25 | PASS | `parseOwnerProfile` trims and checks the length before `sanitizeSlot` (`understand.ts:59-62`). `parseProfileError` maps to a fixed field and reason pair or null (`shared/profile-correction.ts:25-30`). The page passes only that pair (`ProfileGroup.tsx:20`). |
| 26 | PASS (config) | A server action (Next checks Origin against Host). `next.config.ts:63` sets only `bodySizeLimit`, with no `allowedOrigins`. The `curl` with `Origin: https://evil.example` was not run: no dev server in my lane. |
| 27 | PASS | `profile-correction.ts:17` logs `{from,to}` modes only. Test `profile-correction.test.ts:32`. |
| 28 | PASS | `understand.ts:384`: a free check never uses `profileOwner`. Test `understand.test.ts:276` "is not used for a free check by anyone (S-28)". |
| 29 | FAIL (P2) | `progress.ts:66-75`: the top-level keys are an allow-list, but `profile`, `questions` and `engines` are passed through as stored (`readScanState` copies `p.profile` as is, `:58`). My probe: a stored profile with `website` and `competitors` and a question with `businessId` come out unchanged in the body. No writer adds such keys today (`profileSummary` has 5 keys; questions are `{id,text}`). **V1-SEC-04**. |
| 30 | FAIL (P2) | There is no token format check: `status/route.ts:17` calls `getScanState(id)`, and `businessIdFromToken` (`progress.ts:41-45`) accepts any string with `_` or `.`. My probe: `x_y` and a 5 KB token each made a `listEvents` call (2 calls, only `abc` made none). On PgDb, `business_id = 'x'` raises `invalid input syntax for type uuid` (seen on my cluster), so a junk token is a 500 that still opened a pooled connection. **V1-SEC-03**. |
| 31 | PASS | `profile.ts:183`: competitor questions only `if (!free)`. Free uses `online.alt.self` only. Test `online-questions.test.ts:133`. |
| 32 | PASS | `grep -rnE "dangerouslySetInnerHTML\|innerHTML" apps/web/app apps/web/components apps/web/lib` shows the same three hits as before (`feiten/page.tsx:50`, `feiten/[slug]/page.tsx:45`, `lib/seo.tsx:134`). `ScanProgress.tsx` renders text only. The noscript link uses `localizeHref('/scan/'+encodeURIComponent(id))`. FE-01's Playwright check (`04-build.md:179`) was not re-run. |
| 33 | PASS | Same grep: no new raw HTML. `QUOTE_MAX = 240` in core (`recommendations.ts:77`). Source links on `/r/[id]` (`page.tsx:321`) existed before this feature. `report-online.test.ts` passed. |
| 34 | PASS | `mail-online.test.ts` (24) passed in my run. The builder's control "HTML escaping off" went red (`04-build.md:360`), and the mail lab uses a hostile name (`Tonic & "Co" <b>Music</b>`). I did not run the lab again. |
| 35 | PASS (by probe) | Caps exist before the regexes: slots `:26`, `redactContacts` slices to 8,000 (`understand.ts:142`), page text 4,000, HTML 300 KB. My 100 KB probes on `namedBusinesses`, `redactContacts`, `mentionsBusiness`, `normalizeName` and `detectOtherEntity`: all at most 32 ms. Committed timing tests exist only for `sanitizeSlot` and `htmlToText`. |
| 36 | PASS | The only new `new RegExp(` in the diff is the code-held instruction list (`slots.ts:15`). No RegExp is built from a name, place, offer or competitor. |
| 37 | NOT VERIFIED | No build was run (it needs `fonts.googleapis.com` and the budget). Client components import only copy, types and `SECTOR_LIST` (`gegevens/FactsForm.tsx:5`). Lead: `prompts/index.ts:23` now re-exports `./profile`, which imports `scanner/extract`, which holds a dynamic `import("./engines/chatgpt")` (`extract.ts:523`). That chunk may now be emitted into `.next/static`. It would hold no secret, only the SDK and `api.openai.com`. **V1-SEC-07**. |
| 38 | FAIL (P2) | Literal soft hyphen, zero-width and BOM characters (a raw class `U+00AD U+200B-U+200F U+2060-U+2064 U+FEFF`) at `shared/typed-business.ts:13`, `shared/typed-website.ts:15`, `test/typed-website.test.ts:37`, `test/understand.test.ts:660-663,671,694,695` and `checklists/security.md:30,33,34`. The standing `grep -rP '…\x{200b}…'` exits 2 here ("code point value … too large") because the locale is not UTF-8, so it reports nothing. **V1-SEC-06**. |
| 39 | PASS | New log and event lines (diff grep): `library.retired {category, mode, templateKey}`, `library.record_failed {scanRunId}`, the profile events above. No free text, address or OpenAI error body. |
| 40 | PASS | `git diff --stat a8a7150^..d6966c8` touches nothing under `billing`, `api/checkout`, Stripe or `apps/worker/src`. `correctProfile` enqueues nothing (`profile-correction.ts:12-19`). |

**Counts:** PASS 32 (S-19 and S-20 are local only), FAIL 4, MOOT 3, NOT VERIFIED 1.

## Beyond the list

- **Typed website on `/scan/kies`.** `parseTypedWebsite` (`typed-website.ts:20-37`) applies when the
  candidate is unlisted and `pick != null` (`route.ts:86-95`). It allows only http(s), at most 200 characters,
  no credentials, no IP literal, a host with a dot, and port 80 or 443. The query is dropped and the value is
  never echoed. It is not given to the unguarded `scrapeSite` (`onboard.ts:62-64`). Integrity gap:
  **V1-SEC-01**.
- **SSRF:** gaps on redirect hops and DNS (**V1-SEC-02**).
- **The classify call and untrusted text:** S-06 and S-07. Contacts are redacted before the call
  (`understand.ts:139-144`).
- **`saveProfile`:** S-24.
- **Status allow-list:** S-29 and S-30.
- **Rendering:** no `dangerouslySetInnerHTML` on `/r/[id]` or the waiting page (S-32, S-33). The report's
  website source row now carries `facts.website`, which can be visitor-typed (`lib/report.ts:430`). It is
  http(s) only by construction and React-escaped.
- **Mail:** S-34.
- **The ledger holds no personal data.** Template text comes from code, the category is a sanitised slot,
  and `business_ref` is a random uuid on the business row only (`0015:17-20`).
  `business.question_ref` is readable by a member through `member_business`. That is harmless: it matches
  only ledger rows, which no Data API role can read (my DO block).
- **Cost.** A visitor can make each free check spend at most one classification (about 0.1 cent) more than
  before, and only when a listing or a page naming the business grounds it. The lookup is gone, so the step
  is cheaper than the design. Everything sits behind the existing free caps (`route.ts:101,128-135`). The
  typed website adds at most 4 outbound GETs (1 + 3 redirects) per check, with no spend. `/scan/kies`
  fetches nothing new.

## Findings

| ID | Sev | Lane | Claim and evidence | Fix | Cost |
|---|---|---|---|---|---|
| V1-SEC-01 | P2 | backend | **The first visitor's typed website sticks to an unlisted business and grounds its profile.** (1) Pick a business Google does not list that has no check yet. (2) Host a page on `evil.example` that names it and describes it as something else. (3) Run a free check and type `evil.example` (needs an e-mail address and Turnstile). (4) `onboard.ts:64` stores it as the provisional `facts.website`. `understand.ts:298-300` reads it, the page names the business, and the profile is grounded and stored in `profile_auto` (`:388-390`). (5) Every later check of that business, the real owner's free check included, keeps it: `onboard.ts:65` ignores a new typed website once `facts.website` is set. The profile is reused (`:391-393`). For an online profile, `online.website` answers are judged against the attacker's host (`compare.ts:158`, by reading, not run end to end), and the report's website row links to it. This is report integrity, not data. It lasts until the owner confirms facts. | Keep a typed website per check (on the scan run, or replace a provisional website with the latest typed one) and do not reuse a `profile_auto` grounded only on a typed site for another requester; or ground it only once the owner confirms. Test: two free checks with different typed sites, and the second report uses the second. | 1-2 h |
| V1-SEC-02 | P2 | backend | **The SSRF guard misses embedded-IPv4 IPv6 forms and hostnames that resolve to private addresses, on redirect hops.** Probe: `isPublicHttpUrl` accepts `http://[::7f00:1]/` (IPv4-compatible `::127.0.0.1`), `[64:ff9b::a9fe:a9fe]` (NAT64 for 169.254.169.254), `[2002:7f00:1::]` (6to4), `198.18.0.1` and `127.0.0.1.nip.io`. `parseTypedWebsite` refuses the literals at the boundary, but hops use only `isPublicHttpUrl` (`util.ts:236`). A typed public site that 302s to `127.0.0.1.nip.io`, then to `[::7f00:1]`, was followed through 4 requests in my probe. Production runs the scan in `vidalo-worker` on Workers, which cannot reach private networks. A Node run (local web `after()` with real keys, `pnpm scan`) can. `04-build.md:280` already notes the DNS part. | In `privateAddress`, decode `::/96`, `::ffff:0:0/96`, `64:ff9b::/96` and `2002::/16` to their IPv4 and check it. Add `198.18/15`, `192.0.0/24` and `240/4`. Refuse IP literals on every hop, as at the boundary. For Node, resolve and check the addresses (or pin with an undici `lookup`). Tests for each form, as a hop. | 1-2 h |
| V1-SEC-03 | P2 | frontend (route) + backend | **The status endpoint opens a DB query for junk tokens, and on Postgres throws a 500 (S-30).** Probe: `x_y` and a 5 KB token each call `listEvents`. `select … where business_id = 'x'` raises `invalid input syntax for type uuid`. The endpoint is unauthenticated and polled every 2 s, so it counts against the pool. | Check `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[_.][0-9a-f]{12}$` in the route (or `businessIdFromToken`) before `getScanState` and return 404 with no query. A route-level test with a DB spy. | 30 min |
| V1-SEC-04 | P2 | backend | **`scanStatusBody` passes the stored `profile`, `questions` and `engines` objects through (S-29).** Probe: extra keys (`website`, `competitors`, `businessId`) in the stored state reach the body. No current writer adds them, so nothing leaks today. Any later field on `ProfileSummary` or the questions, or an old event, would. | Rebuild each nested object from its named fields (`{mode, offer, audience, category, source}`, `{id, text}`, `{engine, received, expected}`). Add a deep key-set test with a state that carries extras. | 20 min |
| V1-SEC-05 | P2 | db | **The profile CHECKs do not cover `competitors` elements, `website`, `source` or `confidence` (S-21).** `0015:26-66`. The code writes only safe values today, so this is a missing backstop, not an exploit. | A new migration (0020) adding `jsonb_path` or element checks (at most 60 characters and the same class for each competitor), `website` at most 253 characters with no `/`, `@` or space, and `source` and `confidence` enums. PgDb tests plus a 1,000-output property test. | 1 h |
| V1-SEC-06 | P2 | all | **Literal hidden characters in source, tests and the checklist (S-38).** The lines are listed at S-38. They are harmless where they sit (inside character classes that `\p{Cf}` already covers), but the standing grep misses them in a non-UTF-8 locale (exit 2). No CI step runs it. | Replace them with `\u` escapes. Add a CI step that runs the grep with `LC_ALL=C.UTF-8` (or `perl -CSD`) and fails on exit 1 **or** 2. | 30 min |
| V1-SEC-07 | P2 | frontend | **Possible: an OpenAI SDK chunk in the client build through the prompts barrel (S-37 lead).** Evidence is the import chain only: `FactsForm.tsx:5`, then `prompts/index.ts:23`, then `profile.ts:9`, then `extract.ts:523` dynamic import. There is no build to confirm it. It would hold no secret. | Import `SECTOR_LIST` from a leaf module (`@vidalo/core/prompts/sectors` export) in client code, then run the S-37 build grep with `DATABASE_URL=` empty. | 30 min plus a build |

**P0 claims: none.** No path reaches another customer's data or money. The ledger and view deny the Data API
roles, the owner action selects only among the caller's businesses, and the model that reads untrusted text has
no tools.

## Not verified

- S-19 and S-20 on the hosted project `bbynmqvaxpjdnkaasutd`: not checked live, needs the Supabase connector
  or the project's service key. Migration 0015 is not applied there (`04-build.md:105,250`). The anon-key
  `curl` and `get_advisors` were not run either.
- S-37 bundle grep: no build run. See V1-SEC-07.
- S-26 cross-origin `curl` against a running dev server, and S-32 Playwright: QA's lane, no server of mine.
- S-24: signed-out and unverified posts to `saveProfile` are proven by reading only (no test).
- A real run of the understanding step against OpenAI and live websites (ADR 0007 asks for one per release),
  and a Cloudflare Workers run of `fetchPublicText`.
- V1-SEC-01's judged-wrong effect on a real report: by reading `compare.ts`, not run end to end.

## General lessons (for `docs/process/checklists/security.md`)

- The standing hidden-character `grep -rP '…\x{200b}…'` exits 2 ("code point value too large") and prints
  nothing when the locale is not UTF-8. Here it hid 13 lines with literal U+00AD, U+200B and U+FEFF. Run it with
  `LC_ALL=C.UTF-8` (or `perl -CSD`) and treat exit 2 as a failure.
- A visitor-supplied value that is stored as a provisional fact, first writer wins, is a fact for every later
  visitor. Keep per-request input on the request (the scan run) until an owner confirms it (V1-SEC-01).
- An SSRF guard that refuses IP literals at the boundary must apply the same rule to every redirect hop, and
  must decode IPv6 forms that embed an IPv4 address (`::a.b.c.d`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`), not
  only `::ffff:` (V1-SEC-02).
- An "explicit allow-list" response body is only explicit if nested objects are rebuilt too. A top-level key
  list passes stored sub-objects through as they are (V1-SEC-04).
