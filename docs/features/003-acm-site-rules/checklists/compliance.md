# Compliance checklist — 003 ACM rules on the site (phase 1, pre-build)

*compliance · 2026-11-15 · against `01-brief.md` (approved 2026-11-15 by the silence rule,
Q1–Q6 as assumed), `02-architecture.md` (contract 003.1, Amendment 1), ADR-0008, ADR-0009,
tickets BE-01…BE-03, FE-01, FE-02, the Control Room rows R4, R7, R8, R9, and the standing lists
`docs/process/checklists/compliance.md` and `_OS/playbook/templates/pipeline/checklists/compliance.md`.
I am not a lawyer. Items marked **lawyer** go into the ship report as needing one. Sources:
`[known]` = settled law not re-read tonight (the sandbox reads no outside pages for this run);
`[row]` = the ACM requirement as quoted in the Control Room row (`00-request.md`). Nothing here
changes a legal text; every legal-text change is listed as Julian's.*

The phase-4 review checks every item against the code and copy as shipped. The severity column
is the severity **if the item fails in phase 4**. **HARD STOP** marks a legal hard stop: it
blocks whatever the foreseeability rule says.

## Verdict at phase 1

- **One P0 against the design, folded (F-001).** The brief put the order confirmation inside
  the welcome mail. That mail is sent at the end of the `setup` job, which waits for proven
  ownership (`apps/worker/src/jobs/setup.ts:48`, `jobs/paid.ts:65`), and is never sent for a
  Monthly added later (`billing/index.ts:105-108`). Art. 6:227c BW asks that receipt of an
  electronic order is confirmed without delay, and between businesses that rule stands unless
  the parties agreed otherwise; the terms do not [known]. R9 asks for the confirmation right
  after payment [row]. As designed in the brief, a buyer who has not connected Google gets no
  confirmation at all. The architect moved it to its own mail from the webhook (ADR-0008,
  BE-02). Not open.
- **The B2B-only position holds, on conditions** (§1). It is checked, not assumed: the terms
  exclude consumers and the checkout makes the buyer confirm it acts for a business. It does
  not switch off the rules that bind B2B sellers too (§2), and it must not be undermined by
  copy that invites private persons.
- **One pre-existing question may be a launch hard stop and is not this feature's to fix**
  (F-004, **lawyer**): the day-7/21 mails after a free check go out without the news box and
  carry an offer. If counsel reads them as commercial communication under art. 11.7 Tw, they
  need prior consent. AC-7 makes them visible on the form, which is right, and it does not make
  them lawful. Julian item J-3.
- **Legal texts: none change in this build.** Three changes are proposed for Julian and
  counsel: the complaints article (J-1, wording in `02-architecture.md` §8), the terms price
  clause (J-2) and the privacy wording of the day-7/21 mails (J-3).

## 1. Is Vidalo B2B only? (checked, not assumed)

| ID | What must be true | Evidence today | How phase 4 checks | Sev |
|---|---|---|---|---|
| COMP-01 | The terms say the service is for businesses only and that consumer rules (withdrawal) do not apply | terms intro `index.ts:758`; clause 2.2 `index.ts:782`, EN `en.ts:759` | read both; unchanged by the diff | **HARD STOP** if removed |
| COMP-02 | The buyer confirms, before paying, that they act for a business: a required tick box and the B2B sentence above the pay button | `consent_collection: { terms_of_service: "required" }` `route.ts:121`; `custom_text` `route.ts:122-125`; copy `index.ts:2310-2312` | `checkout-consent.test.ts` green; J-6 screenshot of the box and sentence | **HARD STOP** if missing |
| COMP-03 | The site's own copy addresses businesses, not private persons: no plan or claim aimed at a consumer, prices stated excl. btw as a business price | `prijs.exclVat` `index.ts:572`; footer "Prijzen excl. btw" `index.ts:684`; FAQ "voor een bedrijf in Nederland is dat 21%" `index.ts:2324` | grep the diff for consumer-directed wording ("particulier", "voor thuis", "consument" outside the B2B sentences) | P1 |
| COMP-04 | The checkout collects business evidence beyond a tick: billing address required (`route.ts:117`) and a tax id `required: "if_supported"` (`route.ts:116`), which I read as "required where Stripe supports the buyer's country" — not verified tonight | Stripe's behaviour is not in the repo | J-6: does Stripe Checkout refuse an NL purchase without a btw number? Record yes/no | P2 (F-008; if "no", Julian decides on a KvK field, J-9) |

Assessment [known, **lawyer** for the final word]: whether a buyer is a consumer is a fact about
the purpose of the purchase, not about what the terms say; a seller may, however, rely on a
buyer's own representation that it acts for its business when the seller had no reason to doubt
it (CJEU Gruber, C-464/01). The product (a check of a business's listing, a facts page on its
domain, corrections at business directories) has no plausible private use, the buyer ticks that
it acts for a business, and Stripe asks a business tax id. On those facts the B2B position is
defensible. What would break it: a plan or copy aimed at private persons; dropping the tick;
taking orders from people who say they are not a business. If it ever breaks, the consumer rules
apply in full: 14-day withdrawal with the model form, and without the information the withdrawal
period runs up to 12 months longer (art. 6:230o BW) [known]; prices incl. btw (Prijzenbesluit)
[known]; ConsuWijzer in the terms and on /contact [row]; a pay button that names the payment
obligation (art. 6:230v lid 3 BW) [known].

**n/a, recorded with their condition:** dispute committee and ConsuWijzer (AC-5), withdrawal
right and model form (AC-13), customer-service phone tariff (R8), the consumer pay-button rule
(AC-16) — all n/a **only while COMP-01…03 hold**. ACM's own note on the rows: "set the rest n/a
only when the terms clearly exclude consumers and checkout refuses them" [row]; the brief reads
"refuses" as the tick plus the text (Q3, assumed yes). I agree that this is the best available
reading short of refusing on a missing KvK number; it is a **lawyer** item in the ship report.

## 2. Rules that bind B2B sellers too

| ID | Rule | What must be true | Evidence / ticket | How phase 4 checks | Sev |
|---|---|---|---|---|---|
| COMP-05 | Art. 3:15d BW (information society service): name, address, email, KvK number, btw number easily, directly and permanently accessible [known]; R4 [row] | every page and the coming-soon page show name, address, KvK, phone and btw in the footer, email one click away (Contact link, Support mailto in the footer columns `index.ts:681`) | BE-01, FE-01 | `e2e/company-details.spec.ts` normal + gate mode; J-7 clean browser on vidalo.ai | P1 (the btw number is already one click away on the legal pages, `index.ts:755`; so not a hard stop today) |
| COMP-06 | Handelsregisterbesluit 2008 art. 50: the KvK number on the website and on outgoing mail [known] | footer and every owner mail footer carry `KvK 42057858` | `layout.ts:145`; mail lab rule "company line" `mail-lab.mts:311` | mail lab green; footer e2e | **HARD STOP** if removed |
| COMP-07 | Name as registered (ACM bedrijfsgegevens [row]); a trade name in use is registered first (standing list) | footer names "A101 B.V."; "Vidalo" is a registered trade name of A101 B.V. | footer `index.ts:684`; registration not in the repo | J-4 (Julian confirms from the KvK extract) | **HARD STOP** if "Vidalo" is not registered (register before launch) |
| COMP-08 | Art. 6:227b BW: before an electronic contract, the steps, whether the contract is stored and accessible, how to correct input errors, the languages [known]; waivable only by agreement between businesses, not waived in the terms | Stripe Checkout shows the lines and lets the buyer go back (`cancel_url`, `route.ts:131`); terms in NL and EN, Dutch prevails (terms 2.8) | — | J-6 screenshots: summary, back link, language | P1 |
| COMP-09 | Art. 6:227c BW: receipt of the order confirmed electronically without delay [known]; R9 [row] | one order mail per Checkout session, queued at `checkout.session.completed` for every plan, paid or processing | BE-02, ADR-0008 | `billing.test.ts` rows; mail lab; J-6 received mail and its time | **HARD STOP** (F-001 was this) |
| COMP-10 | Art. 6:234 BW: general terms made available before or at the conclusion, electronically, in a way the buyer can store [known] | Stripe shows and links the terms before the box (`route.ts:122-125`); the order mail links them and names their version date (`copy.legal.updated`) | BE-02 | `order-mail.test.ts` asserts the link and the version string | P1 (F-007: a link to a page that changes is weaker than a stored copy; archived versions are row L4) |
| COMP-11 | Art. 6:230a–230e BW (services directive information): identity, legal form, address, KvK, btw, general terms, price or how it is computed, main features [known] | covered by COMP-05, COMP-10, COMP-14 | — | — | P1 |
| COMP-12 | Art. 6:194 BW (misleading advertising, also B2B) [known]; R7 [row] | no untrue statement of fact: no popularity claim pre-launch (there are no customers to choose), no statistic whose scope is hidden | BE-01 (`chip`, `snippers.body`), `copy-claims.test.ts` | the test, both controls red then green | **HARD STOP** if "Meest gekozen" / "Most chosen" ships (untrue); P1 for "10.000 bedrijven" without "(VS)" |
| COMP-13 | Art. 11.7a Tw and the AVG: no non-essential cookie without consent; reject as easy as accept; nothing pre-ticked [row] | consent toggles start off (`CookieConsent.tsx:28`); marketing box unchecked (`ScanField.tsx:87`) | FE-02 `no-preticked-boxes.test.ts` | the test with its control | **HARD STOP** if a consent box or toggle starts ticked |

## 3. Fair influence (R7)

| ID | What must be true | Ticket | How phase 4 checks | Sev |
|---|---|---|---|---|
| COMP-14 | The new chip is a description, not a ranking or popularity claim: "Voor wie elke maand wil controleren" / "For checking every month" | BE-01 | read; claims test | P1 |
| COMP-15 | The sentence under both email fields says plainly what follows: two more messages, **about the outcome and what we can do for you** (they carry an offer: `copy.mails.followUp`, `index.ts:3373`; the account page already says so, `index.ts:2831`), one-click unsubscribe, privacy link. Calling them only a "herinnering" would understate them (F-003) | BE-01, FE-02 | read both languages; e2e sees it under both fields | P1 |
| COMP-16 | The lawful basis of the day-7/21 mails (F-004, **lawyer**). They go to every free-check address (`cron.ts:151-165`) without the news box; the privacy text gives "gerechtvaardigd belang" (`index.ts:1024`); the code's own comment says a free check is no purchase, so news needs consent (`index.ts:63`). Art. 11.7 Tw asks prior consent for commercial e-mail, with the soft opt-in only for a customer's address obtained in a sale [known]. If counsel calls these mails commercial, they need consent | J-3 | counsel's answer recorded in `findings.md` | **HARD STOP for launch** if counsel says consent is needed and the mails still go without it; not a gate on this feature's merge |
| COMP-17 | Every "gratis" / "free" describes something that asks only an email address; the free check states the two mails next to the form (AC-7) | BE-01 snapshot | Julian reads the AC-10 list once in the PR | P1 |
| COMP-18 | No checkbox pre-ticked except boxes that show a choice already stored (hours, mail preferences). The follow-up preference shows "on" for an owner who never chose (`app/app/account/page.tsx:293`, absent = on, `mail-prefs.ts:19`); that is a preference screen, not a consent, and follows COMP-16 | FE-02 | the test's allow-list matches §7 of the architecture exactly | P1 (F-005) |
| COMP-19 | No ranking, scarcity, countdown or review widget is added | all | grep the diff for `nog \d`, `alleen vandaag`, `countdown`, `review` | P1 |

## 4. Price information before the order (R8)

| ID | What must be true | Ticket | How phase 4 checks | Sev |
|---|---|---|---|---|
| COMP-20 | The Monthly card states the total in the price itself, not in small print: `€149 eenmalig + €49 per maand, excl. btw` / `€149 once + €49 per month, excl. VAT`, at the size the architecture names (15 px bold under the figure) | BE-01, FE-02 | screenshot NL/EN at 375 and 1280 px; e2e text | P1 |
| COMP-21 | Every other surface that quotes the Monthly price to someone who has not paid Vidalo Scan also names the €149: the assistant (`chat/index.ts:103`), `/llms.txt` (`llms.txt/route.ts:34`), Vidalo's own facts page (`own.ts:70`), the JSON-LD offer (`seo.tsx:94`), the owner dashboard with no plan (`index.ts:2585`) (F-002) | BE-01, BE-03 | `price-surfaces.test.ts`, claims test rule 3 | P1 |
| COMP-22 | Prices are stated excl. btw with the word next to them; btw 21% named where a total is shown (FAQ `index.ts:2324`; order mail) | all | read | P1 (consumer-facing it would be a hard stop: Prijzenbesluit; n/a under §1) |
| COMP-23 | "Geen verborgen kosten" stays true: once the card shows both amounts nothing is hidden (Q5, assumed keep); counsel may prefer "Je ziet elke prijs vooraf" | J-5 | counsel's answer | P2 |
| COMP-24 | Prices have one source: the card, the order mail and the other surfaces are built from `PRICES` (`index.ts:19-24`); the terms state `€149` and `€49` again (`index.ts:865`), a second copy, and say nothing about Monthly starting with Scan (F-006) | BE-01 (card), J-2 (terms) | claims test; Julian's terms change | P1 |
| COMP-25 | The add-on (Monthly for an existing Scan customer, €49 alone) is offered and charged only to those customers (F-020) | BE-02 | route refuses `monitor_addon` without a paid Scan | P1 |

## 5. Order flow and the confirmation (R9)

| ID | What the order mail must carry (NL and EN, all three plans) | How phase 4 checks | Sev |
|---|---|---|---|
| COMP-26 | Product name(s), the date of the order | `order-mail.test.ts` | P1 |
| COMP-27 | Amounts excl. btw per line (when they add up), btw separately, the total paid or to be debited; for SEPA in processing, that the payment is still being processed and when the service starts (F-018) | `order-mail.test.ts`, `billing.test.ts` processing row | P1 |
| COMP-28 | Duration and renewal: Scan is one-off and renews nothing; Monthly renews every month, can be cancelled any month online without notice, the paid month runs out, a confirmation with the end date follows — the same words as terms art. 9 (`index.ts:876-878`) | read against the terms | P1 (a mail that promises other cancellation terms than the contract is a misleading statement, 6:194) |
| COMP-29 | What happens next and the start condition: we start once ownership is shown with Google; if that fails within 30 days the buyer may dissolve and is refunded (terms `index.ts:880`) (F-017) | read against the terms | P1 |
| COMP-30 | Links to the terms (with the version date) and the privacy statement, in the buyer's language; the company line with KvK and btw (mail footer) | mail lab rules; `order-mail.test.ts` control (remove the terms link → red) | **HARD STOP** for the company line and terms link missing together with no other confirmation (COMP-09) |
| COMP-31 | No consumer withdrawal text in the mail (it would contradict clause 2.2 and invite the consumer reading); no marketing in the mail | read | P1 |
| COMP-32 | The pay button: in payment mode Stripe shows "Betalen"/"Pay"; in subscription mode Stripe chooses the text and the code cannot set it (`submit_type` is payment-mode only). Under the consumer rule a button must name the payment obligation (art. 6:230v lid 3 BW) [known]; under §1 that rule is n/a. Record what Stripe shows for both plans | J-6 screenshots | P2 (becomes a hard stop if §1 fails) |
| COMP-33 | The invoice (from Stripe) carries A101 B.V., the address, KvK and btw numbers (standing list) | J-6: Stripe invoice PDF | P1 |

## 6. Complaints (R4)

| ID | What must be true | Owner | Sev |
|---|---|---|---|
| COMP-34 | The terms have a complaints article (how, where, within how many working days); proposed wording in `02-architecture.md` §8, 5 working days (Q4). It is legal text: Julian and counsel, new `updated` date, `legal:lock` | J-1 | P1 (ACM asks for the procedure "if any" [row]; not a statutory B2B duty I can name [known]) |
| COMP-35 | `/contact` says the same as the article once it exists, and nothing more: same channels, same 5 working days. Until J-1 lands, the contact paragraph is the only statement and must not promise more than the team does | FE-01; Julian confirms 5 days is real | P1 |
| COMP-36 | No reference to the EU ODR platform (closed 20 July 2025) and, under §1, none to ConsuWijzer or a geschillencommissie | BE-01, J-1 | P1 |

## 7. Personal data touched by this feature

| ID | What must be true | Sev |
|---|---|---|
| COMP-37 | The order mail uses the payer's address for the contract they just made (art. 6(1)(b) AVG) — no new purpose, no new recipient (Resend is already a processor) | P2 |
| COMP-38 | No address in events or logs (security SEC-07); the event log is exported to the owner (`core/shared/my-data.ts`), so an address there would travel | P1 |
| COMP-39 | The privacy statement needs no change for the order mail (it already covers mails about the plan, `index.ts:2834` sentence is copy, not legal); if counsel disagrees, it is Julian's | P2 |

## 8. Process items (standing list)

- COMP-40 — A decision recorded in the brief after the tickets were written is re-checked
  against the build in phase 4 (none yet; Q1–Q6 predate the tickets).
- COMP-41 — Every finding in the phase-4 report goes into `findings.md`, every go-live gate into
  `docs/go-live-checklist.md`, in the same run. J-1…J-9 are carried to the go-live list at ship.
- COMP-42 — "Built" is not "runs": rows R4, R7, R8, R9 stay `written` until J-6 (test order)
  and J-7 (clean browser on vidalo.ai) are done and dated.

## Out of lane
Tone, layout, chip wording taste. Compliance blocks on law and files P1s on the rest.
