# Brief — 001 Business profiles: questions per kind of business, and competition

*analyst · 2026-11-11 · status: draft, waiting for Julian's approval*

## The one sentence
A business that sells online or across the country (like Sonable) stops getting the questions
for a local shop (opening hours, Sunday, pinnen, street address). Instead it is asked what a
customer of its kind asks: which provider is good for this, what are the alternatives to a
named competitor, and how they compare on price, features and who it is for. The report then
shows who AI names next to it, how often, and how AI describes it.

## Why now
Julian's own free check of Sonable on vidalo.ai (run `cb4aac86`, 11 Nov 2026) asked a B2B music
service whether it is open on Sunday and takes card payments, and came out green. Part of
that is three bugs, which are being fixed separately. The rest is a gap in the product: every
question set assumes a business with a door in a town (`basePrompts` always asks hours,
address and payment; the 11 sector packs only add questions on top). Online and national
businesses are a large share of the people who care how ChatGPT presents them, and their
question is "does AI name me next to my competitors", not "does AI know my hours". Sonable is
an A101 venture, so it is also the "practise what we preach" customer (`docs/PRODUCT.md`
PD7). Until this exists, a free check for that customer is wrong in a way the customer
notices at once.

## Who it is for
| Who | What they are trying to do | What they do today instead |
|---|---|---|
| Owner of an online or national B2B service (Sonable: AI background music for hotels and horeca) | See whether ChatGPT and others name them when a buyer asks for this kind of service, who gets named instead, and whether what AI says about them is right | Ask ChatGPT by hand a few times. Vidalo's free check asks them about Sunday hours |
| Webshop owner | The same, for "where do I buy X online" and "alternative to shop Y" | The same |
| B2B software founder | The same, for "which tool for X" and "alternative to product Y" | The same |
| Local owner with a door or a service area (kapper, bakker, loodgieter) | What Vidalo does for them today | Unchanged; this feature must not change their check (one small, deliberate exception for service-area businesses, see Q7) |

## Acceptance criteria
QA tests exactly these. "Mock mode" means `VIDALO_MOCK=1` (`pnpm dev`, `pnpm e2e:mock`). "Online
profile" means the business profile "online of door heel Nederland". The three profiles in
customer words are: *klanten komen bij mij langs* (with a door), *ik kom bij de klant* (at the
customer's place), *ik werk online of door heel Nederland* (online and national).

1. **AC-1: the profile is chosen visibly on the free check.** Given the pick step `/scan/kies`
   (EN `/en/...` equivalent) with a business candidate, when the page shows, then each
   candidate carries one choice between the three profiles, preselected as follows: a Google
   listing with a street address → *klanten komen bij mij langs*; a Google listing without a
   public address (a service-area business) → *ik kom bij de klant*; no Google listing →
   *ik werk online of door heel Nederland*. The visitor can change the choice before
   starting. When the online profile is chosen, two fields are required: website (prefilled
   when known) and "Wat bied je aan, en voor wie?" (a few words, e.g. "achtergrondmuziek voor
   hotels en horeca"). The chosen profile and those words are stored with the check. The pick
   form keeps its one button per candidate; no new primary button appears.
   *Checked by:* a unit test of the preselection for the three cases, and a browser check of
   `/scan/kies` in mock mode for a candidate of each kind (NL and EN).

2. **AC-2: a free check for Sonable, Rotterdam asks the questions of an online business.**
   Given a free check started for "Sonable", place "Rotterdam", online profile, website
   `sonable.io`, offer "achtergrondmuziek voor hotels en horeca", when its questions are
   generated, then there are 6 questions; none asks about opening hours, Sunday, pinnen or
   payment, street address or phone number; none contains "Rotterdam" or any other town; and
   the 6 include at least one question about what Sonable does, the website question, at
   least two category questions built on the visitor's words with no business named (in the
   shape "Welke achtergrondmuziek is goed voor een hotel?"), and one question asking for
   alternatives to Sonable.
   *Checked by:* a unit test on the free question set for this input, and one real free check
   of Sonable (CLI `pnpm scan --name Sonable --place Rotterdam --kind free` with the online
   profile, or on vidalo.ai by Julian), whose questions are read in the report and `out/scans/*.md`.

3. **AC-3: local businesses keep today's questions.** Given businesses with the profile
   *klanten komen bij mij langs* (at least a kapper with Google type `hair_care`, a bakkerij
   without a sector, and one business from each of the horeca and winkel packs), when the free
   and full question sets are generated, then they are identical, text for text and in the
   same order, to what `main` at commit `5a1a40e` generates for the same facts. For a business
   with the profile *ik kom bij de klant* (a loodgieter), the sets are identical except that
   the street-address question is gone.
   *Checked by:* a snapshot unit test against the question sets of `5a1a40e`, plus `pnpm
   e2e:mock` staying green.

4. **AC-4: a full check for an online business asks about named competitors.** Given a paid,
   verified business with the online profile, when its full check's questions are generated,
   then for each competitor in use (at most 3) the check asks one question for alternatives to
   that competitor ("Wat is een alternatief voor Soundtrack Your Brand?") and one question
   setting the business next to it on price, features or who it is for. Competitors in use are
   the names the owner entered on `/app/gegevens`; when the owner entered none, the 3 names AI
   mentioned most often in the previous check's category answers, shown on `/app/gegevens`
   labelled as named by AI, where the owner can remove them. A name the owner enters is
   checked once with a "what is X" question; if at least half of the answers say not found,
   `/app/gegevens` shows that AI does not know this name and no competitor questions are asked
   for it. The business's own name cannot be entered as a competitor. What AI says about a
   competitor is never judged and never becomes a finding; only claims about the business are
   compared with its facts.
   *Checked by:* unit tests on question generation and the competitor check, and the mock
   pipeline with a seeded online business that has two owner-entered competitors, one of them
   unknown to the mock engines.

5. **AC-5: the report shows who AI names next to the business, with counts.** Given a finished
   check of an online-profile business, when its report `/r/[id]` is opened (NL and `/en`),
   then a competition block shows, per category and competitor question: how often the
   business was named ("n van m antwoorden"), up to 5 other names AI gave with "n van m
   antwoorden" each, and up to 3 quoted sentences in which AI describes the business, each with
   the AI system that said it. A business named in none of the answers shows "0 van m" and the
   names, not an empty block. The block contains no score, no percentage, no position or rank
   number ("#1", "plek 2"), and no judgement of a competitor. Reports of local-profile
   businesses keep "Wie AI wel noemt" as it is today.
   *Checked by:* a unit test on the report view model (asserting the counts add up to the
   answers and that no "%" or rank appears in the block's text), and a browser check of an
   online-profile report in mock mode, NL and EN.

6. **AC-6: the colour of the dot follows the stipregel, and competition stays out of it.**
   Given a check of an online-profile business, then the dot is computed from the questions
   about the business only, by the stipregel in `docs/CRITERIA.md`; whether the business is
   named in a category or competitor answer never changes the colour. An answer that describes
   the business as a different kind of business than the owner's words (a shop, a hearing-aid
   company) is a finding on criterium 11 (identity), threshold 1 of N, so the dot is at least
   orange. Concretely: a fixture in which ChatGPT says Sonable is a shop at Weena 705 open on
   Sunday gives orange or worse, never green; a fixture in which every answer about Sonable is
   right and Sonable is named in 0 category answers gives green.
   *Checked by:* unit tests with those two fixtures, through the same code that colours a real
   report.

7. **AC-7: every new string exists in Dutch and English, and every surface says the same thing.**
   Given the change, then every new customer-facing string exists in
   `packages/core/src/copy/index.ts` and `en.ts` (typecheck enforces it); every new question
   pack exists in Dutch and English item for item, enforced by a test in the manner of
   `test/sectors-en.test.ts`; no new string contains GEO, AEO, LLM, prompt, platform,
   zichtbaarheid, ranking, share of voice or a promise that Vidalo makes AI name the business
   (checked by a test over the new copy keys). And the same PR updates every surface that
   describes the product, each listed in the PR description with a link to the change or one
   line on why it needs none: landing (how it works, FAQ), pricing, `docs/CRITERIA.md`,
   `docs/MESSAGING.md`, the assistant's knowledge (`core/chat`), mails, and terms and privacy
   (with `pnpm --filter @vidalo/core legal:lock` and a new version date if their wording
   changes). Julian approves the PR before merge.
   *Checked by:* `pnpm -r typecheck && pnpm -r test`, and QA reading the PR's surface table
   against the diff.

8. **AC-8: the new screens are accessible.** Given the profile choice and the online fields on
   `/scan/kies`, the competitor field on `/app/gegevens`, and the competition block on
   `/r/[id]`, then they meet WCAG 2.2 AA: the choice and fields are operable by keyboard alone
   with visible focus, the choice is a labelled group with an accessible name, required-field
   errors are announced and tied to their field, and nothing in the competition block is told
   by colour alone. An axe run on each of the three pages, NL and EN, in mock mode reports no
   serious or critical violations.
   *Checked by:* axe (Playwright + axe-core) on the three pages, and a keyboard-only pass by
   QA, against `docs/process/checklists/a11y.md`.

## Success metric
| Metric | Today | Target | How it is measured |
|---|---|---|---|
| Free checks with the online profile that ask any hours, Sunday, payment, address or phone question | 100% (Sonable, 11 Nov) | 0% | the stored questions of every free check with the online profile, from the first day live |
| Online-profile free reports whose competition block names at least one other business | none exist | 80% or more over the first 30 online-profile checks | the stored report (`recommendations` per question, `others` not empty) |
| Visitors who change the preselected profile on `/scan/kies` | not measured | under 20% (higher means the preselection is wrong too often) | stored profile vs preselected profile per free check |
| Paid checkouts from online-profile free checks within 30 days | 0 | first 2 by 31 Jan 2027 (directional; no baseline) | checkout events joined to the free check's business |

## Explicitly not in this cycle
- **The three Sonable bugs**: a town alone becoming the address fact, questions without a
  reference fact dropped silently, wrong counts on the report. A separate fix (`A101/_OS/LEARNINGS.md`,
  2026-11-11). This feature depends on its rule "a check without reference facts is grey,
  never green" (see D1).
- **New AI systems.** Same engines as today; Copilot stays out.
- **A new price or plan.** Online businesses buy Vidalo Scan (€149 once) and Vidalo Monthly
  (€49/month) as everyone else (see Q5).
- **A rotating question bank for the new packs.** Core questions and competitor questions
  only; the bank and promotion (`rotation.ts`) come later.
- **Competition in mails, on `/app` and as a trend on `/app/voortgang`.** The block is on the
  report page only.
- **What the setup does for an online business**: directory sync and fix paths are not
  changed. The copy for an online business must not promise Dutch directory sync (MESSAGING
  "say only what the code does").
- **Judging competitors**, reviews or sentiment, positions in a list, percentages, a "you
  versus them" table.
- **Sector pages (`/vak/...`) for the new packs**, more than 3 competitors, more than one location.
- **Changing the questions of the 11 local packs**, other than the address question for
  *ik kom bij de klant*.

## Dependencies and open questions
Questions 1 to 6 change the work if answered differently; Julian decides them. Rows from 7 on
are low-stakes; the assumed answer is used unless Julian says otherwise.

| # | Question | Blocks | Who answers | Assumed answer if silent |
|---|---|---|---|---|
| Q1 | How is the profile decided on the free check, given that Google may not know the business (Sonable has no listing) and there is no KvK key on production? | AC-1, AC-2 | Julian | A preselected choice of three on `/scan/kies` (inferred from Google as in AC-1, no listing → online), changeable by the visitor. Choosing online asks for the website and "Wat bied je aan, en voor wie?". Reason: inference alone gets Sonable wrong (no listing, no website known), and the category words are owner-asserted, which `docs/CONTRACT.md` requires of facts. Alternatives rejected: a default (wrong for every local business without Google), reading the website alone (no website is known for "Sonable, Rotterdam"). Cost: one more step for online businesses on the free check |
| Q2 | Where do competitor names come from, and how is an owner's name checked? | AC-4 | Julian | Both: up to 3 names entered by the owner on `/app/gegevens` (paid), checked once with "what is X" (unknown to AI → shown, not used); without owner names, the 3 most-named in the previous check, labelled as named by AI and removable. The free check uses no competitor names: it asks "alternatives to {business}" instead |
| Q3 | How does the dot work for a business whose main questions are recommendation questions? | AC-6 | Julian | The stipregel unchanged: questions about the business decide the colour, named/not named stays out (your decision of 25 Oct 2026). New: AI describing the business as another kind of business is a criterium-11 finding, 1 of N, orange. Consequence: an online business AI never names but describes correctly is green, with the competition block showing "0 van m" |
| Q4 | `docs/CRITERIA.md` excludes "ranking en share of voice" and "vergelijkingen met concurrenten". The competition block counts how often AI names the business and others. Amend CRITERIA.md? | AC-5, AC-7 | Julian | Yes, amend deliberately and narrowly: we show who AI names and how often, per question, as counts; still no position, no percentage, no score, no "jij versus de buren" table, and no promise to change it. Why: for an online business the competitive set is the decision a buyer makes, and it is what you asked for on 11 Nov |
| Q5 | Which plans does this fall under? | AC-7 | Julian | Vidalo Scan €149 once and Vidalo Monthly €49/month, unchanged. The plan line "1 vestiging" reads "1 bedrijf" (or similar) for an online business; no new price |
| Q6 | Every surface describing the product changes in the same PR, Julian approves before merge: is the list in AC-7 complete? | AC-7 | Julian | Yes: landing (how it works + one FAQ entry such as "Werkt dit ook als ik geen winkel heb?"), pricing, CRITERIA, MESSAGING, assistant knowledge, mails (only if they describe the questions), terms and privacy if wording changes |
| Q7 | Does *ik kom bij de klant* drop more than the street address? | AC-3 | analyst | Only the street-address question; hours, phone and payment stay (spoed and availability matter for these trades) |
| Q8 | Is the town used anywhere for an online business? | AC-2 | analyst | No: no question contains it; the form still asks it, the report header shows the name without a town |
| Q9 | Which new packs? | AC-2, AC-4, AC-7 | analyst | Three: online service (B2B or consumer), webshop, B2B software. The pack is picked from the visitor's/owner's words and website; the owner can change it after paying, as with sectors today |
| Q10 | How many questions in a full check for an online business? | AC-4 | analyst | No more than today's upper bound of 38 per check (`docs/CRITERIA.md`), so the cost model in `docs/cost-per-client.md` holds; sampling rules unchanged |
| Q11 | Does the competition block replace "Wie AI wel noemt" for local businesses? | AC-5 | analyst | No; local reports are unchanged this cycle |
| D1 | The separate Sonable bug fix (grey when there is no reference fact) | AC-6 | backend | Lands before or with this feature; AC-6 assumes it |

## Risks
| Risk | Likelihood | If it happens | What we do about it now |
|---|---|---|---|
| Owners read counts of who is named as a ranking Vidalo can improve, against MESSAGING ("never claim control", no "#1 in ChatGPT") | Medium | Complaints and churn when the counts do not move | AC-5 forbids position, percentage and score; AC-7 forbids the promise; the block says what we count and that we fix facts, not preferences |
| Text typed by a visitor or owner (offer words, competitor names) ends up inside questions sent to AI systems | High that someone tries | Abuse of paid AI calls, odd or offensive questions in a report | Length and character limits; the security checklist (phase 1) must cover these two inputs explicitly |
| Name extraction (`namedBusinesses`) is tuned for local list answers and misreads product names and SaaS answers | Medium | Wrong or missing names in the block | The mock fixtures for AC-4/AC-5 use real-shaped online answers; the real Sonable check (AC-2) is read by hand |
| The extra step on `/scan/kies` lowers free-check completions | Medium | Fewer reports for online businesses | Only the online profile gets the two fields; the third metric shows whether preselection is right |
| €149 setup is mostly about local listings; an online business may see little in it | Medium | Low conversion for online businesses | Out of scope here; copy must not promise what does not apply (AC-7); revisit after the first 30 online checks |
| Naming competitors' brands in our report raises a legal question | Low | A complaint from a named company | Names and quotes come from AI answers and are labelled as such; compliance reviews in phase 1 |
