# Vidalo — notes for Claude Code

Vidalo checks what AI assistants say about a Dutch business, finds wrong facts and their sources, publishes a facts page on the owner's domain, syncs directories, and fixes errors at the source with proof. Tagline: *Je klanten vragen het aan ChatGPT. Wij zorgen dat het antwoord klopt.*

## Renamed from Maicro (13 Oct 2026)
The product is **Vidalo** (from *videre*, to see). The code, copy (NL + EN), package names (`@vidalo/*`), env vars (`VIDALO_*`), Worker names (`vidalo-web`, `vidalo-worker`, queue `vidalo-scans`), cookies, emails (`hallo@vidalo.nl`) and domains (`vidalo.nl`) were renamed in one commit; on 14 Oct the domain became `vidalo.io` (`hallo@vidalo.io`; since 19 Oct `hello@vidalo.io` for contact and `support@vidalo.io` for support, see `docs/mail.md`), because `.nl` and `.com` are held by others. A rename of the product is not a rename of what is provisioned; these stay by hand:

| Thing | Status |
|---|---|
| GitHub repo | **Renamed to `A101io/vidalo` on 15 Oct 2026** (GitHub redirects the old `maicro` URLs). `scripts/site/snapshot.mjs` uses `/vidalo/`; the Pages URL is `a101io.github.io/vidalo` |
| Supabase project name `maicro` (ref `bbynmqvaxpjdnkaasutd`) | display name only, Julian renames in the dashboard; the ref never changes |
| Committed migrations | keep the word Maicro in two comments; migrations are never edited |
| `docs/design-g/*.html` | the original design boards, kept as they were |
| Domain | **`vidalo.io`**, registered by Julian 14 Oct 2026 (`vidalo.nl` and `vidalo.com` are held by others). Code, copy, emails and `wrangler.jsonc` renamed the same day. Only `www.vidalo.io` redirects. Zone on Cloudflare: Julian |
| Stripe, Cloudflare Workers, Google OAuth app, Resend | none exist yet; create them as Vidalo |

## Resuming work — read this first
- **`SETUP_STATUS.md`** is the baseline status (v3); work rows that are not `✓verified`. **`docs/go-live-checklist.md`** is the launch gate, decisions for Julian first.
- Hosting is **Cloudflare** (decided 13 Oct 2026): `apps/web` runs as the Worker `vidalo-web` (OpenNext, custom entry `apps/web/worker.ts`), `apps/worker` as `vidalo-worker` (`src/cloudflare.ts`: cron, the `vidalo-scans` queue, facts pages). Deploys are manual: `.github/workflows/deploy.yml` (`preview` = mock data, `production`). The static mock preview also still goes to https://a101io.github.io/vidalo/ on every push to main.
- Domains: `vidalo.io` is the site; `www.vidalo.io` is a Custom Domain on `vidalo-web` that 301s to it (`core/shared/canonical.ts`, used by `apps/web/worker.ts`). `workers_dev` stays on explicitly. **The first production deploy puts the product on vidalo.io**: there is no coming-soon gate yet, so that run is the launch (`docs/go-live-checklist.md`, Domains).
- **Local clone** (14 Oct 2026): `/Users/a101/Vidalo`, GitHub repo `A101io/vidalo` (renamed from `maicro` 15 Oct 2026). `pnpm` comes from corepack; it was put on the PATH with `corepack enable --install-directory ~/bin`, because the OpenNext build spawns `pnpm build` in a child shell and dies with `pnpm: command not found` when only `corepack pnpm` works.
- **Env**: the root `.env` (gitignored) is read by the web app too (`apps/web/next.config.ts` loads it; a value already in the environment wins). Julian's file holds the Supabase URL + anon key and no `DATABASE_URL`, so sign-in is real and business data lives in memory. `.claude/launch.json` defines `vidalo-dev` (:3000) and `vidalo-worker` (:8787) for the browser tools.
- **Cloudflare**: account `37c9615a0d7d9629154eca03d7de59a6`. The mock preview is live at https://vidalo-web-preview.julian-devriend.workers.dev (deployed by hand 14 Oct 2026 from a local `wrangler login`); queue `vidalo-scans` exists. Production has no Hyperdrive, no secrets, and its Custom Domain cannot bind until `vidalo.io` is a zone in the account.
- Test the Cloudflare build locally: `pnpm --filter @vidalo/web cf:build`, then in `apps/web`: `npx wrangler dev -c wrangler.jsonc -c ../worker/wrangler.jsonc` with a `.dev.vars` (gitignored) per app, e.g. `VIDALO_MOCK=1`, `VIDALO_DB=pg`, `DATABASE_URL=` a local Postgres.
- NL lives at `/`, EN at `/en/...` (`apps/web/middleware.ts`, `lib/lang-paths.ts`, `lib/i18n.ts`). Copy: `packages/core/src/copy/index.ts` (Dutch, the source) and `en.ts` (same shape, enforced by `CopyShape`). Add a key to both or typecheck fails.

## How to write to Julian
Short. One action at a time. Real strings, not placeholders. End with one concrete question and a suggested answer when something needs him. Say plainly when something keeps failing. Never touch his iCloud folder.

## Things that cost an hour to rediscover
- **On Workers a database connection cannot cross requests.** Every request and job runs inside `withDb()` (core/shared/db.ts) with its own handle; anything that reads a module-level `db` instead hangs every second request ("Cannot perform I/O on behalf of a different request"). The scope lives on `globalThis` because the Worker entry and the Next server bundle core separately; two AsyncLocalStorage instances made the scope invisible. Measured: without it 200 500 200 500.
- **OpenNext runs the middleware twice on a rewrite**: the second pass sees the rewritten Dutch route, so `/en` came out Dutch until the middleware kept the first pass's language.
- **CSP `upgrade-insecure-requests` on an http origin blocks the scan form** (its own URL becomes https, not 'self'). Only added when `PUBLIC_BASE_URL` is https.
- **This cloud container cannot reach `*.supabase.co`, `a101io.github.io` or `api.stripe.com`.** Use the Supabase MCP tools (check the ref on every call) and the GitHub MCP tools; ask Julian to open the Pages site himself.
- **A script that touches React-rendered text before hydration makes React throw the server HTML away** and rebuild the page, which also drops every Web Animations API animation `motion.js` set up (scenes freeze, elements "not attached to the DOM"). `public/ask.js` therefore waits until the node carries a `__reactFiber` key. `motion.js` only animates, it never changes markup; keep it that way.
- **Next only reads `.env` from `apps/web`**, not the repo root the README points at; with the root file alone, every sign-in silently used the mock session while `/api/health` looked fine. `next.config.ts` now loads the root file.
- **An agent cannot click "Stuur inloglink"**: it sends a real e-mail, so the permission layer stops there. Drive the flow up to `/inloggen?business=…`, then hand the click to Julian and read the result afterwards.
- **`pnpm cf:build` fails with `ENOENT .next/required-server-files.json` while `next dev` is running**: both write `apps/web/.next`. Stop the dev server (preview_stop) before an OpenNext build, start it again after.
- **`pkill -f next-server` kills the shell running it.** Find the pid with `ps` and kill that.
- **RLS tests on the hosted project**: run them as one `DO` block that sets role and JWT claims, then `raise exception` with the counts, so the transaction rolls back and nothing stays behind. Always include the owner as a control that must see rows.
- **CI Postgres**: Docker Hub's anonymous pull limit broke the service container; the job uses the runner's preinstalled Postgres.
- **GitHub Pages artifacts may not contain paths starting with `_`**: the snapshot renames `_next` to `assets`.
- **A server action that redirects into an API route hangs**; go through a page (`/eigenaar/bevestigen`).
- **Deleting a cookie during render is a server error** in Next 15; only route handlers and server actions may set cookies.
- **Supabase `create_project` via MCP timed out three times**; creating it in the dashboard worked.
- Two other Stripe accounts sit in the same company (Sitty `acct_1UA8rHEGTq7D30VV`, Sonable `acct_1TyIM8EQK4LIWEDd`); `pnpm stripe:setup` refuses both and pins Vidalo's.

## Added 14 Oct 2026 (local session)
- **Launch gate**: `core/shared/gate.ts` + `apps/web/middleware.ts`; env `VIDALO_COMING_SOON`, `VIDALO_PREVIEW_KEY` (the public preview button was removed 18 Oct 2026; only the key opens the full site); page `/binnenkort` (EN `/coming-soon`), `/api/preview`, `components/PreviewBar.tsx`. `.claude/launch.json` has `vidalo-dev` (real auth), `vidalo-dev-gate` and `vidalo-dev-mock` (no Supabase keys → mock sign-in as `eigenaar@bakkerijdevries.nl`, gate on).
- **Cookies**: `/cookies` statement (inventory in `copy.legal.cookies`), `lib/consent.ts`, `components/CookieConsent.tsx`; add a category to `OPTIONAL_CATEGORIES` and the statement's table in the same change.
- **Account**: `/app/account`. **Checkout**: terms consent, B2B custom text, btw-nummer, return URLs from `lib/origin.ts` (`core/shared/origin.ts`); needs the Terms and Privacy URLs on the Stripe account. **Assistant**: `core/chat` (knowledge from the copy, rules, FAQ fallback, `modelAnswer`), `/api/chat`, `components/ChatWidget.tsx`.
- **Language preference** (15 Oct 2026): `business.language` (`0006_language.sql`, applied on the hosted project). Set on `/app/account` or by the NL · EN switch while signed in (`/api/lang`). `lib/preferred-lang.ts` sends a signed-in owner to their language on every `/app` page and on their own report. The report itself is fully bilingual: question lines and value wording come from `copy.report`; `ScanReport.correct[].raw` carries the normalised value so the page words it (older reports fall back to the stored Dutch). E-mails are still Dutch-only.
- **Progress view** (15 Oct 2026): `/app/voortgang`, built on `packages/core/src/progress.ts` and `buildSnapshot` (scanner). Each finished full scan becomes per (question, AI system) the verdict most samples carried, so a free and a monthly check compare; rechecks are left out. Filters by period, AI system and bundle (afhakers, misleiders, verwarring, aanbevelingen); counts and dots only. "Ranking" is answered with "genoemd als aanrader", never a position (`docs/CRITERIA.md`). Mock mode seeds eight months of improving checks (`apps/web/lib/demo.ts`).
- **Scan history comes from samples, not findings**: `upsertFindings` moves a finding's `scan_run_id` to the latest scan that saw it, so `listFindingsByScanRun` on an old run returns too little. Rebuild an old run from its samples (`buildSnapshot`); for repairs use the finding's own `first_seen_at` / `resolved_at`. The scan itself resolves findings it now sees answered right.
- **Content**: `docs/content-check.md` is the fact-check; every number on the site carries a verified source as of 14 Oct. Free reports expire after 30 days (`app/r/[id]/page.tsx`). Copilot is a stub (`scanner/engines/copilot.ts`): keep it out of free-check copy until the adapter ships.

## Added 18 Oct 2026
- **Address**: `hello@vidalo.io` in both languages (was `hallo@`), in copy, chat, security.txt, llms.txt and docs. The mailbox itself is Julian's to create.
- **Coming-soon list**: form on `/binnenkort` (EN `/coming-soon`) → `POST /api/waitlist` → table `waitlist` (`0009_waitlist.sql`, applied on the hosted project 18 Oct; its ledger row there is still named `0007_waitlist`, version `20261018192302`, because it was applied before the file was renumbered after #23's 0007/0008). RLS on, no policies, no grants for anon/authenticated (proven with a rolled-back DO block: anon and authenticated denied read and write, owner inserts). Checks live in `core/shared/waitlist.ts` (tested): hidden `website` trap field (bot gets "ok", nothing stored), required consent box, address normalised and validated, 5 posts per IP per 10 min, 300 per hour site-wide, foreign `Origin` refused. Same "ok" for new and existing addresses (no enumeration). The stored consent is the server's sentence in the page's language; events carry only language and `created`, never the address. Nobody gets mailed yet: sending the launch mail and deleting the list afterwards is a launch-day task (go-live P8).
- **Staging + local production run**: see go-live X6/X7; `scripts/local-prod.sh`, launch entry `vidalo-prod-local`.

## Read first
- `docs/CONTRACT.md` — module layout and rules (facts are owner-asserted; never claim "control"; no jargon).
- `docs/ARCHITECTURE.md` — workflows A–E and the fix-path table.
- `docs/CRITERIA.md` — the twelve criteria, severities, thresholds, the stipregel and the sector question sets (the scanner follows this literally).
- `docs/MESSAGING.md` — every customer-facing rule and the Dutch copy. All strings live in `packages/core/src/copy/index.ts`.
- `docs/DESIGN_G.md` — the visual spec (design G: Plus Jakarta Sans, white/ink/one blue accent, 1.5px borders, status colours only in dots, pills and report rows; reference boards in `docs/design-g/*.html` are the source of truth for copy, order and layout). `docs/DESIGN_RESEARCH.md` §3–4 (serif/paper) is superseded.

## Commands
```
pnpm install
pnpm -r typecheck && pnpm -r test          # must stay green
pnpm e2e:mock                              # whole pipeline in one process, no keys
pnpm verify:pg                             # migrations + PgDb + whole pipeline on a real local Postgres (PG_ADMIN_URL)
VIDALO_MOCK=1 pnpm dev                     # web on :3000 (demo owner eigenaar@bakkerijdevries.nl)
VIDALO_MOCK=1 pnpm worker                  # job loop + cron + facts pages on :8787
VIDALO_MOCK=1 pnpm scan --name "X" --place Y --kind free
pnpm --filter web build                    # needs fonts.googleapis.com (next/font/google Plus Jakarta Sans); offline: NEXT_FONT_GOOGLE_MOCKED_RESPONSES=<mock.js>
```

## State (v0.1)
Done and verified in mock mode: scanner core (5 engines, extraction, compare, attribute, CLI), web (landing, free scan, result, Stripe checkout, auth, dashboard, facts form, CNAME, Google OAuth), workers (publisher, 13 NL directories, GBP sync, fixer paths + rechecks, Dutch emails, queue + cron), "niet gevonden" state (finding `verdict: not_found`, report `notFoundAnswers` + `visibility`, own fix path, grey result-page hero; migration `0002_not_found.sql`), criteria + sector layer from `docs/CRITERIA.md` (12 criteria with severity + thresholds in `packages/core/src/criteria.ts`, 11 sector packs with recommendation questions in `packages/core/src/prompts/sectors.ts`, `inferSector`, facts fields `serviceArea` / `urgency` / `credentials` / `sector`, recommendation absence detection, stipregel with `ScanReport.stip` + per-engine colours + `findingsBySeverity` + `instable`, colour in emails and CLI markdown; migration `0003_sectors.sql`). Web re-skinned to design G (`docs/DESIGN_G.md`): landing with the 14 sections and anchors, result page in three states (rood/oranje, groen, grijs) built by `apps/web/lib/report.ts` from `ScanReport` (one row per question, answer cards, source rows, plan steps, never a score), demo reports at `/r/voorbeeld` (red) and `/r/voorbeeld-grijs` (grey) from `apps/web/lib/demo.ts`, static sector pages `/vak/[slug]` for the 11 packs (questions rendered from the pack templates with placeholder facts, `apps/web/lib/sector.ts`), sitemap, facts form with the sector-layer inputs, dashboard shell in G. All copy in `packages/core/src/copy/index.ts` (`landing`, `result`, `sector`, `sectorPages`). Screenshots in `out/screenshots/` (gitignored). Own-website check (`publisher/sitecheck.ts`, job `sitecheck`: robots.txt per answer robot, noindex, LocalBusiness JSON-LD + phone; owner mail with the exact change) and Google index check of the facts page (`publisher/google-index.ts`, job `index_check`: Site Verification meta tag, Search Console property, sitemap, URL Inspection; table `google_index`, migration `0007_google_index.sql`; needs `GOOGLE_SERVICE_ACCOUNT_JSON`), both scheduled from setup and the cron. Recommendation intents and question bank: per sector six recommendation questions in the core (kwaliteit, vertrouwen, nu, specialisme, prijs, plek), a bank of 20–30 that rotates 6 per full scan by month and season (`prompts/rotation.ts`), promotion of bank questions where the business is mostly not named, free scan with 3 recommendation questions, and "Wie AI wel noemt" (`scanner/recommendations.ts`, `ScanReport.recommendations`) on the result page, in mails and CLI; migration `0008_question_bank.sql`. `PgDb` is verified against a real Postgres by `pnpm verify:pg` (db tests run on both MemDb and PgDb; the mock pipeline runs on PgDb with `VIDALO_DB=pg`); not yet against a Supabase project.

Not built: Bing/Apple/form-directory adapters (fall to operator queue), Copilot browser adapter (`setCopilotAdapter`), WordPress plugin, quarterly plan.

## Supabase
Project `maicro`, ref **`bbynmqvaxpjdnkaasutd`**, eu-west-1 (Ireland), org A101BV — https://bbynmqvaxpjdnkaasutd.supabase.co.
Migrations 0001–0009 are applied (ledger: `supabase_migrations.schema_migrations`): 0007 `google_index` and 0008 `question_bank` applied 15 Oct 2026; 0009 `waitlist` applied 18 Oct 2026, its ledger row named `0007_waitlist` from before the renumber. Every public table has RLS; the internal tables (`prompt`, `sample`, `claim`, `job`, `google_index`, `waitlist`) have no policies, so only the service role / table owner reach them.
The same org holds **`hlelpndtejajipqwjwrf` (Sitty)** and **`muuijbupsnhascqzfbin` (Sonable)** — check the ref on every call; the names give no warning.
Not done yet: `DATABASE_URL` / service-role key in a secret store, and a run of the pipeline against this project.

## Next steps, in order
1. Real database: project and migrations done (see Supabase above). Remaining: put `DATABASE_URL` (pooler, service role) in `.env`, run `VIDALO_DB=pg pnpm e2e:mock` against it once, then clear the rows it wrote.
2. First real engine (runbook: `docs/FIRST-REAL-SCAN.md`): `OPENAI_API_KEY` (ChatGPT sampling + extraction). Run `pnpm scan --list <20 businesses in one town>` and read `out/scans/*.md`. This validates the idea before anything else.
3. `GOOGLE_PLACES_API_KEY` so business resolution and the `/scan/kies` step work.
4. Stripe (runbook: `docs/PAYMENTS.md`, `pnpm stripe:setup`; billing rules in `packages/core/src/billing`); Resend; deploy to Cloudflare (`deploy.yml`, token in `docs/secrets-and-keys.md`); Hyperdrive; Cloudflare for SaaS for facts hosts.
5. Then Gemini, Perplexity, SerpAPI.

## Conventions
- Customer-facing text: Dutch, informal "je", calm verbs, no exclamation marks, never GEO/AEO/LLM/prompt/credits/zichtbaarheid/platform/agent in UI. One exception, asked for by Julian: the "Straks" section (`copy.landing.agents`, `components/AgentsSection.tsx`) names AI-agent, OKF, schema.org, llms.txt, MCP, A2A, each explained in plain words with who published it and when. Claims there must match what the code does (the facts page publishes HTML, schema.org JSON-LD and llms.txt; OKF is followed, not yet published).
- Facts are versioned; a new version only via the owner's confirmation. Samples are evidence; findings are the diff.
- **Ownership is proven, never claimed.** An e-mail address (report capture, magic link) only says who asked. `business.owner_verified_at` is set by `/api/google/callback` when the signed-in Google account holds a Business Profile location whose place id equals `google_place_id` (`packages/core/src/shared/ownership.ts`); proof replaces any earlier claim. Saving facts, the domain, on-demand scans (`requireVerifiedOwner`) and every setup/publish/sync/fix/recheck job (`apps/worker/src/jobs/paid.ts`: paying AND verified) wait for it. A business without a place id cannot be verified automatically; that goes to support@vidalo.io.
- Keep `pnpm -r typecheck`, `pnpm -r test` and `pnpm e2e:mock` green before committing.
- One primary (blue) button per view. No dark mode. No emoji. Never show a score; only counts and the colour of the dot.
