# Legal and compliance guidelines (baseline A3)

Read before writing anything a customer will read. This is a compliance aid, not legal advice.

## Claims we make, and what backs each

| Claim | Where | Backed by |
|---|---|---|
| "Wij zorgen dat het antwoord klopt" (tagline) | Everywhere | Softened everywhere it matters: "Niemand bepaalt wat een AI-assistent antwoordt" (FAQ, terms). Counsel to confirm the tagline reads as an aim, not a guarantee. |
| Statistics (45% Eurostat 2025, 1 op 4 Adyen 2025, 33% KPMG/Melbourne 2025, BrightLocal source mix 2026, Insites 10.000 US businesses 2026) | Landing, /waarom, /vak | Each carries its source on the page; verified 14 Oct 2026 in docs/content-check.md. Keep the source line with the number. |
| "Herstel bij bronnen van derden duurt meestal twee tot vier weken, soms langer" | Pricing, result page, terms | Matches `FIX_PATHS` (third_party recheck 30 days, unfixable after 45); typical, not promised: the terms say it depends on the third party. |
| Facts page in HTML, schema.org and llms.txt | Landing "Straks" | `packages/core/src/publisher/render.ts` |
| OKF "volgen we" | Landing "Straks" | A statement of intent only; nothing is published in OKF yet. Do not say "OKF-compatible" until it is. |
| Fictional examples (bakkers, Van Dijk, Hendriks…) | Scenes, simulator, report | Every one is captioned as fictional. Keep the caption with the example. |

## Never use
- Words: GEO, AEO, LLM, prompt, credits, zichtbaarheid, platform, agent (except for "AI-agents", which stays in English and untranslated: the "Straks" glossary, the footer link "AI-agents en OKF" and the /straks page title; Julian, 14 Oct 2026), garantie, gegarandeerd, controle over AI.
- Never claim control over what an AI says; never promise to be named or ranked.

## Prices and VAT
B2B only. Prices are shown **excl. btw** everywhere, with "Alle prijzen excl. btw" next to them. Stripe uses a fixed 21% tax rate, exclusive (`STRIPE_TAX_RATE_ID`); checkout refuses without it. If Vidalo ever sells to consumers, prices must be shown incl. btw and the B2C rules (withdrawal right) apply: flag before doing it.

## Personal data
See `docs/records-of-processing.md` and `docs/processors.md`. Cookies the app sets. Functional, no consent needed:

| Name | Purpose | Lifetime |
|---|---|---|
| `sb-<ref>-auth-token` (Supabase) | Keeps the owner signed in | Up to 400 days (Supabase SSR default) |
| `sb-<ref>-auth-token-code-verifier` (Supabase) | Ties the magic link to the browser that asked for it | Removed after sign-in, else up to 400 days |
| `vidalo_consent` | The visitor's cookie choice (`lib/consent.ts`) | 12 months |
| `vidalo_google_state` | CSRF state during Google sign-in | 10 minutes |
| `vidalo_preview` | Build phase only: opens the site behind `/binnenkort` | Session |
| `vidalo_mock_session` | Development only (mock mode) | Session |

With consent only (6 Nov 2026; `lib/trackers.ts`, `components/Trackers.tsx`). Each tracker is off until its id is set (`GA4_MEASUREMENT_ID`, `META_PIXEL_ID`); with an id set the notice asks for its category (refuse first, same size), no script loads before the choice, GA4 runs in Consent Mode v2 denied by default, and withdrawal clears the cookies below. The consent cookie went to version 2, so every earlier "Begrepen" is asked again.

| Name | Category | Purpose | Lifetime |
|---|---|---|---|
| `_ga`, `_ga_<id>` (Google Analytics 4) | analytics | Visitor statistics | 2 years |
| `_fbp` (Meta pixel) | marketing | Ad measurement and retargeting; Vidalo and Meta are joint controllers for collection and transmission (CJEU C-40/17 Fashion ID) | 3 months |

The public inventory is `copy.legal.cookies` (`/cookies`); keep both in step (`packages/core/test/legal.test.ts` fails when they differ). Browser storage: none (the assistant's conversation lives in component state). Fonts are self-hosted by Next (no Google Fonts request from the visitor). Third-party script: Cloudflare Turnstile (`challenges.cloudflare.com`) on the free check and sign-in, treated as strictly necessary security and named in the cookie statement. Google Analytics (`www.googletagmanager.com`) and the Meta pixel (`connect.facebook.net`) load only after consent (table above). Adding any storage write or tracker means a row here and a cookie statement entry in the same change.

## DPIA screening (P3)
Vidalo processes business facts, mostly not personal data; owner emails and Google account ids are ordinary personal data; no special categories, no location tracking of people, no profiling of individuals, not large scale. **Screening outcome: a full DPIA is not indicated.** Re-screen if Vidalo starts monitoring people (e.g. sole traders at scale). Re-screened 6 Nov 2026 for GA4 and the Meta pixel: consent-gated website measurement and ad audiences of visitors, no special categories, not large scale; a full DPIA is still not indicated.

## Open questions for counsel
1. ~~Terms, privacy and a cookie statement from the masters~~ final texts written 26 Oct 2026 from Sonable's counsel-reviewed set (Julian: no outside counsel in this phase); routes stay `/voorwaarden`, `/privacy`, `/cookies` (EN `/en/terms`, `/en/privacy`, `/en/cookies`). Points for a later lawyer are in that PR.
2. ~~Retention~~ set in the privacy text: free check 12 months, closed accounts 90 days + one check + 30 days. **No purge job exists yet**; build it before launch.
3. ~~Reminder unsubscribe sentence~~ done.
4. ~~Hosting processors~~ Cloudflare, in the privacy text and `docs/processors.md`.
5. Whether "Wij zorgen dat het antwoord klopt" needs a qualifier next to it.
6. The EU AI Act: Vidalo uses AI providers to ask questions; it does not offer an AI system to the public. Confirm no transparency duty applies beyond saying which assistants we ask.
7. (Legal review 6 Nov 2026) AI Act art. 50(1), applicable since 2 Aug 2026: the website assistant and, once switched on, the support@ auto-reply talk to people. Both say they are automated (`copy.chat`, `kit-support.ts` DISCLOSURE). Confirm Vidalo is the "provider" of these two systems (built on OpenAI) and that the disclosure as shown meets art. 50(1) and (5).
8. (Legal review 6 Nov 2026) US transfers rest on the EU-US Data Privacy Framework where the vendor is certified, else SCCs. The appeal against the General Court's Latombe judgment (C-703/25 P) is pending. Confirm per vendor which basis applies (processors.md "DPF / SCCs" is not yet checked per vendor) and whether the SCC fallback is in each DPA.
9. (Feature 001, 11 Nov 2026) Reports name other businesses that AI assistants give (some of them sole traders), with counts, and a paid check uses those names in questions to AI assistants. Is the privacy statement (version 11 Nov 2026, "Over wie het gaat" and "Een betaald plan") enough under AVG art. 14(5)(b), or is a legitimate-interest assessment on file also needed?
10. (Feature 001, 11 Nov 2026) Other businesses' trade names in questions sent to AI systems ("Wat is een goed alternatief voor …?") and in a private report: assumed referential, non-trade use, so no trademark infringement. Confirm.
11. (Feature 001, 11 Nov 2026) A customer who publishes their own report, with named other businesses and counts: the terms allow sharing one's own reports (6.3 fourth item, 11.2), forbid use against the law or others' rights (6.3 first item) and carry an indemnity (15.8); none names publishing other businesses' names expressly. Confirm that suffices.
