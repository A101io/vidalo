# Reality check: what Vidalo promises vs what actually happens (25 Oct 2026)

Every promise customers read (site, pricing, FAQ, terms), checked against the code on `main` and against the first real scans (5 businesses in Haarlem, 1 in Rotterdam, findings verified by hand). Until 25 Oct everything was tested in mock mode only: made-up AI answers and simulated directories. Mock tests prove the code does what was written; they do not prove that what was written matches the world.

Legend: **Works** = happens for real today · **Built, untested** = code exists, only run in mock mode · **Blocked** = code exists, waits for an outside approval or key · **Not built** = nothing happens · **Overpromise** = the sentence claims more than the product can do.

## A. The check

| # | Promise (where) | What really happens | Status |
|---|---|---|---|
| A1 | "Elke maand stellen we ChatGPT, Google AI, Gemini en Perplexity de vragen" (Hoe het werkt, pricing) | Only ChatGPT has a key. Google AI (via SerpAPI), Gemini and Perplexity are skipped silently without a key; Copilot is a stub that never answers | **Overpromise** today; Works for ChatGPT |
| A2 | Free check "wat zeggen ChatGPT en Google AI" (page title, description) | Free check asks ChatGPT, Google AI and Copilot; only ChatGPT answers | **Overpromise** |
| A3 | "Meerdere keren / tien keer per vraag" | Monthly check: 10 samples per question (code). Free check: 3 | Built; cost: ~37 questions × 10 × ChatGPT ≈ €9 per customer per month for ChatGPT alone, against €49 |
| A4 | "We vinden elke fout en de bron" (description) | Compares AI answers with Google's data. Verified by hand: ChatGPT was truly wrong for 1 of 5 businesses; in 2 cases Google was wrong, not ChatGPT | **Overpromise**; "check this" wording built (branch `claude/check-this`, no PR yet) |
| A5 | "Opnieuw na elke wijziging in je gegevens en na elke herstelde fout" (FAQ) | Recheck jobs exist | Built, untested |
| A6 | Free check works on the live site | Two bugs found and fixed today (cost cents crash: PR #70; counting); OpenAI credit is empty | **Blocked** (credit, #70 unmerged) |

## B. Publishing

| # | Promise | What really happens | Status |
|---|---|---|---|
| B1 | "Een feitenpagina op je eigen domein, met datum" (pricing, Hoe het werkt, Straks) | Page is built in three forms (HTML, schema.org, llms.txt). It has **no web address**: no route on the worker, `feiten.vidalo.io` does not exist, Cloudflare for SaaS not set up; the no-website fallback host needs a decision | **Not reachable** |
| B2 | "Synchronisatie met Google" / "Google-profiel direct via je login" | Adapter built; needs Google OAuth client + Business Profile API approval (60-day verified profile) | **Blocked** |
| B3 | "… Bing, Apple …" | Not built; becomes a manual task | **Not built** |
| B4 | "… en dertien bedrijvengidsen" | 6 via web forms (bot may not fill them) → manual task; 5 via e-mail but **no contact address stored for any** → manual task; Yelp and Foursquare: TODO | **Not built** (nothing is sent) |
| B5 | "Feitenpagina live, Google en gidsen gevuld — dag 2" (timeline) | None of it happens on day 2 today | **Overpromise** |
| B6 | "Geen domein? Dan regelen wij er een" (FAQ) | Creates a manual task | Manual |
| B7 | Facts page announced to Bing and Google (IndexNow, Search Console) | Built; IndexNow key and service account not set | Built, untested |

## C. Fixing at the source

| # | Promise | What really happens | Status |
|---|---|---|---|
| C1 | "Hersteld waar wij bij kunnen, aangeschreven waar het moet, namens jou" (Hoe het werkt) | A correction mail goes out only when a contact address is stored; none are, so in production no mail is sent (the `info@` guess runs in mock mode only) | **Not working** |
| C2 | "Wij herstellen de bronnen waar AI uit put" (FAQ, terms) | Big platforms (Tripadvisor, Yelp, Facebook, Google, Bing, Apple, Thuisbezorgd, Treatwell, Zorgkaart) accept changes only from the owner after a claim in their own portal; e-mail from us does nothing there | **Overpromise** |
| C3 | "Herstel bij derden duurt meestal twee tot vier weken" (pricing footnote) | Never measured by us | Unverified |
| C4 | "Daarna vragen we het opnieuw en zie je voor en na" | Recheck + "hersteld" mail with before/after built | Built, untested |
| C5 | Before/after cards "hersteld in 12 dagen" | Labelled "voorbeeld"; fictional | OK as labelled |

## D. Manual tasks ("operator queue")

| # | What | Status |
|---|---|---|
| D1 | Every task the system cannot do (Bing, Apple, directory forms, missing contact addresses, domain registration) | Written only as an event row in the database. **No screen, no notification**: in production these tasks would be lost silently |

## E. Owner effort and ownership

| # | Promise | What really happens | Status |
|---|---|---|---|
| E1 | "Vijf minuten: je gegevens bevestigen, één DNS-regel, één keer inloggen bij Google" (FAQ) | Saving facts requires ownership proof; the only proof is Google sign-in with Business Profile access → nobody can save today | **Blocked** |
| E2 | Owner fills missing info (Gegevens page) | Form exists; no "also known as" field; halal/delivery only as free text | Works (once E1 is solved) |

## F. Reports, account, money

| # | Promise | Status |
|---|---|---|
| F1 | Monthly report with proof | Built, untested |
| F2 | Payment, invoice, cancel, pause, data export/delete | **Works** (Stripe sandbox; cancel/pause and export in mock + local Postgres) |
| F3 | Sign-in by magic link | **Works** (verified on vidalo.io 25 Oct) |
| F4 | Mail from vidalo.io | **Works** (Resend verified; 14 test mails sent) |
| F5 | The report "is a downloadable PDF with problems first" | Not built (decided 25 Oct) |

## G. Market claims and examples

| # | Claim | Status |
|---|---|---|
| G1 | 45% of Dutch use AI, 1 in 4 ChatGPT when shopping, Insites 10,000-business study, source shares | Sourced in `docs/content-check.md` (14 Oct); not re-checked |
| G2 | Haarlem examples (bakkerij "zondag open", kapsalon "permanent gesloten", …) | Labelled fictional ("Fictieve Haarlemse voorbeelden, echte patronen") |
| G3 | "In een controle van 10.000 bedrijven klopte bij de helft minstens één antwoord niet" | Third-party US study; our own Dutch sample so far: 1 of 6 truly wrong |

## H. Terms and privacy

| # | Text | Status |
|---|---|---|
| H1 | Terms "Wat we doen": "zetten we je gegevens in Google, Bing, Apple en Nederlandse gidsen, en vragen we bronnen met een fout om die te herstellen" | **Overpromise** (B2–B4, C1–C2) |
| H2 | Privacy: processors OpenAI, Google, Perplexity, SerpAPI | Correct for what is planned; add Anthropic/Twilio if those are used |

## What works end to end today

Sign-in, payment (sandbox), mail, cancel/pause, data export/delete, the coming-soon page and waiting list, and a ChatGPT check that produces a report (after #70, with credit). **Publishing, syncing, fixing at the source and ownership proof do not work for a real customer today.**

## Proposition that is true and buildable (for decision)

1. **Check:** what ChatGPT (and later the others, named only once connected) says about you, verified, problems first, as a PDF.
2. **Facts page:** one dated, owner-confirmed page in a form every AI reads, on your domain or on `vidalo.io/bedrijf/<name>` for businesses without a website; announced to Bing (ChatGPT's search index) and Google. Fully automatic.
3. **Google profile:** we show exactly what to change and check that it changed (automatic once Google approves).
4. **Other platforms:** per platform where you are listed, a claim-and-change checklist; we check afterwards whether it is right. E-mail corrections only to editorial sites with a known address.
5. **Monthly:** same questions again, proof of what changed.

Not promised any more: "we fix it everywhere", "synchronisation with Bing, Apple and 13 directories", "day 2: everything filled".

## Decisions for Julian

1. Adopt the proposition above? (rewrites site, pricing, FAQ, terms; De Boer reviews the terms anyway)
2. Which AI systems to connect before launch (each needs a key and adds cost per check)?
3. Ownership proof without Google: phone-code call (Twilio, ~€0.05) + domain e-mail?
4. Facts page address for businesses without a website: `vidalo.io/bedrijf/<name>`?
5. A small operator screen for manual tasks, or drop every promise that needs one?
