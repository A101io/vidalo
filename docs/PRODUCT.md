# The product after login — what an owner gets for €49 a month

> Written 24 Oct 2026. The marketing side (landing, free check, result page, checkout) is done
> in design G. This file is about the other half: everything an owner sees and does after
> signing in. It lists what exists, what is still required, decides where design happens, and
> maps the build onto the Control Room baseline (section PD, added the same day; the canonical
> text is `A101/_OS/playbook/PRODUCT.md`).

## What the product promises

The owner paid for one thing: *the answer AI gives about my business is right, and I can see
that it is.* Everything after login serves three questions, in this order:

1. **Is it right now?** One colour per AI system, counts, the date of the last check.
2. **What is wrong, and who fixes it?** Each error with its source, what Vidalo did (with
   proof), what the owner must do (exact text), and when it is checked again.
3. **What has it cost me and what did I get?** Plan, invoices, the proof cards, the trend.

Rules that bound every screen (`docs/CONTRACT.md`, `docs/MESSAGING.md`, `docs/CRITERIA.md`):
facts are owner-asserted, never claimed as "control"; never a score, only counts and the colour
of the dot; "ranking" is only ever "genoemd als aanrader"; no jargon (GEO, AEO, LLM, prompt,
credits, zichtbaarheid, platform, agent); one primary button per view; no dark mode.

## Functionality list

Status: **✓** exists and observed in mock mode · **≈** partly there · **—** not built.
"Required" means the product is not honest or not usable without it; "Later" is after the first
paying customers.

### 1. Overzicht (`/app`) — is it right now?

| | Function | Status | Notes |
|---|---|---|---|
| Required | Colour and status line from the last finished check | ✓ | `report.stip`, counts, `copy.stipLine` |
| Required | Setup checklist (Google → gegevens → domein), hidden when done | ✓ | Google first: it proves ownership |
| Required | Open errors with source and next step | ✓ | one row per finding |
| Required | Proof cards (before → after, dates, source) | ✓ | |
| Required | Vermeldingen (channels) with sync status | ✓ | |
| Required | "Controleer nu" (on-demand check, verified owners only) | ✓ | `requireVerifiedOwner` |
| Required | **Colour per AI system** on the overview, not only the worst | — | `engineStips` exists in the report; the overview shows one dot. The owner asks "is ChatGPT right?", not "is the worst one right?" |
| Required | **What changed since the previous check** (new errors, resolved, still open) | — | the monthly mail says it; the page does not. `progress.ts` already computes the diff |
| Required | **Next check date** ("Volgende controle: 12 nov") and the recheck dates per error | ≈ | recheck date is in the next-step line; the monthly date is nowhere |
| Required | **What we did this month** (actions with evidence: republished, synced, mailed directory X, screenshot) | — | the fix sequence stores evidence (Workflow D); the owner never sees it. This is the product's receipt |
| Later | Compare two checks side by side | — | `/app/voortgang` covers the trend; a pairwise view can wait |

### 2. Fouten (findings) — what is wrong, who fixes it

| | Function | Status | Notes |
|---|---|---|---|
| Required | List: question, AI system, wrong → right, source, status pill, first seen | ✓ | on `/app` |
| Required | **Finding detail page** (`/app/fouten/[id]`): status timeline, the raw answers that showed the error (the samples), the source, every action Vidalo took with evidence, the next step and date | — | ARCHITECTURE Workflow E: "raw samples on request". Nothing today shows a sample to the owner; the finding is a claim without its evidence |
| Required | **Owner action for `owned_website`**: the exact page and text to change, "Ik heb dit aangepast" → schedules the recheck now instead of in 14 days | — | the mail says it; the app cannot confirm it |
| Required | **"Dit klopt wél"** (dispute): the owner says the AI is right and the fact is wrong → opens the facts form prefilled, new facts version after confirmation | — | without it a wrong fact stays wrong forever and the finding never resolves |
| Required | Severity bundles as filters (afhakers, misleiders, verwarring, aanbevelingen) | ≈ | on `/app/voortgang`; not on the findings list |
| Required | "Niet gevonden" state with its own path (publish, sync, 21-day recheck) | ✓ | |
| Later | Unfixable after 45 days with the note and a manual escalation to support | ≈ | status exists; the owner cannot ask support from the row |

### 3. Rapporten (reports) — every check, kept

| | Function | Status | Notes |
|---|---|---|---|
| Required | List of all finished checks with kind, date, colour; open the report | ≈ | `/app/account` shows six; `/app/voortgang` lists runs; no page named "Rapporten" |
| Required | The report page `/r/[id]` for a paid owner: full, bilingual, no expiry | ✓ | free reports expire after 30 days; owner reports do not |
| Required | The monthly report in the app is the same as the monthly mail | ≈ | both come from `ScanReport`; the "what changed" block exists only in the mail |
| Required | Print / save as PDF (accountant, partner, franchise) | — | a print stylesheet on `/r/[id]` is enough |
| Later | Share a report by link, read-only, with expiry | — | |

### 4. Voortgang (progress) — the trend

| | Function | Status | Notes |
|---|---|---|---|
| Required | Per check, per fact, per AI system, repairs; filters period, AI, bundle | ✓ | `packages/core/src/progress.ts` |
| Required | "Wie AI wel noemt": the recommendation questions, who is named, trend | ≈ | on the result page and in mails; not in the app as a trend |
| Later | Export (CSV) of the counts | — | |

### 5. Gegevens (facts) — the owner's assertion

| | Function | Status | Notes |
|---|---|---|---|
| Required | Facts form with sector layer (serviceArea, urgency, credentials, sector) | ✓ | |
| Required | Versioning: a new version only after confirmation; version and date shown | ✓ | `facts.version`, `verifiedAt` |
| Required | **Version history**: what changed, when, and which checks ran on which version | — | the table holds versions; nothing lists them |
| Required | Edit → republish + resync + mini-check after 7 days, stated on the page | ≈ | jobs exist; the page does not say what will happen |
| Required | **Annual re-confirmation**: "Klopt dit nog?" once a year, one click | — | Workflow E; a mail plus a banner on `/app` |
| Required | "Niet te verwarren met" (naamgenoot) on the facts page, editable | ≈ | criterion 11 path exists in the fixer; no field for the owner |
| Later | More than one location | — | pricing open (go-live P4) |

### 6. Vermeldingen (channels) — the facts everywhere else

| | Function | Status | Notes |
|---|---|---|---|
| Required | Directory list with status (pending, synced, mismatch, failed, manual), date | ✓ | |
| Required | **Diff approval for Google, Bing, Apple**: show the change before it is applied; the owner approves | — | ARCHITECTURE Workflow B says "approve diff"; nothing in the app asks. Changing a live Business Profile without showing the diff is the one thing an owner will not forgive |
| Required | **Evidence per channel**: the screenshot or the API response that proves the sync | — | stored by the fixer; not shown |
| Required | Manual channels: the instruction the owner must follow, and "Gedaan" | — | `manual` status exists; no instruction, no confirmation |
| Required | Facts page status: published (date), indexed by Google (yes/no/date), the URL | ≈ | `google_index` table filled by the worker; the app never reads it |
| Required | **Own-website check** result: robots.txt per answer robot, noindex, JSON-LD, phone, with the exact change | — | `sitecheck` job mails it; the app does not show it |
| Later | Add a directory the owner knows about | — | |

### 7. Domein, Google

| | Function | Status | Notes |
|---|---|---|---|
| Required | CNAME `feiten.{domain}` with DNS polling, or a Vidalo-registered name | ✓ | |
| Required | Google connect, ownership proof, read/diff/apply | ✓ (connect, proof) · — (diff shown) | see 6 |
| Required | Disconnect Google; what stops when disconnected | — | |

### 8. Abonnement (billing)

| | Function | Status | Notes |
|---|---|---|---|
| Required | Plan, status, next date, portal (invoices, card), add-on | ✓ | |
| Required | Paused state: what stopped, what stays (facts page 60 days), how to resume | ≈ | `pausedNote` exists; dunning path untested on real Stripe |
| Required | **Cancel in-app**: "Klopte alles al?", offers the quarterly check (€29), then confirms the end date and what happens to the facts page | — | Workflow E. Today cancelling is the Stripe portal with no context |
| Required | Written confirmation on a durable medium after every change (ACM R9) | ≈ | checkout yes; cancel no |

### 9. Account, notifications, support

| | Function | Status | Notes |
|---|---|---|---|
| Required | Who is signed in, owner proof, language, business summary, latest report, plan | ✓ | |
| Required | Signed in without a business: a clear state with a way forward | ✓ | fixed 24 Oct 2026 |
| Required | **Change e-mail address** (magic-link account) | — | |
| Required | **Mail preferences**: which of the 13 mail kinds, and unsubscribe per kind where the law allows | — | one-click unsubscribe exists for marketing mails; no preferences |
| Required | **Export and delete account** (GDPR, Control Room C2), with what happens to the facts page | — | |
| Required | Support from inside the app: `/support` form on the kit brain, Reply-To support@ | ≈ | kit G4 adopted in #49; no link from `/app` |
| Later | A second user per business (accountant, marketing bureau) | — | |

### 10. States every screen needs

| State | Where | Status |
|---|---|---|
| Just paid, nothing done yet (first 48 hours) | `/app` | ✓ setup checklist |
| Check running (progress: which questions are being asked) | `/app`, `/r/[id]` | ✓ on the result page, — on `/app` (only "ingepland") |
| Everything right (green) | `/app` | ✓ |
| Not found (grey) | `/app`, finding | ✓ |
| Paused for non-payment | `/app` | ≈ note on billing; `/app` itself looks normal |
| Churned (facts page redirects) | `/app` | — |
| Not verified with Google yet, trying to save facts | `/app/gegevens` | ✓ redirect to `/app/google?eerst=1` |
| Error on a job (sync failed, directory refused) | channels | ≈ pill only |

The mock seed (`apps/web/lib/demo.ts`) must reach every row of this table, or the state is
never seen before a customer sees it.

### What is required before the first paying customer

In build order, each one small:

1. Colour per AI system + what changed + next check date on `/app` (data exists).
2. Finding detail with samples, actions and evidence; "Ik heb dit aangepast"; "Dit klopt wél".
3. Diff approval for Google/Bing/Apple and evidence per channel; facts-page index status; the
   own-website check result in the app.
4. Rapporten page + print stylesheet.
5. Cancel flow in-app; paused and churned states on `/app`.
6. Account: change e-mail, mail preferences, export + delete.
7. Facts version history, annual re-confirmation, "niet te verwarren met".

Everything marked "Later" waits for a customer to ask for it.

## Design decision: Claude Design first, for three screens

**Yes for the screens that carry new information, no for the rest.** Reasoning:

- `docs/DESIGN_G.md` already is the design system (tokens, components, the dot, pills, rows),
  and its rule is that a board is the source of truth for copy, order and layout. The owner
  area has no board: `docs/design-g/` holds landing, result and sector only. The dashboard
  shell was built straight from code and it shows: every page is the same stack of cards.
- `A101/_OS/DESIGN_TOOLING.md` (23 Oct) recommends the Design canvas for two or three
  directions of a page before code, at zero cost, and makes the visual pass a named phase.
- Lists and forms (Rapporten, Gegevens history, Account, mail preferences) are G components in
  a known order; drawing them first would cost more than building them.

So: one Design artifact, in design G's tokens, with two directions each for

1. **Overzicht** — the colour per AI system, what changed, next check, this month's actions.
2. **Fout** (finding detail) — timeline, samples, evidence, the two owner buttons.
3. **Vermelding met wijziging** — the diff approval for a Business Profile change.

Pick one direction per screen, write the board into `docs/design-g/` as the other boards
(`AppG.dc.html`, `FindingG.dc.html`, `ChannelG.dc.html`), then build with the
`frontend-design` skill and run `design:design-critique` and `design:accessibility-review`
on each new page before merge. The other screens are built directly from `DESIGN_G.md`.

Julian decides: start the Design artifact now (suggested: yes, it is a half-day and unblocks
items 1–3 of the build order).

## Through the Control Room, step by step

The Control Room baseline (`https://claude.ai/artifact/UZRqEkv38iYfU7rCrQHqA9`) covers how a
product is set up, hardened, shipped and kept legal. It said nothing about *what the product
is*; the playbook README states that on purpose ("it does not decide the product"). That is
the gap this work fills: a section **PD · Product** with seven items, one per step below, so
that the next venture (and the VvE platform) runs the same route. Vidalo's cells are set today
with the evidence in this file.

| Step | Control Room item | Vidalo today |
|---|---|---|
| 1. Write the product brief: the promise, the three questions, the functionality list with required/later and exists/written/verified | **PD1** | this file · written |
| 2. Design direction and system written (`DESIGN_G.md`); a board or Design artifact for every screen with new information structure, before code | **PD2** | G exists; owner-area boards missing · open |
| 3. Every screen has its states (empty, first run, in progress, error, paused, ended) and the mock seed reaches each one | **PD3** | table above; seed misses paused, churned, running · open |
| 4. The customer journey end to end (buy → setup → first result → monthly → cancel → re-engage) with the mail per step, run with time travel, repeats per recipient counted | **PD4** | mail lab (#42) covers the mails; cancel and re-engage missing · written |
| 5. Anything that publishes, spends or changes a live profile shows the diff and asks first; owner evidence kept | **PD5** | facts confirm ✓; channel diff — · open |
| 6. Design critique + accessibility review recorded per new page, before merge | **PD6** | none recorded · open |
| 7. The product proven on real data: the venture as its own first customer through the whole journey (go-live "Practise what we preach"), then one stranger | **PD7** | blocked: `OPENAI_API_KEY`, Stripe live |

How the build runs, per the existing bootstrap phases: PD1–PD2 before any code (Phase 1 of
`NEW_APP_BOOTSTRAP.md` gains a step "Product and design", see the playbook change); PD3–PD6
alongside Phase 5 (tests); PD7 is Phase 7's definition of done for the product, next to the
go-live checklist for the infrastructure.

## Open for Julian

1. Start the Design artifact for the three screens? Suggested: yes.
2. Pricing for more than one location (go-live P4) decides whether "Later: more locations"
   stays later.
3. Copilot: keep it out of paid copy until the adapter ships (go-live P4).
