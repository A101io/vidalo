# Standing compliance checklist

A101 B.V., Netherlands launch market, EU rules, Dutch consumer law. The per-feature
checklist is written in phase 1 off the brief and the architecture. The legal baseline
for every venture is `_OS/playbook/LEGAL-NL.md` and the kit's legal pages; this list is
what a feature review checks on top of them.

## ACM checklist online verkoop — a must
- [ ] Every feature is checked against the ACM's
  [Checklist online verkoop](https://www.acm.nl/nl/verkoop-aan-consumenten/online-verkoop/checklist-online-verkoop),
  item by item, reading the linked ACM sub-page: company details incl. phone and btw-nummer
  one click from every page, no geoblocking, platform duties, fair online influence, all
  pre-contract information, and a pay button that says paying
- [ ] Consumers are pointed to [ACM ConsuWijzer](https://consument.acm.nl/) in the complaints
  article of the terms and on the contact page

## Personal data (GDPR / UAVG)
- [ ] Every field of personal data has a named lawful basis and a reason to exist
- [ ] Data minimisation: a field nobody can name a use for is deleted, not collected "for later"
- [ ] Retention stated per data class, and something actually enforces it — **and it covers every
  copy**: provider logs, backups, and the mailboxes that receive notifications, not only the database
- [ ] A "converted" or "customer" flag that stops a retention clock gets its own retention rule in
  the same change, never "the next feature will define it"
- [ ] A person can see, export, and delete their data; deletion propagates to processors
- [ ] Processor agreements exist for every processor before the first byte is sent. **Every**
  processor gets its own named step in the go-live list, with a dated copy filed — one remembered
  and three forgotten is the normal failure
- [ ] Analytics: consent before any non-essential cookie or identifier. The reject option is as
  easy as accept — this is enforced in NL and fines are live
- [ ] No personal data in analytics events, URLs, query strings, or logs
- [ ] A breach path exists: who is told, by whom, inside 72 hours
- [ ] **A mailbox read by an AI routine makes the AI provider a recipient** of every address that lands
  there (contact, support, hello@). Name it in the privacy statement with processor terms in place, or
  keep that address out of the routine by filter. Found on a101.io, 2026-11-06
- [ ] **An integration where the customer links their own account elsewhere (OAuth) makes that
  vendor a recipient** — usually an independent controller, not a processor, and often outside the EU.
  Name it in the privacy statement's recipients *and* international-transfer sections, and delete the
  stored tokens when the contract ends, not only on "Disconnect" or account deletion. Found on Sonable
  Play on Sonos, 2026-11-09

## Money, VAT and consumer law
- [ ] Prices shown to consumers are **VAT-inclusive**. The VAT stance is a pricing claim, not a
  display choice
- [ ] Total cost visible before commitment; no fee revealed at the last step
- [ ] A percentage is not a price. A commission or fee states **what it is charged on** and whether
  VAT is added to it, in the same visual unit as the rate
- [ ] A worked example says whether its amounts include VAT, and computes VAT within a gross
  (`gross − gross/1.21`), never on top
- [ ] A worked example that nets VAT out of a business's costs has **assumed that business can
  reclaim it**, and must say so. A customer on the kleineondernemersregeling cannot deduct input
  tax, so the "what you keep" figure is wrong for them
- [ ] Invoices carry the legal entity, address, KVK number and VAT number
- [ ] A trade name in use is registered in the Handelsregister before it appears in an identity block
- [ ] Cancellation and refund terms stated where the person commits, not only in the terms page
- [ ] The 14-day right of withdrawal is addressed correctly, including the dated-service and
  digital-content exceptions where they apply
- [ ] A business customer's invoice belongs to the business, never to the individual who clicked

## Marketplace and platform (only if the venture has a supply side)
- [ ] What the venture is responsible for versus what the supplier is responsible for is stated plainly
- [ ] Commission and plan terms are disclosed to the supplier before they agree
- [ ] Payouts and identity verification follow the payment provider's requirements; no workaround

## Accessibility
- [ ] The EAA microenterprise exemption still applies (fewer than 10 staff, at most €2M). While it
  does, accessibility is policy enforced by QA through the brief's AC, not a compliance veto —
  see [a11y.md](a11y.md). The day it stops applying, AA becomes a legal hard stop
- [ ] Record which legal instrument makes each accessibility item binding, so severity follows the
  law and not habit

## Copy
- [ ] No claim the product cannot deliver; no invented review, endorsement or statistic
- [ ] **"Built" is not "runs".** A capability claim needs an observed run with a date (a sent message,
  a published post, a filed return), not only the tooling. A hub switched off or in dry run supports no
  verb. Found on a101.io, 2026-11-06
- [ ] A site aimed at businesses is judged under BW 6:194–196 (misleading advertising), not only
  6:193a ff. (consumers); both forbid an untrue statement of fact
- [ ] Dutch legal wording checked against Dutch sources, not translated from English ones
- [ ] **The EU ODR platform closed on 20 July 2025** (Regulation (EU) 2024/3228 repealed the ODR
  Regulation). Never send a consumer there. The live routes are: complain to us first, then ACM
  ConsuWijzer, a recognised geschillencommissie if we join one, and the court
- [ ] **A legal text is site content**, so it is bound by every copy rule and every content test
  the marketing pages are: banned words, no figure outside its single source, no claim that reads
  as live. Terms state a price **by reference to the page that holds it**, never as a second copy —
  two copies of a price is two pricing claims
- [ ] A retention period stated in a privacy notice names, in the same change, **who enforces it
  and how**. A period nobody enforces is a promise that fails an audit worse than silence would
- [ ] A decision recorded in the brief **after** the tickets were written is re-checked against the
  build in phase 4. It is the one kind of requirement that reaches nobody
- [ ] Every finding raised in a verification report is carried into the findings ledger, and every
  go-live gate into the go-live list, in the same run. Findings left in the report alone are not
  fixed

## Out of lane
Tone, layout and feature value. Compliance blocks on law, and files P1s on the rest.

## Learned (Vidalo, 11 Nov 2026)
- A 'checked' or 'all correct' claim is computed from the same count on every surface: report page, mail and dashboard.
- A label a heuristic puts in front of the customer describes what the heuristic actually detects ("een ander bedrijf", not "met dezelfde naam").
- A dry-run or arming switch for a retention purge never holds back a person's own deletion request; test the owner path and the retention path separately with the switch off (002, F-010).
- A second route to the same contractual act (a cancel triggered by "delete everything") owes the same confirmation as the main route, worded true for that route (002, F-013).
- A cookie constant added in a scaffold ticket brings its cookie-table row, version date and `legal:lock` in that same ticket; `legal.test.ts` reads every exported `…COOKIE…` constant (002, F-011).
- A one-off plan needs its own retention end and token end: "zolang je klant bent" never ends for a customer who never churns (002, F-012, F-015).
