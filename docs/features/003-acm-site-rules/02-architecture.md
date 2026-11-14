# Architecture — 003 ACM rules on the site

*architect · 2026-11-15 · contract 003.1 · built against `01-brief.md` as approved on the night of 2026-11-15
by the 48-hour silence rule (needs-you Q-20261112-01; Q1–Q6 stand as assumed). Code read at
`1cf3de5` (origin/main). Line numbers below are from that commit; the brief's were from
`b5577b1` and are about two lines lower in places. Gaps are rows in `findings.md` (F-001 on).*

**Amendment 1 (2026-11-15, after the phase-1 security and compliance checklists, F-001…F-021):**
the order block moves out of the welcome mail into its own mail sent from the payment webhook
(F-001, ADR-0008); the reminder sentence of AC-7 says what the two mails are (F-003); the
Monthly price is stated with its start fee on every surface that names it, not only the card
(F-002, ticket BE-03); the checkout's "no Stripe key" path stops granting a plan outside mock
mode (F-009, ticket BE-02); the add-on checkout requires a paid Vidalo Scan (F-020, BE-02); the checkbox test of AC-9 allow-lists boxes that render a stored
choice (F-005). These are already written into the sections below; nothing below is older
than the amendment.

## 1. Shape

This feature is copy, one new mail and tests. No table, no migration, no new route, no new
outside host, no new cookie. Three pieces:

1. **Copy (packages/core).** Every new or changed string lands in `copy/index.ts` and
   `copy/en.ts` in one ticket (BE-01), first, so the two lanes never edit the same file.
   The company identity gets one source, `COMPANY` beside `CONTACT` in
   `core/shared/contact.ts` (ADR-0009); `landing.footer.legal` is built from it and gains the
   btw number. The two plan prices are built from `PRICES` instead of typed (`index.ts:577`,
   `:591`, `en.ts:561`, `:575` are literals today). A test (`copy-claims.test.ts`) fails on a
   popularity claim, an unqualified "10.000 bedrijven", a Monthly price without its start
   fee, and a footer line without the btw number.
2. **Pages (apps/web).** The footer components already render `landing.footer.legal`
   (`SiteFooter.tsx:22`, `:71`; `ComingSoonFooter.tsx:12`), and the mail layout renders the
   same string at the foot of every owner mail (`reporter/layout.ts:145`), so the btw number
   reaches every page and every mail through one key. The price card shows the total
   `€149 eenmalig + €49 per maand, excl. btw` directly under the big figure
   (`PriceBlock.tsx:56-57`); the chip changes (`:53`). The scan form (`ScanField.tsx`) and the
   report-mail field (`app/r/[id]/EmailCapture.tsx`) get one sentence under the field about
   the two mails that follow, with a link to the privacy statement. `/contact` gets a short
   complaints paragraph (not legal text; it mirrors the article proposed in §8 for counsel).
3. **Order confirmation (packages/core billing + reporter, apps/worker).** A new mail kind,
   `order_confirmation`, is queued by the Stripe webhook on `checkout.session.completed` for
   every plan (`setup`, `monitor`, `monitor_addon`), whether the payment is paid or still
   processing, once per Checkout session. It carries the order, the amounts Stripe charged,
   the renewal and cancellation terms, the start condition, links to the terms (with their
   version date) and privacy statement, and the company line. The welcome mail is unchanged.

How a purchase flows after this feature:

```
Stripe Checkout ──checkout.session.completed──▶ /api/stripe/webhook (signature checked, unchanged)
   └─ core/billing handleStripeEvent → apply()
        ├─ queueOrderConfirmation(business, session)          NEW, every plan, paid or processing
        │     dedupe: event "order_confirmation.queued" {sessionId}; job email/order_confirmation
        └─ activate()  (paid only, unchanged) → setup job → waits for ownership proof → welcome mail
worker email job "order_confirmation" → reporter.sendOrderConfirmation → deliverTo(payer)
```

Why not in the welcome mail, as AC-14 first said: the welcome mail is sent at the end of the
`setup` job (`apps/worker/src/jobs/setup.ts:48`), and `setup` is a paid-only job that waits for
proven ownership (`apps/worker/src/jobs/paid.ts:15`, `:65`, "owner_not_verified"). A buyer who
has not yet connected Google gets no welcome mail at all, possibly for weeks; a Monthly added
later (`monitor_addon`) never gets one (`billing/index.ts:105-108` returns before `setup`).
The confirmation would not be "right after payment" (R9) nor "without delay" (art. 6:227c BW).
See ADR-0008 and F-001.

## 2. Decisions

| ADR | Decision | Why | Alternative rejected |
|---|---|---|---|
| ADR-0008 | The order confirmation is its own required mail, queued by the payment webhook for every plan, once per Checkout session | The welcome mail waits for ownership proof and never goes for an add-on; a confirmation must follow the order, not the set-up | Order block in `welcomeEmail` (brief AC-14 as first written); relying on Stripe's receipt (a setting outside the repo, not in our words, no terms link) |
| ADR-0009 | Company identity has one source, `COMPANY` in `core/shared/contact.ts`; every company line outside `copy.legal` is built from it, and `copy.legal.contact` is checked against it by test | Five copies of the same KvK/btw/phone exist today (`index.ts:684`, `:755`, `en.ts:668`, `:732`, `own.ts:45-48`); one more field (btw) is the moment to stop copying | Typing the btw number into `footer.legal` by hand (a sixth copy); building `copy.legal.contact` from it too (touches legal text, Julian's) |

ADR numbers continue after the highest in `docs/features/*/adr/` (0007). Features 001 and 002
both used 0001–0007, so a bare "ADR-0003" is ambiguous; this feature cites ADRs as
`003/ADR-0008` where it matters (F-011).

Not an ADR (they do not outlive the feature as decisions): the chip wording, the reminder
sentence, the contact-page complaints paragraph.

## 3. What changes where, per acceptance criterion

| AC | Today (evidence) | Change | Ticket |
|---|---|---|---|
| AC-1 | `footer.legal` has name, address, KvK, phone, no btw (`index.ts:684`, `en.ts:668`); rendered by `SiteFooter.tsx:22,71`, `ComingSoonFooter.tsx:12`, every owner mail `layout.ts:145`, every support reply `support/index.ts:27` | `footer.legal` built from `COMPANY` with `btw NL869514192B01` / `VAT NL869514192B01` | BE-01 (copy), FE-01 (e2e at 375 px) |
| AC-2 | `/contact` shows WhatsApp, phone, mail, hours (`contact/page.tsx:19-21`), "bedrijfsgegevens … staan onderaan" (`index.ts:737`), footer via `SiteFooter` | sentence names the btw number; new complaints paragraph | BE-01, FE-01 |
| AC-3 | `/binnenkort` shows WhatsApp, phone, mail (`binnenkort/page.tsx:108-116`), footer line (`:128`) | nothing beyond AC-1; e2e asserts | FE-01 |
| AC-4 | no complaints article in the terms (sections listed at `index.ts:762-990`) | **legal text, Julian's** (J-1). Proposed wording in §8 | — |
| AC-5 | terms intro and clause 2.2 (`index.ts:758`, `:782`) | none; n/a recorded in the compliance checklist | — |
| AC-6 | `monitor.chip: "Meest gekozen"` / `"Most chosen"` (`index.ts:589`, `en.ts:573`) | `"Voor wie elke maand wil controleren"` / `"For checking every month"` | BE-01 |
| AC-7 | no sentence under `ScanField` email (`ScanField.tsx:67-85`) or `EmailCapture` (`EmailCapture.tsx:31-38`) | `scanField.reminders` rendered under both fields, with privacy link | BE-01, FE-02 |
| AC-8 | `snippers.body` "10.000 bedrijven" (`index.ts:138`), "10,000 businesses" (`en.ts:122`) | "10.000 Amerikaanse bedrijven" / "10,000 US businesses" | BE-01 |
| AC-9 | marketing box unchecked (`ScanField.tsx:87`); account mail boxes `defaultChecked` from stored prefs (`app/app/account/page.tsx:293`); hours boxes controlled (`FactsForm.tsx:71`) | test `no-preticked-boxes.test.ts` with an explicit allow-list (§7) | FE-02 |
| AC-10 | 47 "gratis" in `index.ts`, 53 "free" in `en.ts`; the free check asks an address (`core/shared/free-check.ts`) | the claims test lists each occurrence's key path in a snapshot reviewed once by Julian in the PR; AC-7 sentence is the "says so once next to the form" | BE-01 |
| AC-11 | card headlines `€49 per maand`, start fee in the 13 px limit line (`index.ts:591-598`, `PriceBlock.tsx:56-67`) | new `monitor.total` under the figure; limit line drops the bracketed duplicate | BE-01, FE-02 |
| AC-11 (F-002) | Monthly as `€49 per maand` without the start fee in the assistant (`chat/index.ts:103`), `/llms.txt` (`llms.txt/route.ts:34`), Vidalo's own facts page (`own.ts:70`), JSON-LD offer (`seo.tsx:94`) | each states the €149 start | BE-03 |
| AC-12 | `consent_collection: { terms_of_service: "required" }` and B2B custom text (`api/checkout/route.ts:121-125`; copy `index.ts:2310-2312`) | pinning test (source + copy) | BE-03 |
| AC-13 | clause 2.2 excludes withdrawal (`index.ts:782`, `en.ts:759`) | none | — |
| AC-14 | welcome mail has no order block (`templates.ts:323-357`) and may never be sent (§1) | new `orderConfirmationEmail`, queued by the webhook (ADR-0008) | BE-02 |
| AC-15 | mail lab checks company line generically (`scripts/mail-lab.mts:311`) | `order_confirmation` kind in the lab with order-block rules; vitest over 3 plans × 2 languages with a control | BE-02 |
| AC-16 | Stripe decides the button text; `submit_type` exists only in payment mode | none in code; Julian's test order (J-6) records it | — |
| AC-17 | none | `copy-claims.test.ts` (patterns proven red first) | BE-01 |
| AC-18 | green on main | stays green; `legal.lock.json` untouched because nothing under `copy.legal` changes | all |

## 4. Data model

No table and no migration. Three non-table shapes:

```ts
// packages/core/src/shared/contact.ts — beside CONTACT (ADR-0009)
export const COMPANY = {
  legalName: "A101 B.V.",
  tradeName: "Vidalo",
  street: "Factorij 80",
  postcode: "3071 AV",
  city: "Rotterdam",
  kvk: "42057858",
  vat: "NL869514192B01",
} as const; // phone and email stay in CONTACT
```

```ts
// apps/worker/src/jobs/types.ts — one more member of the email job union
| { template: "order_confirmation"; businessId: string; sessionId: string;
    /** the payer, from the verified webhook only (customer_details.email) */ to: string;
    lang: "nl" | "en"; plan: "setup" | "monitor" | "monitor_addon";
    /** minor units, as Stripe charged them */ amounts: { subtotal: number; tax: number; total: number; currency: "eur" };
    paid: boolean; orderedAt: string /* ISO, session.created */ }
```

Events (in the existing `event` table, no address in any payload):
- `order_confirmation.queued` `{ sessionId, plan, paid, jobId }` — the dedupe key;
- `email.order_confirmation` `{ to: "payer", sessionId, subject, mode, id }` — written by `deliverTo`;
- `order_mail.amount_mismatch` `{ sessionId, plan, expected, charged }` — when the session's
  subtotal differs from `PRICES` (the mail then shows Stripe's totals without the per-line split).

Invariants and what enforces them:
- one confirmation per Checkout session: `queueOrderConfirmation` refuses when an
  `order_confirmation.queued` event with that `sessionId` exists, and `sendOrderConfirmation`
  refuses when an `email.order_confirmation` with that `sessionId` exists (a retried job after a
  send). Application-level, like every other mail dedupe in this repo (`cron.ts:160`); the
  webhook already serialises per event (`billing/index.ts:76-79`, `seen()`). Accepted: a
  concurrent duplicate delivery of the same event could queue twice; the send-side check
  catches it.
- the order mail is required: `order_confirmation` is added to `REQUIRED_MAIL_KINDS`
  (`mail-prefs.ts:34`) and is not in `OPTIONAL_MAIL_KINDS`, so neither preferences nor the
  unsubscribe link can stop it; it carries no marketing.

## 5. Copy keys (both languages; BE-01 writes them, everyone else reads them)

Shape is enforced by `CopyShape` (`en.ts` must have the same keys). Function-valued keys keep
the existing house style (`mails.*`).

| Key | NL | EN |
|---|---|---|
| `landing.footer.legal` (changed; built from `COMPANY`, `CONTACT.phone`) | `Vidalo (onderdeel van A101 B.V.) · Factorij 80, 3071 AV Rotterdam, Nederland · KvK 42057858 · btw NL869514192B01 · +31 85 109 1393 · Prijzen excl. btw` | `Vidalo (part of A101 B.V.) · Factorij 80, 3071 AV Rotterdam, the Netherlands · KvK 42057858 · VAT NL869514192B01 · +31 85 109 1393 · Prices excl. VAT` |
| `landing.prijs.setup.price` (changed: from `PRICES`) | `` `€${PRICES.setupEur}` `` | same |
| `landing.prijs.monitor.price` (changed: from `PRICES`) | `` `€${PRICES.monitorEurPerMonth}` `` | same |
| `landing.prijs.monitor.chip` (changed) | `Voor wie elke maand wil controleren` | `For checking every month` |
| `landing.prijs.monitor.total` (new) | `` `€${PRICES.setupEur} eenmalig + €${PRICES.monitorEurPerMonth} per maand, excl. btw` `` | `` `€${PRICES.setupEur} once + €${PRICES.monitorEurPerMonth} per month, excl. VAT` `` |
| `landing.prijs.monitor.limit` (changed: the bracket goes, the total says it) | `1 vestiging · maandelijks opzegbaar · start met Vidalo Scan` | `1 location · cancel any month · starts with Vidalo Scan` |
| `landing.prijs.sub` | unchanged (Q5: keep "Geen verborgen kosten"; counsel J-5) | unchanged |
| `landing.snippers.body` (changed) | `… In een controle van 10.000 Amerikaanse bedrijven klopte bij de helft …` | `… In a check of 10,000 US businesses, half had …` |
| `scanField.reminders` (new) `{ text, link }` | `text: "Je krijgt het rapport in je mail, en na 7 en 21 dagen nog een kort bericht over de uitkomst en wat we voor je kunnen doen. Afmelden kan met één klik."` `link: "Zie het privacybeleid."` | `text: "The report comes to your inbox, followed by a short message after 7 and 21 days about the outcome and what we can do for you. You can unsubscribe with one click."` `link: "See the privacy policy."` |
| `pages.contact.company` (changed) | `Onze bedrijfsgegevens staan onderaan deze pagina: naam, adres, KvK-nummer, btw-nummer en telefoon. Post mag naar dat adres; een berichtje is sneller.` | `Our company details are at the foot of this page: name, address, KvK number, VAT number and phone. Post is welcome at that address; a message is faster.` |
| `pages.contact.complaint` (new) `{ h, p }` | `h: "Een klacht"` `p: "Ben je ergens niet tevreden over? Mail support@vidalo.io of bel +31 85 109 1393 op werkdagen van 09:00 tot 17:00, en zeg dat het om een klacht gaat. Je krijgt binnen 5 werkdagen een antwoord met wat we eraan doen."` | `h: "A complaint"` `p: "Not happy with something? Email support@vidalo.io or call +31 85 109 1393 on working days from 09:00 to 17:00, and say it is a complaint. You get an answer within 5 working days with what we will do about it."` |
| `ownerArea…mails.required` (`index.ts:2834`, `en.ts:2754`, changed) | `Je welkomstmail, de bevestiging van je bestelling, je eerste rapport, stappen die alleen jij kunt zetten, een bericht als we een fout niet kunnen oplossen, en mails over je abonnement en je inlog.` | `Your welcome email, the confirmation of your order, your first report, steps only you can take, a message when we cannot fix an error, and emails about your plan and your login.` |
| `dashboard.scanOnly.bodyNone` (`index.ts:2585`, `en.ts:2515`, changed, F-002) | `… hoort bij Vidalo Monthly: €49 per maand excl. btw, maandelijks opzegbaar. Heb je nog geen Vidalo Scan gehad, dan komt daar €149 eenmalig bij.` | `… come with Vidalo Monthly: €49 per month excl. VAT, cancel any month. If you have not had Vidalo Scan yet, €149 once comes on top.` |
| `mails.order` (new) | see below | see below |

`mails.order` (NL; EN in the same shape, plain translation, informal "you"):

```ts
order: {
  subject: (product: string) => `Je bestelling bij Vidalo: ${product}`,          // EN `Your Vidalo order: ${product}`
  preheader: "Wat je bestelde, wat het kost en wat er nu gebeurt.",               // "What you ordered, what it costs and what happens next."
  headline: (business: string) => `Je bestelling voor ${business}`,               // `Your order for ${business}`
  intro: "Dit is de bevestiging van je bestelling. Bewaar deze mail.",            // "This confirms your order. Keep this email."
  orderTitle: "Je bestelling",                                                     // "Your order"
  orderedOn: (date: string) => `Besteld op ${date}`,                               // `Ordered on ${date}`
  lineSetup: (amount: string) => `Vidalo Scan, eenmalig: ${amount} excl. btw`,     // `Vidalo Scan, once: ${amount} excl. VAT`
  lineMonthly: (amount: string) => `Vidalo Monthly, per maand: ${amount} excl. btw`, // `Vidalo Monthly, per month: ${amount} excl. VAT`
  subtotal: (amount: string) => `Samen: ${amount} excl. btw`,                      // `Together: ${amount} excl. VAT`
  vat: (amount: string, rate: string | null) => `Btw${rate ? ` (${rate})` : ""}: ${amount}`, // `VAT${…}: ${amount}`
  totalPaid: (amount: string) => `Betaald: ${amount}`,                             // `Paid: ${amount}`
  totalProcessing: (amount: string) => `Wordt afgeschreven: ${amount}`,            // `To be debited: ${amount}`
  processing: "Je betaling per incasso wordt nog verwerkt; dat kan enkele werkdagen duren. We beginnen als ze binnen is.",
  termsTitle: "Looptijd en opzeggen",                                              // "Term and cancelling"
  termsSetup: "Vidalo Scan is een eenmalige opdracht. Er verlengt niets.",
  termsMonthly: "Vidalo Monthly verlengt elke maand vanzelf. Opzeggen kan elke maand online onder ‘Abonnement’ in je account, zonder opzegtermijn: de maand die je al betaalde loopt af, daarna betaal je niets meer. Je krijgt dan direct een bevestiging met de einddatum.",
  startAfterProof: "We beginnen zodra je hebt laten zien dat het bedrijf van jou is, met je Google-account. Lukt dat niet binnen 30 dagen, dan mag je de bestelling ontbinden en krijg je terug wat je betaalde.",
  startNow: "Je hebt al laten zien dat het bedrijf van jou is, dus we beginnen meteen.",
  docsTitle: "Wat er geldt",                                                       // "What applies"
  terms: (version: string) => `Algemene voorwaarden (${version.toLowerCase()})`,   // from copy.legal.updated: "versie van 14 november 2026"
  privacy: "Privacybeleid",
  invoice: "Je factuur, met de btw apart, krijg je van onze betaaldienst Stripe.",
  questions: "Vragen over je bestelling? Mail support@vidalo.io of bel +31 85 109 1393, op werkdagen van 09:00 tot 17:00.",
}
```

Wording rules the copy obeys (CLAUDE.md conventions, `docs/MESSAGING.md`): informal "je", no
exclamation marks, none of the banned words, every price excl. btw stated as such, product
names from `copy.checkout.productSetup/productMonitor` (`index.ts:2307-2308`), the start
condition matches terms art. 9 ("Looptijd, opzeggen en pauzeren", `index.ts:880`) and the
cancel text matches terms `index.ts:878`. Julian approves every new string line by line in the
PR, as in feature 001.

## 6. Interface contract

The boundary the two lanes build against. After BE-01 merges, every key in §5 exists; FE work
can start on a branch cut from BE-01 or against the key names alone (they are fixed here).

| Operation | Input | Output | Errors | Who may call it |
|---|---|---|---|---|
| `copy.landing.footer.legal`, `copy.landing.prijs.monitor.{chip,total,limit,price}`, `copy.scanField.reminders`, `copy.pages.contact.{company,complaint}` | — | strings (§5) | typecheck fails when a key is missing in EN | FE components |
| `orderConfirmationEmail(d: OrderData): Mail` (`reporter/templates.ts`) | `OrderData = { lang; business: Pick<Business,"name">; plan: "setup"\|"monitor"\|"monitor_addon"; amounts: { subtotal; tax; total; currency: "eur" }; lines: { setup?: number; monthly?: number } \| null; paid: boolean; orderedAt: string; ownerVerified: boolean; links: { termsUrl; privacyUrl; accountUrl } }` | `Mail` via `renderMail` (company line in its footer, `layout.ts:145`) | none (pure) | `sendOrderConfirmation`, tests, mail lab |
| `queueOrderConfirmation(business, session): Promise<"queued"\|"duplicate"\|"no_address">` (`core/billing/order-mail.ts`, new) | the Stripe Checkout session object from a verified event, or the mock session from `mockCheckoutSession(plan, lang, email)` | one `email` job + `order_confirmation.queued` event | `no_address` when `customer_details.email` is absent or not an address (log `order_mail.no_address`, no throw) | `billing.apply` on `checkout.session.completed`; the mock checkout path when `env.mock` |
| `sendOrderConfirmation(job): Promise<MailResult\|null>` (`reporter/index.ts`) | the job payload of §4 | sends to `job.to`; event `email.order_confirmation` | returns null when already sent for `sessionId` | worker `email` handler (`jobs/misc.ts`, new `case "order_confirmation"`) |
| `deliverTo(business, m, type, to, extra)` (`reporter/index.ts`, new, private) | as `deliver` but the recipient is `to`, never `business.ownerEmail` | as `deliver` | as `deliver` | `sendOrderConfirmation` only |
| `POST /api/checkout`, no Stripe key | — | outside mock mode: 303 `?betaling=fout`, event `checkout.refused {reason:"no_stripe"}`; in mock mode: today's behaviour plus `queueOrderConfirmation(mockCheckoutSession(...))` | — | unchanged callers |
| `POST /api/checkout`, `plan=monitor_addon` (F-020) | form `business`, `plan` | only when the business has `plan === "setup"` and status `trial`/`active` (same rule as `canAdd`, `app/app/abonnement/page.tsx:44`); else 303 `/app/abonnement`, event `checkout.refused {reason:"addon_without_scan"}` | — | a verified member, as today |

`lines` is `null` when `amounts.subtotal` ≠ the plan's sum from `PRICES` in cents
(setup 14900; monitor 4900 + 14900; monitor_addon 4900); the mail then shows subtotal, btw and
total only. The btw rate is printed only when `tax * 100 / subtotal` is exactly 21; otherwise
the amount alone (Stripe Tax and reverse charge produce other numbers). Amounts are formatted
with `Intl.NumberFormat(lang === "en" ? "en-IE" : "nl-NL", { style: "currency", currency: "EUR" })`.
The language is `session.locale` when it is `nl` or `en` (checkout sets it, `route.ts:113`),
else `business.language`.

### File ownership (no file has two owners)

| File | Ticket |
|---|---|
| `packages/core/src/copy/index.ts`, `copy/en.ts`, `core/shared/contact.ts`, `packages/core/test/copy-claims.test.ts` | BE-01 |
| `apps/web/components/SiteFooter.tsx` (only if wrapping needs a class), `ComingSoonFooter.tsx` (same), `apps/web/app/contact/page.tsx`, `e2e/company-details.spec.ts` (new) | FE-01 |
| `apps/web/components/PriceBlock.tsx`, `ScanField.tsx`, `apps/web/app/r/[id]/EmailCapture.tsx`, `packages/core/test/no-preticked-boxes.test.ts` (new), `e2e/forms.spec.ts` (extend) | FE-02 |
| `packages/core/src/billing/index.ts`, `billing/order-mail.ts` (new), `reporter/templates.ts`, `reporter/index.ts`, `shared/mail-prefs.ts`, `apps/worker/src/jobs/{types,misc}.ts`, `apps/web/app/api/checkout/route.ts`, `scripts/mail-lab.mts`, `packages/core/test/{order-mail,billing}.test.ts` | BE-02 |
| `packages/core/src/chat/index.ts`, `apps/web/app/llms.txt/route.ts`, `packages/core/src/shared/own.ts`, `apps/web/lib/seo.tsx`, `packages/core/test/{checkout-consent,price-surfaces}.test.ts` (new) | BE-03 |

BE-02 and BE-03 need copy keys too (`mails.order`, nothing for BE-03); they are in BE-01's
list so that only BE-01 edits the copy files. If a lane finds it needs a new string, it asks
in the PR and BE-01's owner adds it; it does not edit `index.ts` itself.

## 7. Authorisation model

Nothing new is readable or writable by anyone. The order mail's only trigger is a
Stripe-signed webhook event (unchanged verification in the webhook route) or the mock checkout
in mock mode; its recipient comes from that event only. No URL, form field or page can cause an
order mail. The checkbox test's allow-list (AC-9, F-005):

| File:line | Why it may be checked | Rule the test asserts |
|---|---|---|
| `app/app/gegevens/FactsForm.tsx:71` | controlled `checked={r.closed}`: renders the owner's own hours | `checked=` bound to state, never a literal `true` |
| `app/app/account/page.tsx:293` | `defaultChecked` renders the stored mail preference (`business.mailPrefs`) | expression reads `mailPrefs`; never a literal |
| everything else, and always `name="marketing"` | — | no `checked`, no `defaultChecked` |

Control: add `defaultChecked` to the marketing box in `ScanField.tsx` → red. The pre-ticked
follow-up preference for an owner who never chose is a compliance question, not a test
exemption: F-004/F-005, Julian item J-3.

## 8. Proposed legal wording for counsel (AC-4; not written into `copy.legal`)

A new article "Klachten" / "Complaints", placed directly before "Toepasselijk recht en
geschillen" (`index.ts:977`) so the article numbers that mails and pages cite (5, 9) do not
move. Adding it needs a new `updated` date in both files and
`pnpm --filter @vidalo/core legal:lock`. Q4 (5 working days) stands as assumed.

NL:
> **Klachten**
> 1. Ben je niet tevreden over de Dienst of over hoe we met je omgaan, laat het ons dan weten: per e-mail aan support@vidalo.io of telefonisch op +31 85 109 1393, op werkdagen van 09:00 tot 17:00. Beschrijf zo precies mogelijk waar het om gaat.
> 2. We bevestigen je klacht en geven je binnen 5 werkdagen een inhoudelijk antwoord. Hebben we meer tijd nodig, dan laten we je binnen die 5 werkdagen weten waarom en wanneer je het antwoord krijgt.
> 3. Komen we er samen niet uit, dan geldt het volgende artikel.

EN:
> **Complaints**
> 1. If you are not satisfied with the Service or with how we deal with you, tell us: by email to support@vidalo.io or by phone on +31 85 109 1393, on working days from 09:00 to 17:00. Describe as precisely as you can what it is about.
> 2. We confirm your complaint and give you a substantive answer within 5 working days. If we need more time, we tell you within those 5 working days why and when you will have the answer.
> 3. If we cannot resolve it together, the next article applies.

No ConsuWijzer and no geschillencommissie: the terms exclude consumers (clause 2.2,
`index.ts:782`) and A101 is not a member of one (AC-5). The EU ODR platform is closed and is
not mentioned.

Two more legal-text items found in shape (Julian's, not in this build): terms "Prijzen en
betalen" states `Vidalo Monthly kost €49 per maand` without saying it starts with Vidalo Scan,
and is a second copy of the prices (`index.ts:865`; F-006, J-2); the privacy statement calls
the day-7/21 mails "een korte herinnering over de uitkomst" (`index.ts:1021`) while they carry
an offer (F-003/F-004, J-3).

## 9. Failure modes

| What fails | Detected how | What the user sees | What we do |
|---|---|---|---|
| Webhook event without `customer_details.email` | `queueOrderConfirmation` returns `no_address`; log `order_mail.no_address` | no order mail; Stripe's own receipt if switched on | nothing automatic; the log line is the alarm. Checkout always collects an address, so this is a Stripe change |
| Session subtotal ≠ `PRICES` (env price ids out of step) | event `order_mail.amount_mismatch` | mail shows Stripe's totals, no per-line split | the mismatch is the bug; fix the price id or `PRICES` |
| Email job fails after the send | job retries | possibly nothing (dedupe on `email.order_confirmation`) | send-side check refuses the second send |
| Same event delivered twice concurrently | two `order_confirmation.queued` | one mail (send-side check) | accepted |
| SEPA processing, later fails (`async_payment_failed`) | existing `payment.failed` event | an order mail said "wordt afgeschreven", then no service | unchanged behaviour of Stripe's failure mail; recorded as F-018, no second mail in this feature |
| Footer line too long at 375 px | `e2e/company-details.spec.ts` at 375 px: no horizontal scroll | wrapped line | the line already wraps (`flex-wrap`, `ComingSoonFooter.tsx:11`) |
| Production deployed without `STRIPE_SECRET_KEY` | `checkout.refused {reason:"no_stripe"}` | "Afrekenen lukt nu even niet" (`copy.checkout.error`) | was: a free plan (F-009) |

## 10. Test plan

Every new test is shown red first (the control named), then green.

| Test | Proves | Control that must fail |
|---|---|---|
| `packages/core/test/copy-claims.test.ts` (BE-01) | no `Meest gekozen\|Most chosen\|populair\|popular\|bestseller\|meest gekozen` in `copy` and `en` (outside `legal`); every `10.000 bedrijven` / `10,000 businesses` has `VS\|Amerikaanse\|US` in the same sentence; every string naming the Monthly price per month also names the start fee or is `monitor.price`; `footer.legal` (both) contains `COMPANY.kvk`, `COMPANY.vat`, `CONTACT.phone`, `COMPANY.street`, `COMPANY.legalName`; `copy.legal.contact` contains the same five; a snapshot of every key path holding `gratis`/`free` (AC-10) | put back each old string (chip, `10.000 bedrijven`, footer without btw): three reds |
| `packages/core/test/no-preticked-boxes.test.ts` (FE-02) | §7 table | `defaultChecked` on the marketing box |
| `packages/core/test/order-mail.test.ts` (BE-02) | for `setup`, `monitor`, `monitor_addon` × `nl`, `en`: subject names the product; text has the product line(s), excl.-btw amounts, btw, total, `orderedOn`, the renewal or no-renewal sentence, the start sentence, a link to `/voorwaarden` (`/en/terms`) and `/privacy` (`/en/privacy`), the terms version, the company line with KvK and btw; no `cs_`/`sess`/`invoice.stripe.com`/`session_id` in text or HTML; hostile business name escaped | remove the terms link from the template → red (AC-15) |
| `packages/core/test/billing.test.ts` (BE-02, extended) | `checkout.session.completed` paid → one job; processing → one job with `paid:false`; then `async_payment_succeeded` → no second job; duplicate event → none; `monitor_addon` → one job; no address → none and no throw | comment out the dedupe → two jobs |
| `scripts/mail-lab.mts` (BE-02) | kind `order_confirmation` present for both journeys; rules: contains `A101 B.V.`, `NL869514192B01`, a terms link, `btw`/`VAT`; no `List-Unsubscribe` | drop the terms link → lab FAIL |
| `packages/core/test/checkout-consent.test.ts` (BE-03) | `route.ts` source has `consent_collection: { terms_of_service: "required" }` and `custom_text.submit` from `consentSubmit`; `consentSubmit` says `niet voor consumenten` / `not for consumers`; the no-Stripe path checks `env.mock` | change `"required"` to `"none"` → red |
| `packages/core/test/price-surfaces.test.ts` (BE-03) | assistant price answer, `/llms.txt` text, own facts prices name the €149 start next to €49 | revert `chat/index.ts:103` → red |
| `e2e/company-details.spec.ts` (FE-01) | `/`, `/en`, `/contact`, `/en/contact`, `/binnenkort`, `/en/coming-soon` (gate mode for the last two): footer shows name, address, KvK, phone, btw; `/contact` shows complaints paragraph; at 375 px no horizontal scroll | — (assertions on rendered text) |
| `e2e/forms.spec.ts` (FE-02, extended) | the reminder sentence sits under both email fields with a link to `/privacy` (`/en/privacy`); the Monthly card shows the total | — |

Commands (all from `/home/user/vidalo`; `corepack pnpm` where `pnpm` is not on the PATH):

```
corepack pnpm -r typecheck
corepack pnpm -r test
corepack pnpm --filter @vidalo/core exec vitest run test/copy-claims.test.ts test/no-preticked-boxes.test.ts test/order-mail.test.ts test/billing.test.ts test/checkout-consent.test.ts test/price-surfaces.test.ts test/legal.test.ts
corepack pnpm mail:lab                     # out/mail-lab/index.html; FAIL line on any problem
corepack pnpm e2e:mock
corepack pnpm e2e -- e2e/company-details.spec.ts e2e/forms.spec.ts
corepack pnpm e2e:gate -- e2e/company-details.spec.ts   # the coming-soon half
```

`pnpm verify:pg` is not needed: no migration, no Db method. `legal.test.ts` must pass with
`legal.lock.json` unchanged; a diff in that file means a ticket touched `copy.legal` and the PR
is refused.

## 11. Work split

| Ticket | Lane | AC | Depends on | Estimate | Complex |
|---|---|---|---|---|---|
| BE-01 Copy, company source, claims test | backend (core) | AC-1, 2 (copy), 6, 7 (copy), 8, 10, 11 (copy), 17 | — | 0.5 d | no |
| FE-01 Company details on every page and on /contact | frontend | AC-1, 2, 3 | BE-01 (keys) | 0.25 d | no |
| FE-02 Price card, form sentence, no pre-ticked box | frontend | AC-7, 9, 11 | BE-01 (keys) | 0.5 d | no |
| BE-02 Order confirmation mail from the webhook | backend | AC-14, 15; F-001, F-009, F-017, F-018 | BE-01 (`mails.order`) | 1 d | **yes** (webhook idempotency, three plans, mock path) |
| BE-03 Monthly price everywhere, checkout pinned | backend | AC-11 (F-002), 12 | — | 0.5 d | no |
| **Total** | | | | **2.75 d** | |

BE-01 is a small first commit (keys only, no rendering), so the "depends on" is a key list, not
a wait; this is the C-00 pattern from feature 002. Merge order: BE-01, then the rest in any
order; the file sets are disjoint (§6).

## 12. Julian's items (no ticket)

| # | Item | Why it is his | Suggested answer |
|---|---|---|---|
| J-1 | The complaints article (§8), NL and EN, new legal version and `legal:lock` | legal text; counsel (De Boer) | "Ja, na De Boer zo publiceren, 5 werkdagen" |
| J-2 | Terms "Prijzen en betalen" (`index.ts:865`): say Vidalo Monthly starts with Vidalo Scan, or refer to vidalo.ai/prijzen instead of repeating prices | legal text | "Verwijs naar /prijzen en noem dat Monthly met Scan begint" |
| J-3 | The day-7/21 mails: privacy calls them a reminder about the outcome (`index.ts:1021`) while they carry an offer, and they go without the news box (`cron.ts:151-165`); counsel to say whether Tw 11.7 asks consent for them | legal text and a legal judgement | "Counsel vragen; tot dan alleen sturen als het nieuwsvakje is aangevinkt" |
| J-4 | Confirm the footer identity equals the KvK extract (A101 B.V., Factorij 80, 3071 AV Rotterdam, 42057858, NL869514192B01) and that "Vidalo" is a registered trade name of A101 B.V. | company facts only he holds | "Klopt, Vidalo staat als handelsnaam ingeschreven" (only if true; else register it first) |
| J-5 | Counsel on "Geen verborgen kosten" next to a one-off fee (Q5 assumed: keep) | counsel | "Houden, nu de kaart beide bedragen toont" |
| J-6 | One real test order per plan (row C1): screenshot of Stripe's summary and pay step (record the button text in payment and subscription mode), whether a btw number was required at checkout, the received order mail, and Stripe's receipt/invoice showing KvK and btw | needs a real payment and the Stripe dashboard | "Doe ik op de sandbox na de merge, Scan en Monthly" |
| J-7 | Clean-browser check on vidalo.ai after deploy: `/`, `/en`, `/binnenkort`, `/en/coming-soon`, `/contact` show every company field; the phone answers on a working day | the sandbox cannot reach the site | "Doe ik na de deploy" |
| J-8 | Deploy (manual) and the launch gate | deploys are his | "Deploy na groen + J-1" |
| J-9 | Whether checkout should also ask the KvK number as B2B evidence (F-008) | product and legal judgement | "Nee, de btw-nummer-plicht van Stripe is genoeg" (if J-6 shows it is required) |

## 13. What this makes harder later

- A second mail per purchase. Every future checkout path (a new plan, a price id change) has
  to go through `queueOrderConfirmation`, or the buyer gets nothing; the billing test is the
  only guard. A new plan needs a `PRICES` entry, or every mail for it loses its per-line split.
- `COMPANY` is a code constant, not copy: changing the address is now a code change in one
  place plus a legal-text change in another (`copy.legal.contact` stays hand-written and only
  checked). That split is deliberate (legal text is Julian's) and is the cost of not touching it.
- The claims test bans words. A future honest use of "populair" (e.g. a real customer count)
  needs the test changed on purpose with a sourced figure; that is the intent.
- The order mail promises things the terms say (start after proof, 30-day dissolution, cancel
  any month). Changing those terms now also means changing `mails.order` in the same PR; the
  compliance checklist item COMP-31 is the reminder.
