# 005 Scan identity: verification

Round 1, 16 Nov 2026. QA, security and compliance ran concurrently (qa.md, security.md, compliance.md); the fixes below were made in the same round and re-run.

## Verdict: SHIP

The one P0 (QA-01) and every P1 except CMP-04-adjacent wording are fixed and re-tested. Nothing open blocks.

## Fixed this round

| ID | Sev | What | Fix | Evidence |
|---|---|---|---|---|
| QA-01 | P0 | Any number in the street line counted as the house number ("2e Hugo de Grootstraat 12" matched 2) | Only the number at the end of the street line; `a-b` is a range only when b > a | `business-identity.test.ts` "QA-01", `business-identity-qa.test.ts` (was `it.fails`, now `it`) |
| QA-02 | P1 | A page on a shared host (facebook.com/x) matched any page on that host | When the listed website names a page, the typed one must be that page; a language folder names none | `business-identity.test.ts` "QA-02" |
| QA-03 | P1 | A single KvK-only candidate was taken by name; a typed website could land on it | Route: the website-as-business branch also requires no KvK number; onboard: `candidate.kvk` counts as listed | `unlisted-website.test.ts` "QA-03" |
| SEC-01 | P1 | "Not listed" let a stranger attach a website to a business Google lists | `prepareBusiness` ignores a typed website when the stored business has a place id or KvK number | `unlisted-website.test.ts`; control: guard off → red |
| SEC-02 / CMP-01 | P1 | Privacy text said the identity is never kept; a typed website for an unlisted business is | Paragraph split: postcode + number only compared; a website for a business Google does not know is checked and kept. Legal lock renewed; AC-6 amended | `legal.test.ts` green |
| CMP-02 | P1 | No privacy information at the point of collection | Hint says postcode + number is only compared; a line with a link to the privacy statement under every scan form | `ScanField.tsx` |
| CMP-03 | P2 | Records of processing missed the field | Row "Free check" updated | `docs/records-of-processing.md` |
| SEC-03 | P3 | "Not listed" still paid for a Places lookup | Skipped | `route.ts` |
| QA-06 | P3 | The requester object carried the identity | Built from address and news box only | `route.ts` |

## Open (filed)

- CMP-04 (P2): a report on a business checked by name and place alone should say so (namesakes). Worth doing next.
- QA-04 (P2): street-first and "nr." forms are refused; the visitor retypes.
- QA-05 (P2): after `fout=herken` or `fout=mail` the e-mail address has to be typed again.
- QA-07, CMP-07 (P3): a business abroad without a website cannot pass; a KvK number as a third option.
- SEC-04 (P2, pre-existing): `localhost.localdomain` and friends pass the website check by name.
- CMP-05 (P3, pre-existing): `vidalo_check` has no `Secure` flag.
- CMP-06 (P3): the legal version date is 17 November 2026; deploy on or after that day.

## Checks run after the fixes

`pnpm -r typecheck`; `pnpm -r test` (core 1464, worker 52); `DATABASE_URL= pnpm e2e:mock`; Playwright mock, one worker: scan-identity, free-check, scan-website, scan-confirm, turnstile-hold, owner-fixes, signed-in, account, forms: 71 passed, 10 skipped (mobile/Stripe variants).

## Not checked

Real Google Places answers (mock only; the street-line format is read from `resolve.ts`), Turnstile switched on, gate mode, PgDb, the Workers build.

## Round 2: AC-9, the namesake line (17 Nov 2026)

Verdict: SHIP. QA, security and compliance ran concurrently (sections "Round 2" in qa.md, security.md, compliance.md). No P0, no P1.

Fixed in this round: CMP-04 (the line itself), CMP-09 (wording: "We vonden dit bedrijf niet op Google…", true for KvK-only businesses too), CMP-08 (an online business gets the line without naming Google, `copy.result.namesakeOnline`), QA-R2-05 (`notListedOf` in `apps/web/lib/report.ts`, tested). One function decides page and mail alike: `namesakeLine` in `core/shared/checked-as.ts`; a business read by nothing gets no line (its report already judges no answer). QA added `namesake-wiring.test.ts` (runScan → page view and mail).

Open: QA-R2-04 (P2) the day-7/21 follow-up mail quotes a wrong answer and could carry the line too; QA-R2-01 (P2) the mail lab has no local unlisted journey; QA-R2-02 the page reads today's business record, not the one at scan time.

Checks: `pnpm -r typecheck`; `pnpm -r test` (core 1475, worker 52); `e2e:mock`; Playwright free-check + scan-identity, one worker, 20/20. Not checked: the line in a browser for a local unlisted business (mock mode cannot reach it; covered by the view and wiring tests), paid reports, PgDb.
