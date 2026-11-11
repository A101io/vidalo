# 002 — Compliance verify (phase 4)

Reviewer: compliance agent, 11 Nov 2026. Not legal advice. Scope: the uncommitted change on
`claude/scan-mail-confirm` (`git diff` plus the untracked files), checked against
`docs/process/checklists/compliance.md`, `docs/legal-compliance-guidelines.md`,
`A101/_OS/playbook/LEGAL-NL.md` and the brief's AC.

**Process miss, mine:** no phase-1 compliance checklist was written for this feature. Under the
foreseeability rule nothing below may be above P1 unless it is a legal hard stop. None is.

**Verdict: no P0. Ships on compliance.** Seven P1s to fix this cycle (CMP-01 to CMP-06, CMP-08);
CMP-01, CMP-02 and CMP-06 are copy or docs only, CMP-08 is a one-line code change. One item for a lawyer (CMP-03, the 12-month period for the
addresses of people who never asked).

Tests run: `vitest run test/legal.test.ts test/scan-confirm.test.ts test/free-check.test.ts` →
42/42 green (legal lock matches the new text, NL and EN dates agree).

## What holds

| Check | Result | Evidence |
|---|---|---|
| Nothing starts before the address is proven | yes | `apps/web/app/api/scan/route.ts:107` only calls `requestConfirmation`; the engines start only from `apps/web/app/api/scan/bevestigen/route.ts:33` |
| Marketing consent recorded only after confirmation | yes | `marketing.consented` is written only by `freeCheckEvents` in `apps/web/lib/free-check-start.ts:34`, reached only from the confirm POST. The pending event holds `marketing: true/false` as a choice, not as consent, and nothing reads it for sending (grep: no reader of `payload.marketing` or `scan.confirm_requested` outside `findPending`). In effect a double opt-in, which strengthens the art. 11.7 Tw / art. 7(1) AVG record |
| An unconfirmed address never becomes "the requester" | yes | `requesterFromEvents` (`packages/core/src/shared/free-check.ts:47`) reads only `report_email.requested`, which is written after confirmation; follow-ups and the report mail cannot reach an unconfirmed address |
| Confirmation mail is transactional (art. 11.7 Tw) | yes | `packages/core/src/reporter/templates.ts:683-698`: subject, one CTA, the reason, "not you". No offer, no product promotion, no news; no unsubscribe needed. Footer carries the company identity (`renderMail`, `layout.ts`). The "Prijzen excl. btw" in that shared footer is consistent with the B2B-only stance (`docs/legal-compliance-guidelines.md:21`) |
| Address not in a URL (AC-4, privacy side) | yes | only `t=<businessId>.<secret>` travels; `/scan/bevestigen` sets `referrer: no-referrer` (`apps/web/app/scan/bevestigen/page.tsx:13`); the link only shows in the page outside real engines (`apps/web/app/scan/mail/page.tsx:20`) |
| A mail scanner opening the link starts nothing | yes | GET renders a form; POST starts (`page.tsx:38`) |
| Mail to someone else's address cannot be used to flood them | yes | 3/day per address, 5/day per connection, site-wide cap (`apps/web/lib/scan-confirm.ts:31-39`) |
| Reason stated, NL and EN (AC-6) | yes | privacy `copy/index.ts:1007` / `en.ts:984`; mail `index.ts:3135`; pages `copy.scan.confirm.why` |
| NL and EN equal in substance | yes | all new strings compared pair by pair; "hooguit 12 maanden" = "at most 12 months", "om misbruik te kunnen terugzien" = "so we can trace abuse" |
| Legal versioning | yes | `updated` moved to 12 Nov 2026 in both languages, `legal.lock.json` rehashed, `legal.test.ts` green. See CMP-09 for the date itself |
| Owner's data export does not leak the requester's address | yes | `ownAddressesOnly` (`packages/core/src/shared/my-data.ts`) strips the foreign `email` from the pending event and `to` from `email.scan_confirm` |
| Owner deletion removes the pending request | yes | events cascade with the business (`packages/core/src/db/pg.ts:384-389`); not the done mail job, see CMP-04 |
| No new cookie or browser storage | yes | the `vidalo_check` cookie is now cleared earlier; nothing added (`legal.test.ts` green) |
| Processors | no new vendor | Resend, Supabase, Cloudflare already listed in the privacy statement and `docs/processors.md`; wording update in CMP-06 |
| VAT, consumer rights, cancellation, invoices | not touched | no price, purchase or invoice in this flow |
| Accessibility (EAA) | not a veto | microenterprise exemption assumed unchanged (fewer than 10 staff, at most €2M); WCAG of the two new pages is QA's lane |

## Findings

| ID | Sev | Claim | Evidence | Proposed fix | Cost |
|---|---|---|---|---|---|
| CMP-01 | P1 | The privacy text gives no legal basis for the new processing. "Grondslag" names only the interest in showing what AI says; the confirmation step, the stored pending request and the 12-month keeping "to trace abuse" are a different purpose (security) and need their own basis and named interest. Art. 13(1)(c) and (d) AVG | `packages/core/src/copy/index.ts:1007,1010`; `en.ts:984,987` | Append to the "Bevestigen" item, NL: "Grondslag: ons gerechtvaardigd belang om de dienst en anderen tegen misbruik te beschermen (artikel 6 lid 1 onder f AVG)." EN: "Basis: our legitimate interest in protecting the service and others from abuse (article 6(1)(f) GDPR)." New version date, `legal:lock` | 15 min |
| CMP-02 | P1 | The person whose address someone else typed in gets no art. 14 information. Their data did not come from them; the mail is the first contact (art. 14(3)(b)), and it says "we start nothing and send you nothing more" but not that the address is kept up to 12 months, nor where the privacy statement is | `copy/index.ts:3136`, `en.ts:3048`; `templates.ts:683-698` (no privacy link block) | Extend `notYou`, NL: "Heb je dit niet gevraagd? Dan hoef je niets te doen: we starten niets en sturen je hierover niets meer. Je adres bewaren we alleen om misbruik te kunnen terugzien; zie onze privacyverklaring: {link}." Same in EN; add the `/privacy` (EN `/en/privacy`) link as a `note` with URL. Mail copy is not under `copy.legal`, so no version bump | 30 min |
| CMP-03 | P1 | 12 months is long for the plaintext address of a person who may never have asked (art. 5(1)(c) and (e) AVG). Tracing abuse needs to recognise the address, not read it. **Needs a lawyer** on whether 12 months passes the balancing test for non-requesters | `apps/web/lib/scan-confirm.ts:41` stores `email` in clear in `scan.confirm_requested`; `copy/index.ts:1007` | Preferred: when the purge job (CMP-05) runs, replace `email` in pending events older than 24 h and never confirmed with an HMAC of the address (server secret), keep the rest; then the text can say "je e-mailadres als code". Minimum: shorten to 3 months in the text. Ask counsel which | 1 h with CMP-05 |
| CMP-04 | P1 | The sent confirmation mail stays in the `job` table for ever: payload holds `to` (the address) and the full `text`/`html` with the plaintext link secret. Done jobs are not removed, not even when the business is deleted, so the "at most 12 months" promise and an erasure request are both broken for this copy. The worker also writes `email.scan_confirm` with `to` as an event (covered by cascade). For security/QA: the plaintext secret in the job row contradicts AC-4 ("only a hash of the link secret is stored") | `apps/web/lib/scan-confirm.ts:46`; `apps/worker/src/jobs/misc.ts:71-72`; `packages/core/src/db/pg.ts:387` deletes only `done_at is null` jobs | In the purge job: delete done `email` jobs older than 7 days (all kinds, this is general), and on `deleteBusiness` delete done jobs with that `businessId` too. Or, narrower: after a `scan_confirm` mail is sent, overwrite the job payload's `text`/`html`/`to` with null | 1 h |
| CMP-05 | P1 | The new retention promise has nobody enforcing it. "Hooguit 12 maanden" for unconfirmed requests joins the existing 12-month free-check promise; no purge exists anywhere (grep: no delete of `event` rows by age in `packages` or `apps/worker`). Checklist rule: "a retention period stated in a privacy notice names, in the same change, who enforces it and how". Not a hard stop today: the first request stored can only overrun on 12 Nov 2027. Art. 5(1)(e) AVG | `copy/index.ts:1007`; `docs/records-of-processing.md` free-check row "purge not built yet"; go-live L1 names the purge as a launch blocker | Carry into the existing purge item (go-live L1) explicitly: delete `scan.confirm_requested` and `scan.confirmed` events older than 12 months, plus CMP-03/04/07 in the same job (daily cron in `apps/worker/src/cron.ts`). Add a go-live row "P-purge: 002 classes" so it is not lost | 2–3 h for the job, shared with L1 |
| CMP-06 | P1 | `docs/records-of-processing.md` and `docs/processors.md` no longer describe the free check. Art. 30 AVG; checklist "change both in the same commit" | RoPA free-check row: data categories lack the pending request (address, news choice, language, link hash), the per-address and per-IP day codes; purpose lacks abuse prevention; retention lacks "unconfirmed: 12 months". `processors.md` Resend row: "Owner or report-requester email, report links" | RoPA: add to categories "pending request (address, news choice, language, hash of the link secret); day codes from the address and from the IP (/64 for IPv6)", purpose "and keep bots from starting checks", basis "legitimate interest (abuse prevention)", retention "unconfirmed requests 12 months; day codes: see CMP-07". Resend: add "confirmation links to an address not yet confirmed" | 15 min |
| CMP-07 | P2 | The day counter from the e-mail address is not mentioned, and like the IP code it is an unsalted SHA-256 of day plus value: for a known or guessed address (and for any IPv4 address, 2^32 tries) it is reversible, so it is personal data with no stated or enforced retention, though it is only needed for one day. Art. 5(1)(c)/(e), art. 13 | `packages/core/src/shared/scan-confirm.ts:73-76`; `scan-limit.ts:438-441`; privacy `copy/index.ts:1006` mentions only the IP code | Use HMAC with a server secret for both codes; delete counter events (`business_id is null`, type `scan.ip.*`, `scan.confirm.*`) older than 2 days in the purge job; in the privacy "Gegevens" item: "maken we van je IP-adres en de datum, en van je e-mailadres en de datum, een code en bewaren we die een dag" | 1 h |
| CMP-08 | P1 | The link secret reaches Google and Meta. Trackers load on every page (root layout) and GA4/Meta report the full URL, so after "accept" on `/scan/bevestigen?t=…` the `page_location` carries a working secret tied to an address and a business. The same reason `session_id` is already stripped. Checklist "no personal data in analytics events, URLs"; art. 5(1)(c) and (f) AVG | `apps/web/app/layout.tsx:40`; `apps/web/components/Trackers.tsx:94-104` strips only `session_id` | In `dropCheckoutId`, also delete `t` when `location.pathname` ends in `/scan/bevestigen` (the hidden input already holds it, `page.tsx:39`). Same check worth doing for `/scan/[token]` (pre-existing) | 15 min |
| CMP-09 | P3 | The version date is 12 November 2026 while today is 11 November; if this deploys today the statement claims a date that has not come | `copy/index.ts` `legal.updated`, `en.ts` | Deploy on or after 12 Nov, or set the deploy date and re-lock | 5 min |
| CMP-10 | P2 | A confirmation refused for the daily cap still writes `report_email.requested` (and `marketing.consented`) before the refusal; the link stays usable, so each retry writes them again. If another free run of the same business finishes later, `requesterFromEvents` picks the latest such event and the report goes to this address, not to the one whose check ran (business data only; the other requester's address is not disclosed). QA should judge the functional side | `apps/web/lib/free-check-start.ts:34` before `:46`; `packages/core/src/scanner/progress.ts:146-151` | Move `freeCheckEvents` after the refusal check (just before `scan.requested`, and in the reuse branch) | 15 min |
| CMP-11 | P2 | Resend open and click tracking: if on for the sending domain, it adds a tracking pixel (art. 11.7a Tw, consent needed) and rewrites the confirm link, so Resend holds the secret. Not documented either way | `docs/mail.md`, `docs/go-live-checklist.md` (no mention) | Julian: Resend → Domains → vidalo.io → Configuration: open tracking off, click tracking off; record it in `docs/mail.md` | 5 min |
| CMP-12 | P3 | `sendMail` logs `to` on every send (pre-existing, now also for unproven addresses) | `packages/core/src/reporter/mail.ts:96,106` | Log a hash or the domain only | 15 min |

## Notes for other agents (not compliance findings)

- **QA, AC-1:** the brief says a signed-in visitor skips the confirmation (`scan-confirm.ts:15`), but `route.ts:107` sends every requester through `requestConfirmation`.
- **QA/security, AC-4:** see CMP-04, the job row holds the plaintext link.
- `pnpm mail:lab` does not include the new mail (CLAUDE.md: every e-mail is in the lab).

## Proposed checklist amendments (not applied: this run was read-only)

For `docs/process/checklists/compliance.md` and, being general, the playbook template:
- A secret or identifier in a URL query (sign-in, confirmation, checkout) is stripped from the
  address bar before GA4 or a pixel loads; they report the full URL.
- A sent mail kept in a job or outbox table is a copy of personal data (and of any link secret it
  carries); retention and erasure cover that table.
- Data typed in by someone else about a third person (an address to confirm, a colleague) owes
  art. 14 information in the first mail: purpose, retention, privacy link.
- A "code" made from an address or IP with a plain hash is reversible; use an HMAC with a server
  secret and give the code its own retention.
