# Test flow: the customer journey by hand

> Written 9 Nov 2026. Control Room row **PD8** (`A101/_OS/playbook/PRODUCT.md`). The evidence
> for a run is a dated journey log in `docs/journeys/` (format in §5). Nothing in this file
> replaces the automated suites (`pnpm -r test`, `pnpm e2e:mock`, Playwright, `mail:lab`); it
> is what they cannot do: one person walking the whole product as the customer, with the real
> AI systems, the real payment page, a real phone and a real inbox.

Two modes, always in this order:

| Mode | Where | Needs | Takes | Proves |
|---|---|---|---|---|
| **Mock** | `vidalo-demo` on http://localhost:3000 (launch entry in `.claude/launch.json`; no Supabase, no Turnstile, `VIDALO_MOCK=1`, gate off) | nothing, no keys | 20 min | every screen and state exists and reads right |
| **Real** | https://vidalo.ai behind the launch gate, sandbox Stripe, production Workers and database | §0 | 2 hours spread over a day (the worker runs on its own clock) | the journey works end to end on production, and where it stops |

Steps are the same in both modes. A line marked *(mock)* says what differs there.

## 0. Before a real run

| | What | Who | Where |
|---|---|---|---|
| 0.1 | The code on production is the code under test: PR 105 merged, then one manual `deploy.yml` run with target `production`; `scripts/verify-deploy.mjs` green | Claude, on Julian's yes | https://github.com/A101io/vidalo/actions/workflows/deploy.yml |
| 0.2 | Stripe sandbox has the Terms and Privacy URLs set, or Checkout refuses to open a session (go-live B3). **Done 9 Nov 2026** on `acct_1UR4RAELCe3OOCe2`: `https://vidalo.ai/voorwaarden`, `https://vidalo.ai/privacy`, support address Factorij 80, 3071 AV Rotterdam; proven by creating a session with terms consent. The live account had them already | done | https://dashboard.stripe.com/acct_1UR4RAELCe3OOCe2/test/settings/business-details |
| 0.3 | The test business. Ownership is proven by a code called or texted to the number Google lists for the business, so either (a) a real business whose phone Julian answers, or (b) Claude sets `business.owner_verified_at` by hand for the test business, named as such in the log. Decide before the run | Julian | chat |
| 0.4 | The owner address is Julian's own inbox. Every mail in the flow really goes out through Resend | Julian | chat |
| 0.5 | OpenAI hard monthly budget is set (keys-todo K7); the daily AI ceiling in the worker is on. Cost of one run: one free check plus one baseline check, see `docs/cost-per-client.md` | Julian checks | https://platform.openai.com/settings/organization/limits |
| 0.6 | The preview key for the gate (`/voorvertoning`), one browser, one fresh profile with no cookies | Julian has it | — |
| 0.7 | **The fix round writes to real third parties.** After the baseline the fixer mails directories and websites in the owner's name. Run with a business you own, or stop after step 3.6 and read the queue first. Say which in the log | Julian decides | chat |

Known gaps a real run will hit today, recorded, not fixed on the spot: only the OpenAI key is on the Workers (ChatGPT answers; Google AI, Gemini, Perplexity, Claude columns stay empty); the facts-page hostname is undecided (go-live D5, PR 95), so publishing stops; Google Business Profile sync waits on Google's API access; the other directories go to an operator queue that has no screen.

## 1. Visitor

| Step | Do | Must see | Record |
|---|---|---|---|
| 1.1 | Open https://vidalo.ai in the fresh profile | The coming-soon page (`/binnenkort`), the list form, no site navigation. *(mock)* gate is off, skip to 1.3 | — |
| 1.2 | Go to https://vidalo.ai/voorvertoning, enter the preview key | The landing page. Closing the browser ends the preview (session cookie) | — |
| 1.3 | Cookie notice: press "Begrepen"; then "Cookie-instellingen" in the footer | Notice gone; footer link reopens it; one `vidalo_consent` cookie | — |
| 1.4 | Landing: scroll all 14 sections, the simulator, "Straks", prices; open `/prijzen`, `/hoe-het-werkt`, `/waarom`, one `/vak/...` page | No copy that promises what step 0 says does not run yet (Bing, Apple, "dertien gidsen" are Control Room Q-20261106-01) | anything that reads wrong, with the URL |
| 1.5 | Free check: business name, town and the owner address (0.4) in the hero form; leave the news box off on the first run, tick it on the second; "Controleer gratis" | Without an address the form does not submit (browser message in the page's language); a bad address posted anyway comes back to `/scan/kies?fout=mail` with the field again. `/scan/kies` lists Google Places candidates; pick one (the address rides along in the `vidalo_check` cookie, not in the link). *(mock)* goes straight to the result | which candidate, its place id if shown |
| 1.6 | Wait on `/scan/[id]` | Progress states, then the result `/r/[id]`: red, orange, green or grey hero, one row per question, answer cards, source rows, "Wie AI wel noemt", the plan steps, never a score | time from submit to result; which AI columns have answers |
| 1.7 | Inbox, without doing anything on the result page | The report mail arrives on its own once the scan is done (sender, subject); its link opens the same report; the result page's "Stuur dit rapport naar mij" already reads "We sturen het rapport naar je e-mailadres"; with the news box ticked the business carries a `marketing.consented` event with the consent sentence (SQL: `select payload from event where type = 'marketing.consented'`) | mail arrival time, sender address, spam folder yes/no |
| 1.8 | Switch to EN on the result page; open `/en` | Same report in English, prices and FAQ in English under `/en/...` | — |

## 2. Buy

| Step | Do | Must see | Record |
|---|---|---|---|
| 2.1 | On the result page choose **Vidalo Scan** (€149 once) for the first run; Monthly (€49 per month, needs Scan) on a second run | Stripe Checkout (sandbox banner): terms checkbox, the B2B confirmation with terms and privacy links, btw-nummer field, iDEAL and card offered, amount excl. btw | — |
| 2.2 | Pay with test card `4242 4242 4242 4242`, any future date, any CVC; on the second run pay once with the iDEAL test bank | Redirect to `/welkom`: the steps for the plan bought (Scan: no monthly promise) | Checkout session id from the URL or the Stripe dashboard |
| 2.3 | Inbox | Welcome mail (Vidalo-branded, owner's language) and the sign-in link mail. The sign-in mail's sender shows whether Supabase SMTP is on Resend yet (keys-todo M1) | both senders, arrival times |
| 2.4 | Stripe dashboard → Developers → Webhooks | `checkout.session.completed` delivered, response 200. The endpoint is registered on `vidalo.io`; that host serves POST without redirecting, by design | event id |
| 2.5 | Try the same checkout again from the result page as a stranger (another browser) | Refused with `?betaling=betaald`; event `checkout.refused` | — |

## 3. Owner

| Step | Do | Must see | Record |
|---|---|---|---|
| 3.1 | Click the sign-in link | `/auth/confirm` → "Koppel … aan dit account?" → "Ja, koppel dit bedrijf" → `/app`. *(mock)* type the address on `/inloggen`, you are signed in at once | — |
| 3.2 | Dashboard `/app` before anything ran | Empty "Wat nu", the log with the purchase, the rail for the plan: Scan shows the scan rail and offers Monthly, no "Controleer nu"; Monthly shows the next date and "Controleer nu" | screenshot |
| 3.3 | Ownership `/app/google`: Google route is blocked by Google's API access, so take the phone route: "Bel mij" (landline) or SMS (mobile) to the Places number | Code arrives; wrong code refused; right code → "Eigenaar bevestigd"; `ownerVerifiedVia: phone_code`. Limits: 3 codes per business per day, 5 tries per hour. Option (b) of 0.3: the SQL used, verbatim | channel, seconds to arrive, Twilio log id |
| 3.4 | Facts `/app/gegevens`: fill address, hours, phone, services, sector fields, policies; confirm | Version 1 stored; `/app/gegevens/versies` lists it; "Wat nu" on the dashboard changes | — |
| 3.5 | Domain `/app/domein`: enter the business domain or leave it | CNAME instruction, or the fallback host. **Stops here today**: the hostname scheme is undecided (D5) and the runtime Cloudflare token is missing | the exact message shown |
| 3.6 | Wait. The worker runs queued jobs every minute and the cron tick every ten (`apps/worker/wrangler.jsonc`). With plan paid and owner verified, `setup` runs: baseline check, publish, sync | Baseline mail arrives (owner's language, the next-step line per plan); dashboard shows the errors grouped per question, one dot per AI system, and the log lines with a proof link each; `spend` event in the log | minutes from 3.4 to the mail; AI cost in the event |
| 3.7 | Finding `/app/fouten/[id]` | Raw samples, the source, every fix action with evidence, "Ik heb dit aangepast" (queues a recheck now), "Dit klopt wél" (dispute → `/app/gegevens?betwist=…`) | one of each, the log lines it leaves |
| 3.8 | Listing `/app/vermeldingen/[id]` (Google) | The profile now and after, approve or decline; sync blocked today, so "wacht" | state shown |
| 3.9 | Monthly only: "Controleer nu" on the dashboard; then again | First: a check queued and run; second within 7 days: the limit message, no second run | — |
| 3.10 | Fix round (only if 0.7 says yes) | Letters to the directories and the website owner, Dutch, signed by the owner, one per third party; owner mail with the exact change for the own website; rechecks dated | recipients, one letter pasted into the log |

## 4. Account and leaving

| Step | Do | Must see | Record |
|---|---|---|---|
| 4.1 | `/app/account`: switch language, change mail preferences, change the e-mail address | Language follows on every `/app` page and in the next mail; preferences enforced in the next mail; the address change asks for a confirmation link (Supabase), old address until confirmed | — |
| 4.2 | `/app/account`: "Download je gegevens (JSON)" | A file with the business, facts versions, findings, events; no address other than the owner's own | — |
| 4.3 | `/app/abonnement` (Monthly): "Pauzeren" 1 month, undo; "Opzeggen" with a reason, undo before period end; "Open facturen" | Status and rail follow (paused: end date; cancelled: runs to period end); a confirmation mail per change; Stripe sandbox shows `pause_collection` and `cancel_at_period_end`; the portal opens with cancelling switched off | the three mails |
| 4.4 | Unsubscribe link in a follow-up mail | `/afmelden` confirms; every optional group off on `/app/account` | — |
| 4.5 | `/app/voortgang` after the second check | Dots per question and AI system comparing the two checks; filters work; no position or score anywhere | screenshot |
| 4.6 | Sign out, open `/app` | `/inloggen`; the preview cookie still opens the marketing pages | — |

## 5. Close the run

1. Write `docs/journeys/YYYY-MM-DD-<business-slug>.md`: date, mode, business, plan, who ran it; then one line per step above with time, result (ok / stopped / wrong) and the recorded values; the mails as sender + subject + time; the step where the run stopped and why. Screenshots next to it in `out/journeys/` (gitignored) or linked.
2. Update Control Room cell **PD8** for vidalo (`A101/_OS/control-room/state/vidalo.json`): status, the log path as evidence, the date; anything Julian must decide in `needs_julian`. Rebuild and republish per its README.
3. Clean up: sandbox payments need no refund; cancel the sandbox subscription in Stripe; delete the test business's rows only when the business is not Vidalo itself (SQL named in the log, run after Julian's yes); `waitlist` is never touched.
4. One dated line in `A101/_OS/LEARNINGS.md` for anything that cost more than ten minutes.

## Where a run can stop today, in order

1. ~~0.2 not done: Checkout does not open.~~ Done 9 Nov 2026.
2. 3.3: the test business has no place id, or nobody answers its phone.
3. 3.5: facts page has no address (D5, PR 95, Cloudflare runtime token).
4. 3.6: only ChatGPT answers; the other columns are empty.
5. 3.8 and 3.10: Google sync and directory fixes wait in a queue.

Everything before each stop is still evidence. The log says where it stopped; the Control Room row says what unblocks it.
