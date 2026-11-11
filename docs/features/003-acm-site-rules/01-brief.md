# Brief — 003 ACM rules on the site

*analyst · 2026-11-12 · status: draft*

## The one sentence
Anyone who reads the Vidalo site, fills in a form or buys a plan sees who is behind it and what it costs before they commit, and nothing on the page claims more than is true yet.

## Why now
The site goes public when the launch gate comes off. The ACM rules on company details, honest influence, price information and the order flow apply from the first visitor, and the 22 Oct audit left gaps on all four (rows R4, R7, R8, R9). A re-audit on 2026-11-12 closed some of them (terms now say Vidalo is for businesses only, `copy.legal.draft` is false, the "Fictief voorbeeld" captions exist) and showed which remain. They are cheap to close now and expensive to explain after a complaint.

## Re-audit, 2026-11-12 (what is already fine, what is not)
| Row | Already met | Still open |
|---|---|---|
| R4 | name, address, KvK, phone in the footer line on every page and on /binnenkort (`index.ts:682`, `ComingSoonFooter.tsx:12`); email, WhatsApp, hours on /contact; btw number on the legal pages (`index.ts:753`) | btw number not in footer or on /contact; email not in footer line; no complaints procedure in the terms |
| R7 | "Fictief voorbeeld" captions; marketing box unchecked (`ScanField.tsx:83`); no scarcity or countdown copy | "Meest gekozen" chip (`index.ts:587`); no sentence under the scan or report-email field about the day-7/21 reminders; "10.000 bedrijven" without "(VS)" (`index.ts:136`, `en.ts:120`) |
| R8 | B2B-only clause (`index.ts:756, 780`); checkout needs a ticked box and says "niet voor consumenten" (`api/checkout/route.ts:119-122`) | "Geen verborgen kosten" (`index.ts:569`) next to a card that headlines €49 and shows the €149 only in small print (`index.ts:589-596`) |
| R9 | Stripe Checkout shows lines, VAT, terms and the pay button | welcome mail has no order summary, price, renewal and cancellation terms, terms link (`templates.ts:322`) |

## Who it is for
| Who | What they are trying to do | What they do today instead |
|---|---|---|
| A business owner on the site | Know who runs Vidalo, what it costs in total, and what they agreed to | Looks for the company line; may not find the btw number or a complaints route; sees the €149 only in the small print of the €49 card |
| A buyer who just paid | Keep a record of what they bought | Gets a set-up mail with no price or terms, relies on Stripe's receipt |
| Julian | Launch without an ACM-shaped hole | Has no list of what is still missing |

## Acceptance criteria
Numbered, observable, testable by someone who was not in the conversation. "Both languages" means `copy/index.ts` and `copy/en.ts`.

**R4 — company details**
1. **AC-1** — Given any page with `SiteFooter` or `ComingSoonFooter`, when the footer renders in NL and EN, then the company line contains name, address, KvK number, phone and the btw number NL869514192B01 (`footer.legal` in both files; the existing three-field line extended).
2. **AC-2** — Given `/contact` and `/en/contact`, when the page renders, then it shows email, phone, hours (already there), and the company line with btw number, so that "Onze bedrijfsgegevens staan onderaan" (`index.ts:735`) is true.
3. **AC-3** — Given `/binnenkort` and `/en/coming-soon`, when the page renders, then email and phone are visible and the footer carries the same company line (AC-1).
4. **AC-4** — Given the terms, when read in NL and EN, then they contain a short complaints article: how to complain (the support address and phone), that we answer within a stated number of working days, and that the court clause stays. **Legal text: see (b).**
5. **AC-5** — Dispute committee and ConsuWijzer are n/a, confirmed by: terms 1 "Vidalo is er alleen voor bedrijven" (`index.ts:756`) and AC-12.

**R7 — fair influence**
6. **AC-6** — Given the pricing section and `/prijzen` in NL and EN, when rendered, then no plan card carries a popularity claim; `landing.prijs.monitor.chip` is replaced or empty. Proposed: NL "Voor wie elke maand wil controleren", EN "For checking every month". Grep of `copy/*.ts` for `Meest gekozen|Most chosen|populair|popular|bestseller` returns nothing.
7. **AC-7** — Given the scan form (`ScanField`) and the report-email field (`EmailCapture`) in NL and EN, when rendered, then a sentence directly under the field says that two reminders follow and how to stop them, and links to the privacy statement. Proposed NL: "Je krijgt het rapport in je mail, en na 7 en 21 dagen nog een korte herinnering. Afmelden kan met één klik. Zie het [privacybeleid](/privacy)." EN: "The report comes to your inbox, followed by a short reminder after 7 and 21 days. You can unsubscribe with one click. See the [privacy policy](/en/privacy)."
8. **AC-8** — Given every occurrence of "10.000 bedrijven" or "10,000 businesses" in `copy/*.ts`, when read, then "(VS)" / "(US)" or "Amerikaanse"/"US" stands in the same sentence (`index.ts:136`, `en.ts:120` fixed; `index.ts:1636`, `en.ts:1593` already pass).
9. **AC-9** — Given every `<input type="checkbox">` in `apps/web`, when searched, then none carries `checked` or `defaultChecked` except controlled hours rows; a unit test pins that (control: adding `defaultChecked` to the marketing box fails it).
10. **AC-10** — Given the words "gratis" and "free" in customer-facing copy, when listed, then each describes something that asks nothing in return except an email address, and the free check says so once next to the form (AC-7 covers the email).

**R8 — price information before the order**
11. **AC-11** — Given the Vidalo Monthly plan card in NL and EN, when rendered, then the price line reads "€149 eenmalig + €49 per maand, excl. btw" / "€149 once + €49 per month, excl. VAT" next to or instead of the bare "€49"; the sentence under the heading "Geen verborgen kosten" stays true, or is reworded to "Je ziet elke prijs vooraf" / "You see every price up front" if counsel prefers.
12. **AC-12** — Given the checkout, when a session is created, then `consent_collection.terms_of_service` is required and the custom text says Vidalo is for businesses (already so: `route.ts:119-122`); a test pins both. Row note "checkout refuses them" is read as this tick box plus text, **confirmed by Julian (Q-3)**.
13. **AC-13** — Given the withdrawal right, when the terms are read, then they say it does not apply (B2B), already so (`index.ts:780`); n/a confirmed by: that line.

**R9 — order flow and confirmation**
14. **AC-14** — Given a completed checkout, when the confirmation is built (`welcomeEmail` for both plans, NL and EN), then the mail opens with an order block: product name, one-off amount and monthly amount excl. btw (21% shown separately), billing period, that Vidalo Monthly renews monthly and can be cancelled any month online with no notice period, a link to the terms and privacy statement, and the company line with btw number.
15. **AC-15** — Given the mail test (`pnpm mail:lab`), when run, then the order block and the company line are asserted for both languages and both plans; control: removing the terms link turns it red.
16. **AC-16** — Given the Stripe pay button, when the order is placed, then it says payment, not "Doorgaan". This is Stripe's wording ("Pay" / "Betalen") and is **checked by Julian on a real test order** (see (b)); the code does not set it.

**Cross-cutting**
17. **AC-17** — A test in `packages/core/test/` greps the copy for the banned patterns (AC-6, AC-8, AC-10) and for a missing btw number in `footer.legal`; each banned pattern was proven to fail the test before it passed.
18. **AC-18** — `corepack pnpm -r typecheck`, `corepack pnpm -r test` and `corepack pnpm e2e:mock` stay green; `legal.test.ts` still passes (see (b) for the legal lock).

## What a run may build, and what stays with Julian
**(a) A run may build** (code, copy outside the legal texts, tests): AC-1, 2, 3, 6, 7, 8, 9, 10, 11, 14, 15, 17, 18; the pinning tests in AC-12. All strings above in NL and EN; Julian approves line by line in the PR, as in feature 001.

**(b) Stays with Julian, under `_OS/AUTHORITY.md`:**
- Any change to `copy.legal` (terms, privacy, cookies). AC-4 (the complaints article) is legal text: a run writes the proposed wording into `02-architecture.md` for counsel and does not edit `copy.legal`. Changing it also needs a new `updated` date and `pnpm --filter @vidalo/core legal:lock`.
- Counsel (De Boer) review of the complaints article and of "Geen verborgen kosten" next to a one-off fee (rows R2, L5 are not carried here).
- The clean-browser check on vidalo.ai after deploy (the sandbox cannot reach it): home page and /binnenkort in NL and EN show every company field; phone answers; the reminder sentence shows under both fields.
- One real test order (row C1): screenshot of the summary and pay step, and the received mail.
- Deploys (manual) and the launch gate.

## Success metric
| Metric | Today | Target | How it is measured |
|---|---|---|---|
| Company fields on every page (name, address, KvK, phone, btw) | 4 of 5 in footer | 5 of 5 | grep of `footer.legal` in both files, test AC-17 |
| Popularity or unverifiable claims in copy | 1 chip, 1 inline stat | 0 | test AC-17 |
| Order confirmation fields (price, terms link, renewal, company line) | 0 of 4 | 4 of 4 | `mail:lab` assertions AC-15 |

## Explicitly not in this cycle
- Rewriting the terms or privacy text (legal, counsel).
- Consumer rules: withdrawal form, ConsuWijzer, customer-service rate. Vidalo is B2B only; n/a as in AC-5 and AC-13.
- Rows R2, L4 (the privacy link at every collection point; AC-7 delivers it at two of them, the row stays open until archived versions exist), L5, N1-N3.
- Changing the Stripe-hosted receipt.
- A review widget, ranking or scarcity feature (none exists; none is added).

## Dependencies and open questions
| # | Question | Blocks | Who answers | Assumed answer if silent |
|---|---|---|---|---|
| Q1 | Replace the "Meest gekozen" chip with a neutral label, or drop it? | AC-6 | Julian | Replace with "Voor wie elke maand wil controleren" / "For checking every month" |
| Q2 | Add the btw number to the footer line on every page? | AC-1 | Julian | Yes. SETUP_STATUS.md:7 left it off on purpose before launch; it is on the contact line of the legal pages already and the ACM asks for it before purchase |
| Q3 | Does the tick box plus "niet voor consumenten" count as "checkout refuses consumers"? | AC-12, AC-13 | Julian (counsel if in doubt) | Yes |
| Q4 | Which number of working days for answering a complaint? | AC-4 | Julian | 5 working days |
| Q5 | Keep the headline "Geen verborgen kosten" once the card shows €149 + €49? | AC-11 | Julian | Keep: nothing is hidden once the card shows both |
| Q6 | Should the order block also go into the Vidalo Scan (one-off) mail? | AC-14 | Julian | Yes, both plans |

## Risks
| Risk | Likelihood | If it happens | What we do about it now |
|---|---|---|---|
| The footer line gets long on a phone | Medium | Wraps awkwardly | The line already wraps; check at 375 px in e2e |
| A copy change reaches `copy.legal` and breaks the legal lock | Low | `legal.test.ts` red | Run touches no key under `legal` |
| The confirmation mail repeats a price that later changes | Medium | Mail and site disagree | Build the block from `PRICES` (`index.ts:18-19`), never typed |
| The sandbox cannot see the live site | Certain | "Verified" claimed without evidence | Rows stay `written` until Julian's clean-browser check |
