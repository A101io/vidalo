# 005 — Productlijnen in het dashboard: brief

Status: brief only (21 Nov 2026). Nothing built. The corporate page (`/organisaties`, feature 004) describes both levels, the company and the product line, as what a pilot checks. It does **not** promise a dashboard view of product lines. Add that sentence to the page only once this feature ships.

## The problem
A manufacturer is asked about far more than its company: "welk persfittingsysteem is het beste voor renovatie", "welke drukklasse heeft X", "waar koop ik X in België". Those questions often do not name the brand. Today Vidalo knows one business with one set of facts (`Facts`, versioned) and asks place-based business questions (`prompts/index.ts`, sector packs). It has no notion of a product line.

## What the owner can do
1. On `/app/productlijnen` (EN `/en/app/product-lines`), add a product line. Fields:
   - **name** ("Tigris K5")
   - **category**, the noun the comparison questions use ("persfittingsysteem")
   - **use cases** (one per line: "renovatie", "nieuwbouw")
   - **markets** (country codes from `core/shared/country.ts`)
   - **specifications** (label → value pairs)
   - **certificates** (name, number, valid until)
   - **where to buy**, per market (name, url)
   - **replaces / replaced by** (older product names)
   - **status**: active, discontinued
2. Edit a line. As with business facts, a change is a new version only on the owner's confirmation.
3. See per line, per market, after every monthly check:
   - one dot per AI system
   - open errors with their source
   - "genoemd als aanrader" as n of m, for the category questions, with who else was named
   - the trend, as on `/app/voortgang`
4. Open a product-line finding on `/app/fouten/[id]`, the same page as now. The finding names its line.

## What the scanner asks per line (per market, in the market's language)

| Kind | Example | Criterion |
|---|---|---|
| Category, recommendation | "Welk {category} is het beste voor {use}?" | recommendation, never a position (docs/CRITERIA.md) |
| Specification | "Welke {spec label} heeft {name}?" | compared to the owner's value |
| Certificate | "Is {name} {certificate}-gecertificeerd?" | expired or replaced certificates count as wrong |
| Where to buy | "Waar koop ik {name} in {country}?" | outlet not in the owner's list, or not in that country |
| Alternatives / old names | "Wat is de opvolger van {replaced name}?" | old name or wrong owner |

Sampling follows the existing rules (`FIRST_SAMPLES`, escalation; docs/cost-per-client.md). Each line adds questions × markets × engines, so the cost per client grows per line. The cost model needs a row for it before prices are set.

## Data (sketch, for the architect)
- **New table `product_line`:**
  - `id`, `business_id` → business
  - `name`, `category`, `status`
  - `markets text[]`
  - `facts jsonb`, versioned like business facts (`product_line_facts_version`, or the same pattern as `facts`)
  - `created_at`, `updated_at`
- **Existing tables:** `prompt`, `sample` and `finding` get a nullable `product_line_id`. A finding with a line is reported under that line.
- **RLS:** the owner reads and writes their own lines (same rule as business children). Internal tables stay service-only.
- **Gating:** adding lines and scanning them need `requireVerifiedOwner` and a paid plan that includes lines (`apps/worker/src/jobs/paid.ts`).
- **Mock seed:** the demo owner gets two lines with a held error and a fixed one, so the pages can be built without keys.

## Acceptance criteria
- AC1: A verified, paying owner adds, edits and marks a product line discontinued. An unverified or unpaid owner sees the page but cannot save, with the reason shown.
- AC2: A confirmed line enters the next monthly check. Its questions are asked per market in that market's language (`scanLang`).
- AC3: `/app/productlijnen` lists each line with per-market dots per AI system, the open error count and "genoemd als aanrader" n of m. It never shows a score or a ranking position.
- AC4: A product-line finding opens on `/app/fouten/[id]` with its line, raw samples, source and fix actions. "Ik heb dit aangepast" works as for business findings.
- AC5: The monthly report mail has a section per line, in the owner's language.
- AC6: RLS is proven with a rolled-back DO block: the owner sees their lines; another owner and anon see none.
- AC7: `pnpm -r typecheck`, `pnpm -r test` and `pnpm e2e:mock` stay green. The mock pipeline includes a line.
- AC8: Every surface is updated in the same PR, and Julian approves before merge: `/organisaties` (then it may say "in je dashboard"), pricing, FAQ, terms (what a line includes), mails, docs.
  - **Amended 21 Nov 2026 (Julian: "Yes, with the price"):** this PR carries the owner pages, mails, legal texts and docs. The public surfaces (FAQ, assistant, `/prijzen`, `/organisaties`, the terms line "what a line includes") ship in one later change together with the price (D1) and `VIDALO_PRODUCT_LINES=1` in production.

## Decisions for Julian
- **D1 Price:** included in an enterprise plan, or a price per line per month? This drives the cost model.
- **D2 Limits:** a maximum number of lines and markets per plan.
- **D3 Who enters lines:** only the verified owner, or also invited colleagues? Roles per country team are a separate feature (004 D6).
- **D4 Migration on the hosted project:** a new table and three new columns. Applied only after the branch is approved.
