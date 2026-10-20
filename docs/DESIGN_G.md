# Design G — build spec

This is the design `apps/web` must match. It supersedes the visual spec in `docs/DESIGN_RESEARCH.md` §3–4 (serif/paper) — that direction was rejected. The reference boards are checked in under `docs/design-g/` and are the source of truth for copy, order and layout:

| File | Page | Route |
|---|---|---|
| `design-g/FullG.dc.html` | Landing | `/` |
| `design-g/ResultG.dc.html` | Result, red/green (7 questions, incl. one "niets gevonden" row) | `/r/[id]` |
| `design-g/ResultGGrey.dc.html` | Result, grey: AI does not know the business | `/r/[id]` when `visibility === "unknown"` |
| `design-g/SectorG.dc.html` | Sector page (loodgieters & installateurs, with switcher) | `/vak/[slug]` |

Open them in a browser (they are self-contained HTML; ignore the `support.js`/`x-dc` wrapper). Copy the Dutch copy **verbatim** — every string goes into `packages/core/src/copy/index.ts`, nothing hard-coded in JSX.

## Tokens

```
--bg        #FFFFFF
--ink       #111827
--ink-2     #374151   (body on white)
--muted     #666D7B   (labels, captions; was #6B7280, darkened 17 Oct 2026 for WCAG AA, docs/e2e.md)
--line      #E5E7EB   (1.5px borders)
--panel     #F3F4F6   (grey panels, rows)
--panel-2   #F9FAFB   (footer)
--red       #D41B44   (klopt niet; also tinted bg #FDECEA; was #E11D48)
--green     #2B7A53   (klopt; was #2F855A)
--grey      #9CA3AF   (niet gevonden)
--amber     #F59E0B   (bezig / herstel loopt)
--blue      #2563EB   (one accent: primary button, links on hover)
```

Font: **Plus Jakarta Sans** 400/500/600/700/800 via Google Fonts (`next/font/google`; replaced Manrope in Oct 2026 to match the Vidalo logo). Base 17px / line-height 1.5. Headings 800 weight, tight tracking: h1 56–64px (`letter-spacing:-2px`, lh 1.02), h2 34–40px (`-1px`, lh 1.1), card titles 20px 700. Max content width 1168px, side padding 40px desktop / 16px mobile. Radii: cards 18px, panels 24px, buttons/inputs 12px, pills 999px.

**Warm pass (Oct 2026, option 1, chosen by Julian: "te klinisch en saai").** The grey and white page became warmer: `--line #E7E3DC`, `--panel #F4F1EC`, `--panel-2 #FBF8F3`, and three section grounds `--cream #FBF6EE`, `--sky #EEF4FF`, `--mint #EDF7F1` (classes `ground-cream|sky|mint|warm` in `globals.css`). The hero has a soft three-colour glow (`.hero-glow`), the dark sections are deep blue `#0F172A` with blue and green light, cards are rounder (22px, panels 28px) with a soft shadow. These override the "no gradients, no shadows" rule below; the rest still holds. Looping scenes (`components/viz`) explain each step and are styled in `app/scenes.css`.

Rules kept from the brief: one primary (blue) button per view; no gradients, no shadows except a soft one on the floating result card; no dark mode; no emoji; no exclamation marks; status colours only in dots, pills and report rows, never as section backgrounds.

## Components

- **Stip** (status dot): 10px inline, 22px in lists, 220px hero circle on result pages with number + label inside. Colours above. Grey = niet gevonden, always rendered as its own state, never as "no errors".
- **ScanField**: 52px input + black button "Controleer gratis"; sub-line "Twee minuten. Geen account."
- **AnswerCard**: italic grey question, answer line with highlighted span (red tint for wrong, grey tint for not-found quote), caption "n van 3 keer".
- **FindingRow / ReportRow**: `grid 32px 1fr 1fr 120px` — dot, question, what AI said, frequency. Grey row text: "Ik kan geen informatie vinden."
- **SourceRow**: panel row, label left, status right (`klopt` green / `ontbreekt`/`niet geclaimd` red / neutral grey text).
- **CriteriumCard** (3 cards: afhakers / misleiders / verwarring) + colour legend.
- **SectorCard** (11): sector name, one-line "doorslaggevend feit", link to `/vak/[slug]`.
- **PriceBlock**: two plans, "Excl. btw · geen opzegtermijn".
- **Footer**: `A101 B.V. (handelend als Vidalo) · Factorij 80, 3071 AV Rotterdam · KvK 42057858 · Prijzen excl. btw`. No btw-nummer.

## Landing (`/`) — section order, anchors

1. Hero: h1 "Wat zegt AI over jouw bedrijf?", one line, ScanField. Nothing else above the fold.
2. `#veranderd` Wat er veranderde — "Je klanten googelen niet meer. Ze vragen."
3. `#leest` Zo leest AI over je bedrijf — the agent explainer for laypeople (how an assistant assembles an answer from sources; grey "AI kent je niet" case).
4. Snippers — "Het antwoord is uit snippers gebouwd. De helft klopt niet." (sources with numbers from Insites 10k audit).
5. Geen loket — "Je kunt het antwoord niet aanpassen. Wel de bronnen."
6. `#werkt` Zo werkt Vidalo — controleren, vinden, herstellen, bewijzen.
7. `#criteria` Twaalf feiten die een klant laten komen, of afhaken — 3 CriteriumCards + legend (from `docs/CRITERIA.md`).
8. `#vak` Per vak andere vragen, andere fouten — 11 SectorCards → `/vak/[slug]`.
9. `#rapport` Zo ziet je rapport eruit — sample report incl. grey row.
10. Bewijs — Van rood naar groen (before/after).
11. Missie — "Ieder bedrijf verdient een plek in het antwoord."
12. `#prijs` Prijs.
13. `#vragen` Vragen (FAQ incl. "Wat als de AI mij niet kent?" and the honest model-memory limit).
14. Slot — "Welke kleur heeft jouw stip?" + ScanField.
15. Footer.

Nav: Vidalo logo (`components/Logo.tsx`: the mark, a blue dot with one corner at the bottom left rounded at 10 %, plus the wordmark "vidalo") · Zo werkt het (#werkt) · Criteria (#criteria) · Per vak (#vak) · Prijs (#prijs) · Vragen (#vragen) · Inloggen.

## Result (`/r/[id]`)

Three states by overall colour: red (findings), green (all correct), grey (`visibility === "unknown"`). Header shows "Gecontroleerd op <datum, tijd>". Hero: 220px stip with `n van m vragen` + h1 `<Naam>, <Plaats>: …`. Per-engine counts line. Then AnswerCards (3), the full question table, "Waar het vandaan komt" (SourceRows), plan panel with the colour steps (grey → amber → green), two price buttons, email-report field, "Zelf doen?" block. Grey variant swaps copy to "AI kent je niet." / "Waarom de AI niets vindt" / "Zo word je gevonden" (see `ResultGGrey.dc.html`).

## Sector pages (`/vak/[slug]`)

Static pages generated from the sector packs in `packages/core/src/prompts/sectors.ts` (one source for both copy and scanner). Layout per `SectorG.dc.html`: switcher across the 11 sectors, hero, "drie feiten die de doorslag geven", table of sector questions (question → criterium → what goes wrong), why it matters, before/after example, CTA with ScanField prefilled with sector hint. Slugs: `loodgieters-installateurs`, `aannemers-dakdekkers-schilders`, `vve-beheer`, `zorg-praktijken`, `horeca`, `winkels`, `garages-fietsenmakers`, `kappers-schoonheid`, `advocaten-notarissen-accountants`, `makelaars-hypotheek`, `kinderopvang-sport-rijscholen`.

## Mobile

Not designed yet in G; follow the earlier mobile boards' structure (stack everything, 16px gutter, ScanField full width, report rows become stacked cards). Must pass at 390px with no horizontal scroll.

## Definition of done

- Landing, result (3 states), 11 sector pages, dashboard shell all in G.
- Playwright screenshots at 1280 and 390 for `/`, `/r/[demo]` (red + grey), `/vak/loodgieters-installateurs` stored in `out/screenshots/`.
- `pnpm -r typecheck && pnpm -r test && VIDALO_MOCK=1 pnpm e2e:mock && pnpm --filter web build` green.
