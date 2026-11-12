# Compliance checklist — 002 Mijn omgeving (phase 1, pre-build)

*compliance · 2026-11-11 · against `01-brief.md` (approved by Julian 11 Nov 2026, Q1–Q14 as
assumed), `02-architecture.md`, ADR-0001…0007, tickets C-00, A-01…A-07, B-01…B-04, and
`findings.md` up to F-009. I am not a lawyer. Items marked **lawyer** go into the ship report
as needing one. Sources are marked as the legal desk marks them: `[page]` = read on the
source's own page today, `[snippet]` = from a search result or summary only, `[known]` =
settled law not re-read today. Nothing marked `[snippet]` changes a legal text.*

The phase-4 review checks every item below against the code and the copy as shipped. The
severity column is the severity **if the item fails in phase 4**. A P0 that was foreseeable
and is not on this list is capped at P1 unless it is a legal hard stop.

## Verdict at phase 1

- **Hard stops against the design: none.** One item (COMP-30) **becomes** a hard stop if it
  ships a particular way. The architecture leaves open whether the `VIDALO_PURGE` dry-run
  switch also holds back an **owner's own** deletion. If it does, the app tells the person
  their data is deleted (or "wordt verwijderd") while nothing is deleted. That is a false
  statement about an erasure request under AVG art. 17 and art. 12(3), and a breach of the
  published privacy text. The fix is cheap and is listed under "Change before build" (B1).
- **B2B cancellation: nothing in this feature conflicts with the published terms.** The terms
  already promise more than Dutch law requires of a B2B seller. The delete path that cancels
  a Monthly at period end has to keep two of those promises: an immediate confirmation mail
  with the end date, and no refund stated where the person commits. Today's mail wording
  would be false on that path. See §1, B3 and B4.
- **Legal texts: privacy (NL and EN) and the cookie table change. The terms do not.** That
  means a new `updated` date, `legal:lock` and `legal.test.ts` green. The `vidalo_business`
  cookie row must land in **C-00**, not A-07, or the legal test is red from the first commit
  of both lanes (B2, F-011).
- **Retention for Vidalo Scan customers (F-002):** proposed default is **24 months after the
  later of the last sign-in and the last payment**, a reminder 14 days before, then deletion
  as AC-5(d), facts page included. Julian decides. It must be decided before A-05 writes
  migration 0019, because the 0019 CHECK and the `due` guard as specified exclude status
  `trial`, which is where every Scan business sits (B5, F-012).
- **Accessibility:** the European Accessibility Act does not apply to Vidalo, on two
  independent grounds (§3). AC-8 is enforced by QA, not by compliance.

## Change before build (cheap now, a finding later)

| # | Ticket | Change | Why |
|---|---|---|---|
| B1 | A-05, A-06, ADR-0005 | `dryRun` is true **only** for a deletion with `delete_reason = 'retention'`. An owner's request is never dry-run: the inline "now" purge, its fallback `purge` job (guard `no_subscription`), and the scheduled period-end purge (`delete_reason = 'owner'`, guard `due`). One unit test per path with `VIDALO_PURGE` unset | AVG art. 17(1) and 12(3): the request must be carried out, within a month. A switch meant to protect against a retention bug must not silently cancel a person's own request while the page and the mail say it is done (COMP-30, F-010) |
| B2 | C-00 (instead of A-07) | C-00 adds the `vidalo_business` row to the cookie table (NL and EN, wording in §4.2), sets a new `copy.legal.updated` date in both languages and runs `pnpm --filter @vidalo/core legal:lock` | `legal.test.ts` collects every `export const …COOKIE… = "…"`. C-00 itself exports `ACTIVE_BUSINESS_COOKIE = "vidalo_business"`, so C-00's own "`pnpm -r test` green" is unreachable, and so is every lane ticket's after it, until A-07, which is the last ticket of lane A. Lane B merges first and would merge red (COMP-40, F-011) |
| B3 | A-05 | When `deleteMyData` cancels a running Monthly (`needsCancel`), it sends a confirmation mail **straight away** with the end date. The wording is for this path: the subscription stops on {date}; everything is deleted that day; the facts page goes offline; there is **no** 90-day free check; download reports and invoices before that date; "Toch bewaren" and "Toch doorgaan" until then. Do not reuse `cancel_confirmed` unchanged | Terms "Looptijd, opzeggen en pauzeren", clause 2: "Je krijgt direct een bevestiging per e-mail met de einddatum." `cancelSubscription` (core) sends no mail; only `cancelAction` does (`apps/web/app/app/abonnement/actions.ts:31`). Today's `cancel_confirmed` says "90 dagen later doen we nog één gratis controle" and "Je facturen blijven te downloaden in je account", both false on this path (BW 6:194 for a business recipient; AVG art. 13 transparency) (COMP-05, F-013) |
| B4 | A-05 | `/app/account/verwijderen` states, before the button: for Monthly, the end date and that the running month is not refunded. For Vidalo Scan, that the amount is not refunded once Vidalo has started, and that if ownership could not be proven within 30 days the owner can ask for a refund at support@ **before** deleting. Also: invoices stay at Stripe for 7 years but cannot be downloaded from the account after deletion, so download them first | Standing list: "cancellation and refund terms stated where the person commits". Terms clauses 3 and 4 of "Looptijd". After the purge the login is gone, so the Stripe portal (`/api/billing/portal`) can no longer be reached (COMP-06, COMP-07, F-014) |
| B5 | A-05 (0019), A-06 | Julian decides Scan retention (§2.4) **before** 0019 is written. If he decides as proposed, 0019's CHECK `business_delete_only_when_ending` and the `due` guard / `listDueDeletions` allow `plan = 'setup'` with status `trial` and `delete_reason = 'retention'`, and the cron sets `delete_at` from last sign-in / last payment | Migrations are never edited after they are applied. F-002's "1 h, one trigger rule" overlooks that the CHECK and the guard both refuse status `trial` (COMP-24, F-012) |
| B6 | A-06 (with A-04's `disconnectGoogle`) | A Scan customer's Google token is revoked and deleted when the Scan's work is done: 60 days after the first full check, with no open fix and no held Business Profile change, or earlier on disconnect. Ownership proof stays | Q14 covers churn only. A Scan has no churn, so a `business.manage` refresh token would be kept with no named use (AVG art. 5(1)(c) and (e); standing list, OAuth row: delete tokens "when the contract ends") (COMP-21, F-015) |
| B7 | A-07, delivery-lead | If the cycle is split (002a / 002b), the privacy text that ships states only what that release does. Retention, reminder and churn → Google (A-06) are in 002b; their sentences go with 002b | A privacy statement must describe the product as shipped (legal desk rule 5; AVG art. 13) (COMP-44) |
| B8 | A-07 | `docs/records-of-processing.md` is added to A-07's owned files (no ticket owns it today) | Art. 30 record must match the new sign-in list, throttle, Scan retention and churn rule (COMP-43) |

## 1. Cancelling a B2B subscription: Dutch law vs what `copy.legal` promises

### The law, settled

| Rule | Text checked | Applies to Vidalo's customers? |
|---|---|---|
| **Black list, BW 6:236** (version in force 16-07-2026, consulted 11-11-2026) `[page]` | Opening words: "Bij een overeenkomst tussen een gebruiker en een wederpartij, natuurlijk persoon, die niet handelt in de uitoefening van een beroep of bedrijf…". The subscription items are **sub j** (a tacitly continued contract must be cancellable "te allen tijde … met een opzegtermijn van ten hoogste een maand") and **sub o** (a clause that "de bevoegdheid van de wederpartij om de overeenkomst, die mondeling, schriftelijk of langs elektronische weg tot stand is gekomen, op een overeenkomstige wijze op te zeggen, uitsluit of beperkt"). The brief's "sub l/m/n" are not the cancellation items in the current text: 6:236 l is about BW 3:37 (how statements reach the user), m is choice of domicile, n is the forum clause | **No, not directly.** Consumers only |
| **Grey list, BW 6:237** `[page]` | **k** (term longer than one year without monthly cancellation after the first year), **l** (a notice period for the customer longer than the user's), **m** ("een strengere vorm dan het vereiste van een onderhandse akte" for the customer's statements), **o** (a notice period longer than one month) | No, not directly. Consumers only |
| **Who may invoke the open norm, BW 6:235(1)** `[page]` | Not available to a legal person that publishes annual accounts, nor to a party with "vijftig of meer personen" working for it. 6:247(1): the section applies between two businesses both established in the Netherlands | **Yes.** A typical Vidalo customer (a bakery, a sole trader) can invoke **6:233(a)**, the open norm against unreasonably onerous clauses |
| **Reflexwerking** | HR 2023 (ECLI:NL:HR:2023:1197): a court may let a black- or grey-list clause count towards unreasonableness under 6:233(a) for a party acting in the course of business, and not only for small, consumer-like businesses. Earlier case law (HR 2016, the LCD lease case): the lists themselves do not protect the small business. In practice it is applied sparingly `[snippet]`; the judgment page could not be read from here | **Possibly.** A court reading Vidalo's cancellation terms for a small business could use 6:236 j/o as a yardstick |
| **Withdrawal button, BW 6:230oa** (from 19 June 2026, Directive (EU) 2023/2673) `[page]` | "De handelaar zorgt ervoor dat de **consument** het recht van ontbinding van een via een online-interface gesloten overeenkomst op afstand kan uitoefenen…" | **No.** Consumers, and only where a withdrawal right exists. Terms 2.2 exclude the withdrawal right for businesses |
| **ACM, "Online afgesloten abonnement moet je online kunnen opzeggen"** `[snippet]` | ACM enforces 6:236 j and o for consumers: cancelling must be as easy as signing up, with no routing to the phone, and a written confirmation with the end date | No (ACM enforces consumer law). Vidalo's `docs/CANCEL-PAUSE.md` meets it anyway |
| **EU Data Act, ch. VI "switching"** (Reg. (EU) 2023/2854, applies from 12 Sept 2025, art. 50) `[page]` | Art. 2(8) "data processing service"; recital 81 counts SaaS among the delivery models. Art. 25(2) contract clauses: (d) notice to start switching "shall not exceed two months"; (a) a transition of at most 30 days; (g) data retrieval "of at least 30 calendar days"; (h) "full erasure"; (c)(ii) the contract ends where the customer "does not wish to switch but to erase". Art. 31 exempts only custom-built services and test versions; there is no microenterprise exemption in ch. VI (art. 7's applies to ch. II only) | **Uncertain, lawyer.** Whether a facts check, facts page and correction service is a "data processing service" (a "shared pool of configurable, scalable and elastic computing resources") is not settled. If it is, the **terms** lack the art. 25 clauses (written exit terms, exhaustive list of exportable data). In substance Vidalo already does more: cancel any time with no notice, export any time, 90 days of retrieval after the end, erasure. Not caused or worsened by this feature; P1 for the legal desk |
| **DMCC Act 2024** | UK subscription-contract regime, UK consumers | Not Dutch law. Does not apply |

**What is required of Vidalo:** for its B2B contracts, no specific statutory cancellation
mechanism. The binding standard is the terms themselves, tested for reasonableness (BW
6:233(a), 6:248) with possible reflexwerking of 6:236 j/o for small customers. If counsel
holds Vidalo to be a data processing service, there are also the Data Act art. 25 exit terms.

**What Vidalo promises on top**, in `copy.legal.terms` "Looptijd, opzeggen en pauzeren",
version of 11 November 2026, as checked today in `packages/core/src/copy/index.ts` (NL)
and `en.ts` (EN):

1. "Je zegt Vidalo Monthly op wanneer je wilt, online onder ‘Abonnement’ in je Account. Er is
   geen opzegtermijn: de maand die je al betaalde loopt af, daarna betaal je niets meer. Je
   krijgt direct een bevestiging per e-mail met de einddatum. Tot die datum kun je de
   opzegging intrekken." (EN: "You can cancel Vidalo Monthly whenever you want, online under
   ‘Subscription’ in your Account. There is no notice period: … You immediately receive a
   confirmation by email with the end date. Until that date you can withdraw the
   cancellation.")
2. "Bij opzeggen krijg je het bedrag voor de lopende maand niet terug: de Dienst loopt tot de
   einddatum door. Het bedrag voor Vidalo Scan krijg je niet terug zodra we ermee begonnen
   zijn."
3. "Kunnen we binnen dertig dagen na je betaling niet aan Vidalo Scan beginnen, omdat het
   bewijs van beheer uit artikel 5 niet lukt, dan mag je de Overeenkomst ontbinden. We
   betalen je dan terug wat je voor het Plan betaalde."
4. The pause clause (1, 2 or 3 months, nothing checked or charged, facts page stays online,
   reminder a week before, resume early or cancel during the pause, no pause while a payment
   is open).
5. "Eindigt je abonnement, dan stoppen we met controleren en herstellen, en verwijst je
   Feitenpagina door naar je eigen website. Wat bij andere partijen al hersteld is, blijft
   daar staan. Wat we daarna met je gegevens doen, staat in ons privacybeleid."
6. "Opzeggen kan ook per e-mail naar support@vidalo.io. Je krijgt dan dezelfde bevestiging."
7. Elsewhere: "Je geeft ons toestemming … je Google-bedrijfsprofiel … bij te werken … Je
   trekt die toestemming in door de koppeling te verbreken of ons te mailen." and "Je mag je
   rapporten gebruiken, bewaren, printen en delen … ook na het einde van de Overeenkomst."

### This feature against those promises

| Feature behaviour | Clause | Conflict? |
|---|---|---|
| "Verwijder alles" during a running Monthly cancels at period end and deletes on that date (Q3) | 1, 2 | **No conflict in substance:** it is an extra cancel route, and the clause names where you *can* cancel, not the only place. **Two duties follow:** the immediate confirmation mail with the end date (B3), and "no refund of the running month" stated on the delete page (B4) |
| Undoing the cancel also calls the deletion off (trigger rule 3); "Toch bewaren" keeps the cancel (F-008) | 1 ("Tot die datum kun je de opzegging intrekken") | No conflict. The delete page and `/app/abonnement` say both in words (COMP-04) |
| Pause; a deletion asked during a pause | 4 | No conflict. `deletionPlan` treats an owner pause as `at_period_end`; Stripe's period keeps running under `pause_collection`, so the date is at most one period away (COMP-03) |
| End state: Google removed at once (Q14), reports readable until deletion, date shown | 5, 7 | No conflict. It makes clause 7's "door de koppeling te verbreken" true for the first time (the control did not exist, gap A5) |
| Owner-scheduled deletion on the end date: the facts page goes offline rather than redirecting | 5 | Minor: the owner's own request overrides the general sentence. The delete page and mail say "je feitenpagina gaat offline" (COMP-07). P2 |
| No refund | 2, 3 | No conflict, provided B4 is on the delete page. Deleting a Scan before Vidalo began would silently lose the clause-3 refund route, so the page names it (B4) |
| A second business on the same login becomes cancellable online (AC-2) | 1 | Fixes an existing gap: today a second business's Monthly cannot be cancelled "online onder ‘Abonnement’" at all (gap O3/B3) |
| Fresh sign-in (15 min) for delete and address change | 1 | No conflict, **as long as cancel, undo, pause and resume do not require it** (COMP-02) |

**Terms change needed for this feature: none.** The legal desk owns the Data Act question as
a separate P1. If Julian chooses the Scan retention of §2.4, the terms need one sentence on
how long a Scan facts page stays online (COMP-25); that is the only conditional change.

## 2. Personal data (AVG)

### 2.1 Fields, lawful basis, retention

| Data | Where | Basis | Retention (proposed or confirmed) |
|---|---|---|---|
| Login e-mail, Supabase user id, language, mail preferences | `auth.users`, `business` | 6(1)(b) contract | While the account exists; deleted by the purge when no business remains on the login |
| Sign-in list: `session_id`, `user_id`, signed-in, last-seen, ended-at and reason, browser family, OS family. No IP, no user-agent string | `auth_session` (0018) | 6(1)(b) for the session itself; 6(1)(f) account security for the visible list (recital 49) | Open sessions end after 30 days idle or 90 days; at most the 10 newest rows per login; deleted with the login |
| Throttle keys: HMAC-SHA256 of `addr:<email>` and `ip:<ip>` with a server secret, plus time | `auth_throttle` (0018) | 6(1)(f) preventing abuse of sign-in mail (recital 49) | ≤ 24 h (cron prune). **Still personal data:** Vidalo holds the key, so it can link a hash to a known address (recital 26). Art. 11(1): no duty to re-identify for access or export, so it stays out of the export |
| Deletion fields: `churned_at`, `delete_at`, `delete_reason`, `deletion_reminded_at` | `business` (0019) | 6(1)(c)/(f): carrying out art. 5(1)(e) and art. 17 | Deleted with the business |
| `vidalo_business` cookie (a business uuid) | browser | Tw 11.7a(3)(b) strictly necessary (a choice the user made, WP29 Opinion 04/2012 "user-interface customisation") | 90 days (in the cookie table) |
| Google OAuth tokens (`channel.meta.refreshToken`/`accessToken`) | `channel` | 6(1)(b) | Until disconnect, **churn (at once, Q14)**, Scan end (B6) or deletion; revoked at Google, not only deleted |
| `account.deleted`, `google.disconnected`, `retention.*` events and logs | `event`, worker logs | 6(1)(f) / 5(2) accountability | No address, token or business id in `account.deleted`; `retention.*` carries business ids only (A-05, A-06) |
| `owner.visit` metric event (brief success metric) | `event` | 6(1)(f) | With the business; at most one per business per day; no personal data in the payload |

### 2.2 Erasure, art. 17

| Question | Answer |
|---|---|
| Is the delay to the period end lawful for a Monthly owner who asks to delete? | **Defensible, not certain (lawyer).** Art. 17(1) says "without undue delay", and art. 12(3) gives one month to act. A Monthly period is at most one month away, even during a pause or a failed payment, because Stripe's period keeps running. The data is still needed for a service paid up to that date (art. 17(1)(a) is not yet met), the person chose this route knowingly, and they can call it off. **Condition:** the privacy text says that an earlier deletion can be asked of support@ (§4.1 P4), and support honours a clear request within a month. Not a hard stop |
| What is erased at once (Scan, never paid, churned, or on the Monthly end date)? | The business row and every child row (facts and versions, scan runs, samples, claims, findings, fixes and evidence, channels, events, membership), unrun jobs, the facts page's custom hostname and its Worker route, the Google token (revoked at Google first), the login and its `auth_session` rows when no business remains, the `vidalo_business` and auth cookies of this browser |
| What is kept? | Invoices and the data on them, **at Stripe**, 7 years: BW 2:10(3) and AWR art. 52(4) `[known]`, basis 6(1)(c). The Stripe customer object is **not** deleted by the purge. Corrections already made at third parties stay there (privacy text). `question_use` ledger rows hold no business data (001 C-14) |
| Art. 17(2): the facts page was public | Reasonable step: the facts host answers not-found (410 if cheap), and the removed URL is sent to IndexNow so crawlers drop it. P2 |
| Copies outside the database | Supabase backups (roll-off period depends on the plan; state it), Resend's message logs (recipient address; retention to look up and state), Cloudflare logs (no address if logs follow the rules), the support@ mailbox (2 years, existing rule). Standing list: "retention … covers every copy" |

### 2.3 Access and portability, art. 15 and 20: the export

The export from "Je gegevens" contains every category the privacy statement names for this
business **and the login**: facts with every version, the owner's correction of the
description (`profileOwner`) and `profileAuto`, every scan run with samples, claims and
`profile`, findings, fixes with evidence, channels (allow-listed `meta` only), events (with
other people's addresses removed), mail preferences, language, ownership proof (when, how,
masked phone), plan and subscription state (`cancelAt`, pause, `deleteAt`), **and the
sign-in list** (it is personal data about the login, art. 15). No token, secret or other
person's e-mail address. Invoices are not in the file. The page says they are in the Stripe
portal. `auth_throttle` is left out (art. 11). JSON is a "structured, commonly used and
machine-readable format" (art. 20(1)).

### 2.4 Retention for Vidalo Scan customers (F-002): proposal

A Scan is a one-off assignment that includes "een feitenpagina op je eigen domein" (pricing
copy) with no end date. Its data therefore has a use as long as that page is meant to stay
online. That rules out a short period counted from the purchase. "Zolang je klant bent" has
no end for a Scan, so it is not a retention criterion under art. 5(1)(e) and art. 13(2)(a).

**Proposed default:** a Scan business is deleted **24 months after the later of its last
sign-in and its last payment**. A reminder mail goes 14 days before (the A-06 template:
sign in to keep it, download reports and invoices first). Deletion is as in AC-5(d), facts
page included. Signing in resets the clock. An upgrade to Monthly takes the business out of
this rule.

**Alternatives for Julian:**
- 12 months: shorter, but a facts page that disappears after a year of not signing in reads
  as less than what was sold.
- No automatic deletion this cycle (F-002's assumed default): the privacy text then says
  "Vidalo Scan: zolang je account bestaat; je verwijdert alles zelf onder ‘Account’". The
  finding stays open as a go-live gate.

Either way the privacy text says exactly what is enforced (COMP-24), and the terms say how
long a Scan facts page stays online (COMP-25).

### 2.5 Mails introduced by the feature

| Mail | Kind | Consent? |
|---|---|---|
| Deletion confirmation (`account_deleted`) | Service mail; informs the person of the action taken on their request (art. 12(3), art. 19) | No. Tw 11.7 covers unsolicited **commercial** communication; this is not |
| Retention reminder 14 days before (`deletion_reminder`) | Service mail (art. 13/5(1)(a) transparency; 6(1)(f)) | **No, provided it stays informational:** the date, what goes, how to download, how to keep the data (sign in, or resume the subscription). No offer, discount or promotion. A promotional line makes it a commercial message under Tw 11.7, which then needs the soft-opt-in conditions and an unsubscribe link |
| Delete-driven cancel confirmation (B3) | Service mail; contractual promise (terms clause 1) | No |

Each carries the company identity footer of the other owner mails (LEGAL-NL §1) and goes in
the owner's language.

### 2.6 Processors touched

| Vendor | What changes | New vendor? |
|---|---|---|
| Supabase | `auth_session`, `auth_throttle`, deletion columns; Admin API user delete | No |
| Cloudflare | Custom hostname and route deleted (`api.cloudflare.com`, already in HOSTS) | No |
| Google | Token revoke at `oauth2.googleapis.com/revoke` (`googleapis.com`, already in HOSTS) | No |
| Resend | Two or three new service mails | No |
| Stripe | Cancel at period end from the delete path; customer and invoices kept | No |
| Twilio | Unchanged. Verify logs of the phone route stay under Twilio's own retention; name it if it can be looked up | No |

No new outside host is expected, so `legal.test.ts` recipients stay green. If one appears,
it goes into HOSTS (with `processors.md` and the privacy statement) or into NOT_RECIPIENTS
with the reason.

## 3. Accessibility as a legal obligation (AC-8)

The European Accessibility Act (Directive (EU) 2019/882, applied in the Netherlands through
the Implementatiewet toegankelijkheidsvoorschriften producten en diensten and its Besluit, in
force 28 June 2025) **does not apply to Vidalo**, on two independent grounds:

1. **Scope.** Art. 2(2): "this Directive applies to the following services provided to
   **consumers** after 28 June 2025". Art. 3(30): "‘e-commerce services’ means services
   provided at a distance … at the individual request of a **consumer** with a view to
   concluding a **consumer contract**" `[page]`. Vidalo sells only to businesses (terms 2.2,
   B2B confirmation at checkout).
2. **Microenterprise.** Art. 4(5): "Microenterprises providing services shall be exempt from
   complying with the accessibility requirements" `[page]` (fewer than 10 persons and
   turnover or balance sheet total of at most €2M).

So WCAG 2.2 AA failures on the owner area are **not** a compliance veto. They block through
QA as AC-8. The Dutch equal-treatment law for disability (Wet gelijke behandeling op grond
van handicap of chronische ziekte) has a general accessibility and reasonable-adjustment duty
for offering services. It is not enforced by a regulator; its reach to a B2B owner area was
not checked today (P2, lawyer only if a complaint arrives).

**When to re-check:** the EAA becomes relevant only if Vidalo sells to consumers **and** A101
passes 10 staff or €2M. Selling to consumers alone triggers the B2C pricing, withdrawal and
withdrawal-button rules first (`docs/legal-compliance-guidelines.md`, "Prices and VAT").

## 4. Legal texts that change, sentence by sentence

All in `packages/core/src/copy/index.ts` (NL) and `en.ts` (EN), `copy.legal`. The EN text
says the same thing, not more. Dutch prevails (terms 2.8).

### 4.1 Privacy statement

| # | Section (NL / EN) | Today | New (NL; EN in the same sense) |
|---|---|---|---|
| P1 | "Je account en inloggen" / "Your account and signing in", item "Gegevens" | "je e-mailadres, een nummer voor je account, wanneer je inlogde, je taal en welke e-mails je wilt ontvangen." | "je e-mailadres, een nummer voor je account, je taal en welke e-mails je wilt ontvangen, en van je laatste 10 keer inloggen: wanneer, en met welk soort browser en apparaat (zoals ‘Safari op een iPhone’). Je IP-adres bewaren we daarvoor niet. Om misbruik van inloglinks te beperken maken we van je e-mailadres en van je IP-adres een code en bewaren we die hoogstens een dag." |
| P1b | same, "Grondslag" | "de uitvoering van de overeenkomst met jou (artikel 6 lid 1 onder b AVG)." | "de uitvoering van de overeenkomst met jou (artikel 6 lid 1 onder b AVG); voor de lijst met keren inloggen en de codes tegen misbruik: ons gerechtvaardigd belang bij een veilig account (artikel 6 lid 1 onder f AVG)." |
| P1c | same, "Hoe lang" | "zolang je account bestaat. Je verwijdert je account zelf, zie ‘Je rechten’." | "zolang je account bestaat. Een inlog op een apparaat vervalt na 30 dagen zonder gebruik en uiterlijk 90 dagen na het inloggen. Je verwijdert je account zelf, zie ‘Je rechten’." |
| P2 | "Bewijs dat je het bedrijf beheert", "Hoe lang" | "zolang je account bestaat, of tot je de koppeling met Google verbreekt." | "Het bewijs zelf (wanneer en hoe) zolang je account bestaat. De toegangssleutel van Google trekken we bij Google in en verwijderen we zodra je de koppeling verbreekt onder ‘Google’ in je account, zodra je abonnement eindigt[, bij Vidalo Scan 60 dagen na de eerste volledige controle als er niets meer openstaat (B6)], en als je alles verwijdert." |
| P3 | "Een betaald plan", "Hoe lang" | "zolang je klant bent. Na het einde van je abonnement bewaren we je gegevens nog 90 dagen. Dan doen we nog één gratis controle en verwijderen we binnen 30 dagen daarna je gegevens. Alleen wat de wet voor onze administratie vraagt, bewaren we 7 jaar. Wat bij een andere partij is hersteld, blijft daar staan." | "zolang je klant bent. Eindigt je abonnement op Vidalo Monthly, dan verbreken we direct de koppeling met Google en bewaren we je gegevens nog 90 dagen. Dan doen we nog één gratis controle. 14 dagen voordat we je gegevens verwijderen krijg je een herinnering per e-mail, en uiterlijk 30 dagen na die controle verwijderen we ze. [Heb je alleen Vidalo Scan, dan verwijderen we je gegevens 24 maanden na je laatste keer inloggen of je laatste betaling; 14 dagen vooraf krijg je een herinnering (§2.4).] Verwijderen betekent: de gegevens van je bedrijf, de rapporten, je feitenpagina en het adres ervan, en je inlog als er geen ander bedrijf aan hangt. [Uit onze back-ups verdwijnen ze binnen {N} dagen daarna.] Alleen wat de wet voor onze administratie vraagt, bewaren we 7 jaar: je facturen, bij Stripe. Wat bij een andere partij is hersteld, blijft daar staan." |
| P4 | "Je rechten" / "Your rights", paragraph 2 | "Veel kun je zelf, onder ‘Account’ in je account: bij ‘Je gegevens’ download je alles wat we over je bedrijf bewaren, en verwijder je alles zodra je abonnement is afgelopen. Je kiest daar ook welke e-mails je wilt krijgen." (EN: "…and delete everything once your subscription has ended.") | "Veel kun je zelf, onder ‘Account’ in je account. Bij ‘Je gegevens’ download je alles wat we over je bedrijf en je inlog bewaren, zonder toegangssleutels, en verwijder je alles. Heb je een lopend abonnement op Vidalo Monthly, dan zeggen we het op tegen de einddatum en verwijderen we alles op die datum; het bedrag voor de lopende maand krijg je niet terug, en tot die datum kun je het verwijderen terugdraaien. Wil je dat we eerder verwijderen, mail dan support@vidalo.io. Na het verwijderen krijg je een bevestiging per e-mail. Onder ‘Google’ verbreek je de koppeling met Google. Je kiest onder ‘Account’ ook welke e-mails je wilt krijgen." The old sentence ("zodra je abonnement is afgelopen") becomes **false** the day A-05 ships |
| P5 | "De gratis controle", "Hoe lang", last sentence | "Word je klant, dan gelden de termijnen bij ‘Een betaald plan’." | "Word je klant, dan blijven de rapporten van je bedrijf voor jou te zien in je account en gelden de termijnen bij ‘Een betaald plan’." (AC-1) |
| P6 | "Met wie we gegevens delen" | Lists Supabase, Cloudflare, Stripe, Resend, Google, … | **No change** (no new vendor). Re-read in phase 4 |
| P7 | "Beveiliging" | "…versleutelde verbindingen, inloggen zonder wachtwoord, toegang per account tot alleen je eigen gegevens…" | Optional (P2): add "een inlog die vanzelf vervalt" after "inloggen zonder wachtwoord" |

Brackets `[…]` depend on Julian's decision (§2.4, B6) or on a looked-up fact (the backup
period). Leave them out rather than guess.

### 4.2 Cookie statement (table "Welke cookies we zetten" / "Which cookies we set")

| Cookie | Today (NL) | New (NL / EN) |
|---|---|---|
| `vidalo_business` (new, lane B, B-01) | — | NL: `["vidalo_business", "Als er meer dan één bedrijf bij je account hoort: onthoudt welk bedrijf je in je account koos.", "90 dagen"]` · EN: `["vidalo_business", "If more than one business belongs to your account: remembers which business you chose in your account.", "90 days"]` — **written in C-00** (B2) |
| `sb-…-auth-token` | "Houdt je ingelogd … " · "Tot je uitlogt, hoogstens 400 dagen" | Purpose unchanged. Lifetime: NL "Tot je uitlogt; na 30 dagen zonder gebruik of 90 dagen na het inloggen log je opnieuw in" · EN "Until you sign out; after 30 days without use, or 90 days after signing in, you sign in again" (A-01 sets `maxAge` 90 d, A-02 the 30/90 rule) |
| `sb-…-auth-token-code-verifier` | "Verwijderd zodra je bent ingelogd, anders hoogstens 400 dagen" | "…anders hoogstens 90 dagen" / "…otherwise at most 90 days", **if** phase 4's header check shows the verifier carries the forced `maxAge`. Otherwise keep the observed value |
| `/auth/confirm` page | — | Sets no cookie on GET (ADR-0003). Nothing to add. Assert it in phase 4 |
| `vidalo_mock_session` | NOT_ON_SITE in `legal.test.ts` | Unchanged (mock only), even though it now carries `sid` |

The section "Jouw keuze aanpassen" ("…je wordt dan uitgelogd") stays true.

### 4.3 Terms

**No change for this feature** (see §1). Clauses re-read: "Looptijd, opzeggen en
pauzeren" (all seven), "Toestemming … Google-bedrijfsprofiel … door de koppeling te
verbreken", "Je mag je rapporten … bewaren … ook na het einde", the definition "Gratis
controle … rapport dat 30 dagen via een link te zien is" (still true of the link; the
owner's longer access is more generous, not contrary). Conditional: COMP-25 if the Scan
retention is chosen.

### 4.4 Internal records

- `docs/processors.md`, Supabase row "What it gets": add "sign-in records (time, browser and
  OS family; no IP) and hashed rate-limit keys (kept at most one day)". Google row: add
  "OAuth tokens revoked at Google on disconnect, at the end of a subscription and on
  deletion". Resend row: add the new service mails and Resend's log retention once looked up.
- `docs/records-of-processing.md`: "Account and sign-in" gains the sign-in list and throttle
  (basis, retention). "Paid service" gains retention as built, with the dry-run date and the
  armed date. "Ownership verification" gets the new token end. A Scan retention row is added.
  "**purge not built yet**" is removed only once `VIDALO_PURGE=1` is set in production.

### 4.5 Mechanics

Each wording change needs a new `copy.legal.updated` date, the same in both languages, then
`pnpm --filter @vidalo/core legal:lock`, and `packages/core/test/legal.test.ts` green, in
the same PR. C-00 does this once for the cookie row (B2). A-07 does it again for P1–P5 and
the auth-cookie lifetimes; lane A owns `copy.legal` and `legal.lock.json`.

**Merge consequence of the new cookie:** `ACTIVE_BUSINESS_COOKIE` is exported by C-00, before
the lanes split, and the legal test reads every exported `…COOKIE…` constant in the source.
If the row is left to A-07 as `tickets/A-07.md` says, the legal test is red on C-00 and on
every commit of both lanes until A-07. Lane B merges first (`tickets/README.md`) and would
merge red, and no ticket's "`pnpm -r test` green" can be met honestly. Moving the row into
C-00 avoids that with no other change: C-00 already edits `copy/index.ts` and `en.ts`.

## 5. Pre-build checklist

| ID | Item | Verified by | Ticket | Sev |
|---|---|---|---|---|
| **Cancellation and refund** | | | | |
| COMP-01 | Every Vidalo Monthly on a login, including a second business, can be cancelled online under ‘Abonnement’ in at most two clicks from any `/app` page, with one confirming button and an optional reason | B-01 browser test (two businesses); A-05 spec | B-01, A-05 | P1 |
| COMP-02 | Cancel, undo, pause and resume never require a fresh sign-in, Google ownership proof or any step beyond a signed-in member. Only delete and address change use `requireFreshSignIn` | Grep the abonnement actions for `requireFreshSignIn`/`requireVerifiedOwner`; A-05 spec with a stale sign-in cancelling successfully | A-03, A-05 | P1 |
| COMP-03 | `deletionPlan` gives `at_period_end` for active, owner-paused and failed-payment Monthly, and the date it schedules is never more than one billing period after the request | `deletion.test.ts` cases; sandbox run shows `cancel_at` ≤ one period ahead | A-05, A-06 | P1 |
| COMP-04 | `/app/account` and `/app/abonnement` show "Je gegevens worden op {datum} verwijderd", "Toch bewaren", and say in words that undoing the cancel also calls the deletion off | A-05 spec, NL and EN | A-05 | P1 |
| COMP-05 | A delete-driven cancel sends a confirmation mail **straight away** with the end date, worded for deletion (no 90-day check; facts page offline; download reports and invoices before {date}; how to call it off) (B3) | A-05 test: `deleteMyData` on an active Monthly records one mail of that kind; `pnpm mail:lab` shows it NL and EN; grep shows it does not contain the 90-day sentence | A-05, A-07 | P1 |
| COMP-06 | The delete page states, before the button: Monthly, the end date and no refund of the running month; Scan, no refund once begun and the 30-day refund route at support@ if ownership could not be proven (B4) | Read `copy.accountSecurity` delete page NL and EN; browser check | A-05 | P1 |
| COMP-07 | The delete page and the mail say what goes (business data, reports, facts page and its address, Google connection, login if no other business) and what stays (invoices at Stripe 7 years; corrections at third parties), and that invoices cannot be downloaded from the account after deletion | Same | A-05 | P1 |
| COMP-08 | No refund is issued by any delete path, and none is promised. The purge never calls Stripe refund or credit APIs | Grep `refund`/`credit` in purge and delete code | A-05 | P1 |
| **Erasure (art. 17)** | | | | |
| COMP-10 | Vidalo Scan, never-paid and churned owners delete at once (AC-5b) | A-05 spec (Scan owner) | A-05 | P1 |
| COMP-11 | A deletion removes everything listed in §2.2 "erased at once", with a control business that survives, on MemDb and PgDb | `db-account.test.ts`, `purge.test.ts` | A-05 | P1 |
| COMP-12 | The purge never deletes the Stripe customer, its invoices or its subscription history | Read `purge.ts`; test with a fake Stripe that fails if called | A-05 | P1 |
| COMP-13 | The Google token is **revoked at Google** before it is deleted, on disconnect, churn and purge; `invalid_token` counts as done; a revoke failure on purge is logged and the token is still deleted | `google-revoke.test.ts` | A-04, A-05, A-06 | P1 |
| COMP-14 | The custom facts host and its Worker route are removed (recorded call in mock); the facts page answers not-found on every host of that business | A-05 test and spec | A-05 | P1 |
| COMP-15 | `account.deleted`, `google.disconnected` and `retention.*` carry no address and no token; `account.deleted` carries no business id; job payloads carry only `{ businessId, guard }` / `{ businessId, reason }` | A-05/A-06 log tests | A-05, A-06 | P1 |
| COMP-16 | A purge that is overdue (`retention.overdue` > 0) is seen by a person within a day: the count goes to the Control Room cell or an alert, not only a log line | Delivery-lead names where it is read | A-06, delivery-lead | P1 |
| COMP-17 | P2: on deletion, the removed facts URLs are sent to IndexNow and the host answers 410 or 404 (art. 17(2) reasonable step) | Read `purge.ts` | A-05 | P2 |
| **Export (art. 15, 20)** | | | | |
| COMP-18 | The export holds every category in §2.3, including the sign-in list and the subscription and deletion dates, and **no** token, secret or other person's e-mail address | `export-secrets.test.ts` plus a key-presence test per category | A-04 | P1 |
| COMP-19 | The export page or file says invoices are in the Stripe portal | Read the copy | A-04 | P2 |
| **Retention (art. 5(1)(e))** | | | | |
| COMP-20 | Monthly retention as published: Google token at churn, 90 days, one free check, reminder 14 days before, deletion ≤ 120 days after churn; never for a running, paused or un-cancelled subscription | `retention.test.ts` (A-06) | A-06 | P1 |
| COMP-21 | Scan Google token ends when the Scan's work is done (B6), unless Julian decides otherwise in writing | A-06 test; or a dated decision in `findings.md` | A-06 | P1 |
| COMP-22 | `auth_throttle` rows older than 24 h are pruned by the cron; the table holds only `key_hash` (64 hex) and `at` | `retention.test.ts` prune case; read 0018 | A-02, A-03, A-06 | P1 |
| COMP-23 | `auth_session` keeps no IP and no user-agent string, and at most the 10 newest rows per login | Read 0018 and `recordSignIn`; `db-account.test.ts` | A-02 | P1 |
| COMP-24 | Scan retention (F-002): Julian's decision is recorded before 0019 is written; what the privacy text says about Scan is exactly what the code enforces (proposal: 24 months after the later of last sign-in and last payment, reminder 14 days before) | `findings.md` F-012 status; 0019 CHECK/guard; P3 text | A-05, A-06, A-07 | P1 |
| COMP-25 | If the Scan retention is chosen: one sentence in the terms "Looptijd" on how long a Scan facts page stays online, new version date, 30-day notice to existing Scan customers if any exist (terms 2.7) | Diff of `copy.legal.terms` | A-07 | P1 |
| COMP-26 | The backup roll-off period of the Supabase plan in use, and Resend's message-log retention, are looked up and either stated in P3 or recorded in `processors.md` | `processors.md` diff with source | A-07 | P1 |
| **The dry-run switch** | | | | |
| COMP-30 | `VIDALO_PURGE` unset never holds back an **owner's** deletion: inline "now", its fallback job, and the scheduled `delete_reason = 'owner'` purge all delete. Only `retention` deletions are dry-run until armed (B1) | One unit test per path with `VIDALO_PURGE` unset; read `purge.ts` and `jobs/purge.ts` | A-05, A-06 | **P0 hard stop if shipped** (a false statement of erasure, art. 17 and 12(3)); P1 while unbuilt |
| COMP-31 | `VIDALO_PURGE=1` is set in production after the dry-run day, and the date is recorded in `05-verification.md` and `records-of-processing.md`. Until then the privacy text's retention promise is not kept: it is a go-live gate | Delivery-lead record | delivery-lead | P1 |
| **Sign-in and cookies** | | | | |
| COMP-40 | `vidalo_business` is in the cookie table NL and EN from C-00 on, with a new version date and lock (B2) | `legal.test.ts` green on C-00's commit | C-00 | P1 |
| COMP-41 | The cookie table's lifetimes for `sb-…-auth-token` and `sb-…-auth-token-code-verifier` match the `Set-Cookie` headers observed on a production build (90 days; 30/90-day session rule in words) | A-01 header check compared with the table | A-01, A-07 | P1 |
| COMP-42 | No new non-essential identifier, no browser storage, no third-party resource on `/auth/confirm` or any owner page; the confirm page sets no cookie on GET | `legal.test.ts`; A-02 route test | A-02 | P0 if a non-essential identifier appears |
| **Texts** | | | | |
| COMP-43 | Privacy P1–P5 present in NL and EN as in §4.1 (bracketed parts per decision); new `updated` date in both; `legal:lock`; `legal.test.ts` green; `processors.md` and `records-of-processing.md` updated (§4.4) | Diff; test run | A-07 | P1 |
| COMP-44 | Every sentence in the privacy text describes behaviour that ships in the **same** release (B7); none describes the purge as running while `VIDALO_PURGE` is unset unless COMP-31 is closed before launch | Compare the PR text with the merged tickets | A-07, delivery-lead | P1 |
| COMP-45 | The new mails (deletion confirmation, retention reminder, delete-driven cancel confirmation) carry the company identity footer and contain no offer or promotion | `pnpm mail:lab` read in NL and EN | A-05, A-06, A-07 | P1 |
| COMP-46 | No new customer-facing copy uses a banned word (MESSAGING) or claims more than the code does ("alles is verwijderd" only after the delete returned true; "wordt verwijderd" when queued) | Read the copy against `purge.ts` outcomes | A-05, A-07 | P1 |
| **Accessibility** | | | | |
| COMP-50 | AC-8 is enforced by QA, not compliance: the EAA does not apply (B2B; microenterprise). Phase 4 re-asks whether Vidalo still sells only to businesses and A101's headcount and turnover, and records the answer in the ship report | Ask at phase 4 | QA, ship report | P1 |

## Needing a lawyer (named in the ship report, not blocking)

1. **Data Act ch. VI:** is Vidalo a "data processing service" (art. 2(8), recital 81)? If
   yes, the terms need the art. 25 exit clauses. The legal desk carries it; not caused by
   this feature.
2. **Art. 17 timing:** is scheduling a Monthly owner's deletion for the period end (at most
   a month) acceptable when the person asks to delete, given the privacy text offers an
   earlier deletion through support@?
3. **Reflexwerking:** confirm the reading that the terms' cancellation clauses would pass
   6:233(a) for a small business even when 6:236 j/o is used as a yardstick. They are more
   generous than the consumer standard, so I expect yes.
4. **Scan facts page lifetime:** deleting a Scan customer's facts page after a period of
   inactivity is a change to what was sold. Confirm a terms sentence plus a reminder suffices.

## Learned here, for the standing list

- A dry-run or arming switch that protects against a retention bug must never hold back a
  person's own deletion request; the two paths are tested separately.
- A second route to the same contractual act (a cancel triggered by "delete everything")
  owes the same confirmation as the main route, with wording true for that route.
- A cookie constant introduced in a scaffold ticket brings its cookie-table row in the same
  ticket when a test enforces the table.
