# Request — 003 ACM rules on the site

Opened by the think run from the Control Room backlog, 2026-11-12.

## R4

> **Title:** ACM · Company details easy to find: KvK name, address, email, phone, KvK no., btw/VAT no., complaints procedure, dispute committee, chat options — on every page or one click (footer → contact)
>
> Now: Code audit 22 Oct 2026. Footer: name, address, KvK, email, chat on every page. Gaps: btw-id deliberately left off (SETUP_STATUS.md:7) — add to footer.legal or one click away; no phone (own.ts:46 null) or 'email + chat only' statement; no complaints section in terms.
>
> How / verified when: ACM bedrijfsgegevens-vermelden: always name as registered at KvK, KvK address, email AND phone (plus hours if not always reachable), complaints procedure if any. Selling online or providing services: also KvK number, btw-nummer, dispute committee, chat/online contact options. Must be findable before purchase: every page (header/footer) or a link to the contact page. Verified = clean browser: from the home page AND the coming-soon/holding page, every field is visible or one click away; phone answers. Consumer-facing sites (B2C) also point consumers to ACM ConsuWijzer, https://consument.acm.nl/, in the complaints article of the terms and on the contact page ("Kom je er

## R7

> **Title:** ACM · Fair online influence: ranking explained, only true scarcity/popularity claims, genuine reviews (paid ones labelled), personalised offers flagged, 'gratis' only if truly free, cookies by consent, nothing pre-ticked, no dark patterns
>
> Now: Code audit 22 Oct 2026. Ok: no ranking/scarcity, necessary cookies only, nothing pre-ticked. Gaps: 'Meest gekozen' badge false pre-launch; 'Van rood naar groen' cards labelled only 'voorbeeld' → 'Fictief voorbeeld'; report-email capture also sends day-7/21 reminders, disclosed only in privacy — say it under the field; '10.000 bedrijven' needs '(VS)' inline.
>
> How / verified when: ACM online-beinvloeden pages + Leidraad bescherming online consument. Verified = grep the UI copy for 'gratis/free', 'nog X', 'populair', countdowns, review widgets; check every checkbox default is unchecked and every default favours the customer; sort order of results has a short explanation if not neutral; reviews only from real customers with how they are checked; 'free' asks nothing in return (no card, no paid-for data). Cookie part overlaps L2/F4. B2B-only site: R4 and the cookie/pre-tick part of R7 still apply (art. 3:15d BW, Telecommunicatiewet 11.7a); set the rest n/a only when the terms clearly exclude consumers and checkout refuses them. Source (business):

## R8

> **Title:** ACM · All mandatory info before order or account: features, total price incl. VAT and all costs, privacy, cancellation/termination, payment methods, delivery (where/when/who), legal guarantee, 14-day withdrawal + model form (or the exception stated), complaints, customer-service rate
>
> Now: Code audit 22 Oct 2026. Terms never exclude consumers (only Stripe custom text) — add a B2B-only clause, else consumer rules apply. Terms still legal.draft: true. 'Geen verborgen kosten' while monitor plan needs €149 setup — show '€149 + €49/mnd' on the card.
>
> How / verified when: ACM kenmerken/prijzen/annuleren/bedenktijd/garantie/tarief-klantenservice. Shown to a consumer before they order or create an account. Prices to consumers incl. btw and every unavoidable fee (service fees in the headline price). Services on a specific date/time in leisure (e.g. a seat booking) may fall under the withdrawal exception of art. 6:230p BW — then say so explicitly. Customer-service phone may not cost more than the basic rate. Pairs with C4 (counsel review). Consumer-facing sites (B2C) also point consumers to ACM ConsuWijzer, https://consument.acm.nl/, in the complaints article of the terms and on the contact page ("Kom je er met ons niet uit? ACM ConsuWi

## R9

> **Title:** ACM · Clear order flow: steps visible, overview (features, price, cancellation terms, duration) before payment, pay button says payment ('Bestel en betaal' / 'Betalen'), errors correctable, written confirmation on a durable medium right after payment
>
> Now: Code audit 22 Oct 2026. Stripe Checkout shows lines, btw, terms, pay button. Gap: confirmation email (reporter/templates.ts:211-245) has no order summary, renewal terms, terms link or company details.
>
> How / verified when: ACM checklist 'Het bestelproces'. A button reading only 'Bestellen', 'Reserveren' or 'Doorgaan' at the paying step is not enough. Confirmation email carries the order, price, terms (as attachment or durable link), withdrawal info and company details. Verified = one real test order (C1) screenshotted at the summary and pay step, plus the received email. B2B-only site: R4 and the cookie/pre-tick part of R7 still apply (art. 3:15d BW, Telecommunicatiewet 11.7a); set the rest n/a only when the terms clearly exclude consumers and checkout refuses them. Source (business): https://www.acm.nl/nl/verkoop-aan-consumenten/online-verkoop/checklist-online-verkoop — read the lin

The backlog listing cuts any line at 700 characters; the full notes are in `os/_OS/control-room/state/_items.json`.

Control Room rows: R4, R7, R8, R9
