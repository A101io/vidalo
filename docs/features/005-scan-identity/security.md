# 005 Scan identity: security verify (phase 4)

Reviewed 16 Nov 2026 against the uncommitted tree on `claude/scan-identity` (worktree `scan-mail-confirm`):
`apps/web/app/api/scan/route.ts`, `packages/core/src/shared/business-identity.ts`, `packages/core/src/shared/free-check.ts`,
`apps/web/lib/free-check.ts`, `packages/core/src/scanner/resolve.ts` (`unlistedCandidate`), `apps/web/app/scan/kies/page.tsx`,
`apps/web/components/ScanField.tsx`, and the privacy/cookie copy. Severity per `_OS/playbook/templates/pipeline/SEVERITY.md`.

**Process note.** 005 had no phase-1 security checklist (no `02-architecture.md`, no `checklists/security.md` in the feature
folder); this review checked against the standing list `docs/process/checklists/security.md` and 004's findings. The one P1
below was visible from the brief (AC-4 "checks the business as typed"); under the foreseeability rule it could not be more
than P1 anyway, and it is not a live exploit of data or money.

**No P0.** Nothing here blocks the gate.

## Findings

| ID | Sev | Claim | Evidence | Proposed fix | Cost |
|---|---|---|---|---|---|
| SEC-01 | P1 | "Mijn bedrijf staat er niet bij" (`unlisted=1`) lets anyone attach a website of their choosing to the provisional facts of an existing, Google-listed business, by typing that business's exact name and town. | `route.ts`: `if (saysUnlisted) candidate = unlistedCandidate(parsed.query, place)` builds the candidate from typed text; `onboard.ts:40-68` keys the business on `slugify(name, place)`, reuses the existing record, and decides `typedWebsite` on the *candidate* (`!candidate.placeId && !candidate.website`), not the stored business. Probe (MemDb, rolled away): business created from a listing (`googlePlaceId` `ChIJprobe`, no website), then `prepareBusiness` with `unlistedCandidate` + `website: https://evil.example.com` → same business id, place id kept, facts v1 `website: null` → v2 `website: https://evil.example.com`, still provisional. Path: (1) attacker opens the form, types "Bakkerij X", "Haarlem", any postcode, own mailbox; (2) on `/scan/kies` clicks "Mijn bedrijf staat er niet bij" with website `evil.example`; (3) confirms the mail link. Result: the listed business's provisional facts carry the attacker's site; the next free reports of that business compare against it, `understand` fetches it (guarded fetch, S-13), and an owner who later pays sees it pre-filled on `/app/gegevens` (`FactsForm.tsx:199`) and on `/app/account`. Before this change the unlisted path was reached only when Google listed nothing (or via a KvK-only candidate), so a collision with a listed business was impractical; now it is one click. Not P0: the write lands in *provisional* facts, and reaching the facts page or the Google Business Profile still needs the verified owner's confirmation (facts) and approval (GBP diff). | In `prepareBusiness`, decide on the stored record too: `const typedWebsite = !candidate.placeId && !candidate.website && !existing?.googlePlaceId && !existing?.kvk ? (opts.website ?? null) : null;` (and the same guard on the `else if` branch at line 65). Add a test: listed business, then an unlisted prepare with a website → facts unchanged. Optionally also refuse the website when the existing business has an `ownerEmail`/member. | 30 min |
| SEC-02 | P1 | The privacy text says the identity is "only compared ... we send it nowhere and do not keep it", but a **website** identity on an unlisted business becomes the business's provisional `facts.website` (stored) and is fetched by the profile reader (sent to that host, its page to the model). AC-6 has the same gap. | `route.ts`: `typedWebsite = parsed.url ?? (identity?.kind === "website" ? identity.url : null)`; `onboard.ts:64` stores it in facts; `copy/index.ts` privacy line "We vergelijken het alleen ... we sturen het nergens heen en bewaren het niet." Postcode + house number: verified never stored, logged, sent or put in a URL (see checks below). | Narrow the sentence to the postcode + house number, and add: "Geef je een website op en staat je bedrijf niet op Google, dan controleren we die website zoals bij 'Mijn bedrijf staat er niet bij'." NL + EN, legal lock. Hand to compliance. | 20 min |
| SEC-03 | P3 | `unlisted=1` still runs the Places lookup it then ignores. | `route.ts`: `resolveBusiness(...)` runs before `if (saysUnlisted)`. Capped by Turnstile + `freeCheckRefusal`, so bounded spend. | Skip `resolveBusiness` when `saysUnlisted`. | 5 min |
| SEC-04 | P2 (pre-existing, not introduced here) | `parseTypedWebsite` accepts `localhost.localdomain` (and so does a website identity), because the host filter is name-based. | Probe: `parseBusinessIdentity("localhost.localdomain")` → `{kind:"website", url:"https://localhost.localdomain"}`. The fetch side re-checks with `isPublicHttpUrl` per hop (`util.ts:227-236`) but also by name. On Workers outbound fetch cannot reach private ranges, so no demonstrated impact. | Add `localhost.*` / `*.localhost` / `*.localdomain` / `*.internal` / `*.local` to `isPublicHttpUrl`'s refusals. | 15 min |

## Checked and holding (evidence)

- **Ordering in `/api/scan`.** Gate → empty/limits (`typedBusinessProblem`) → address → identity (`fout=herken`) → Turnstile → `freeCheckRefusal` caps → Places lookup → prepare → mail confirmation (or signed-in start under `FREE_CHECK_LOCK` + per-address cap). The identity check sits before the bot check and spends nothing; every path that reaches the lookup (first post, `pick`, `unlisted=1`) still passes Turnstile and the caps, and every check still starts only after the mail link or a matching session. 004's controls are untouched.
- **Can `unlisted=1` / `pick` start something more cheaply?** No: same Turnstile, caps, confirmation and lock. `pick`/`unlisted` without an identity is allowed by design (`(typed || !chose) && !identity`); a direct post with `pick=0` and no identity selects by name, but that is a visible click-equivalent behind Turnstile, not a cost or data issue. A typed but unparsable identity on a pick post is refused (`typed` branch). Running a check on arbitrary names was already possible (any candidate could be picked); the new part is arbitrary websites on listed names, SEC-01.
- **`pick` index.** `Number(form value)` → `candidates[pick]`; NaN, negative, `"length"`-style values give `undefined` → back to `/scan/kies`. No prototype reach.
- **SSRF.** The website identity goes through the same `parseTypedWebsite` as ADR-0007's field (scheme, ≤200 chars, no credentials, no IP literals, ports 80/443 only, control/markup characters refused); probe: `http://169.254.169.254/latest`, `http://[::1]/`, `vidalo.ai:8080` and `foo.internal` are all refused. It is never given to `draftProvisionalFacts` (onboard.ts:62, S-13), only stored as facts and fetched by the redirect-checking fetch. See SEC-04 for the name-based gap.
- **ReDoS.** `POSTCODE_RE` runs only after the 200-character cap; adjacent quantified groups use disjoint classes. Hostile inputs (190 spaces, `" -"`×90, `" /"`×95, 199×`a`) parse in ≤0.2 ms. `identityMatches` runs `/\d+/g` on Google's address line only.
- **Cookie.** The HMAC covers the whole base64 body including the new `i` field; a forged `i` with the original signature reads as `null` (probe). Old cookies without `i` read as `identity: null` and fall into the identity requirement on a first post, the pick path otherwise. Expiry checks unchanged (15 min, not beyond TTL). The value stays httpOnly; it is readable base64 in the visitor's own browser only.
- **Identity in URL, event, log, database.** `backToField` and the `/scan/kies` redirect carry `q`, `place`, `k`, `fout`, `kandidaat` only. `pendingPayload` and `freeCheckEvents` build payloads field by field (email, marketing, lang, hash), so the `identity` key that now rides on `requester` from the cookie is dropped. No `console`/`logEvent` touches the identity. Postcode + house number is never stored; a website identity is stored only in the unlisted case (SEC-02).
- **Echo on `/scan/kies` and the form.** The identity field has no `defaultValue`; the refused website is not echoed (`websiteErrorFor` only picks which error to show; `kandidaat` is matched against `geen` or `^\d{1,2}$`). `q` and `place` are echoed as React-escaped text and hidden-input values, as before.
- **Tests.** `business-identity.test.ts` + `free-check.test.ts`: 14 passed (`DATABASE_URL=`).

## Standing list

Amended `docs/process/checklists/security.md` (Learned, 16 Nov 2026) with the general rule behind SEC-01.

## Round 2: AC-9 (17 Nov 2026)

Scope: the uncommitted diff on `claude/namesake-line` that adds `copy.result.namesake` to the report page
(`apps/web/app/r/[id]/page.tsx`, `apps/web/lib/report.ts`) and the free-check report mail
(`reporter/index.ts`, `reporter/templates.ts`) for a local business without `googlePlaceId`.

**No findings. No P0, nothing blocks the gate.**

Checked and holding:

- **Report access unchanged.** `load()` still resolves the report, business, facts and viewer exactly as before; the
  diff only adds the boolean `notListed: !!business && !business.googlePlaceId` to the view options. No new query,
  no new route, no change to the 30-day expiry or the owner check.
- **No new exposure on the public page.** The line is a fixed copy string with no interpolation. What it reveals
  (Google does not list this business) was already on the page: the sources row for the Business Profile reads
  `opts.googlePlaceId ? S.known : S.unclaimed` (`report.ts:438`). The place id itself is not rendered.
- **No user-controlled text.** Neither the page line nor the mail note carries a name, town or identity; the business
  name in the mail is unchanged. Page: rendered as a React text child (escaped). Mail: `note` blocks go through
  `linkify` → `esc` (`layout.ts:56-57`) in HTML and as plain text in the text part.
- **Demo and online reports** get no line (`notListed` is unset for demos; `!online` guard on both surfaces), so no
  claim about a namesake on a page that names no Google.
- **Tests.** `namesake.test.ts` + `report-namesake.test.ts`: 6 passed (`DATABASE_URL=`).

Standing list: nothing general learned; `docs/process/checklists/security.md` not amended.

## Round 3: AC-10 (17 Nov 2026)

Scope: the uncommitted diff on `claude/namesake-followup` that adds the namesake line to the day-7 and day-21
follow-up mails (`reporter/index.ts` `sendFollowUp`, `reporter/templates.ts` `followUpEmail`).

**No findings. No P0, nothing blocks the gate.**

Checked and holding:

- **No user-controlled text.** The new note is `namesakeLine(profile, copy.result)`, which returns one of two fixed
  copy strings (`namesake` / `namesakeOnline`) or null; nothing from the profile, name, town or typed identity is
  interpolated. It renders as a `note` block: `linkify` → `esc` in HTML (`layout.ts:56-57`), plain text in the text part.
- **Recipient unchanged.** The diff adds only `notListed: !business.googlePlaceId` and `profile: lastRun?.profile ?? null`
  to the template data; who `sendFollowUp` mails, and when, is untouched.
- **Unsubscribe path unchanged.** `links.unsubscribeUrl` is built by `unsubscribeUrl(business)` exactly as before.
- **Neutral/online rules.** `namesakeLine` returns null for a neutral profile and the online string for an online one,
  the same rule as AC-9; it discloses only that Google does not list the business, which the report already says.
- **Tests.** `namesake.test.ts` + `namesake-wiring.test.ts`: 10 passed (`DATABASE_URL=`).

Standing list: nothing general learned; `docs/process/checklists/security.md` not amended.
