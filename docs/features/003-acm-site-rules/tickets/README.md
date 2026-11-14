# Tickets — 003 ACM rules on the site

*architect · 2026-11-15 · contract: `../02-architecture.md` §6*

| Ticket | Lane | AC | Estimate | Depends on | Complex |
|---|---|---|---|---|---|
| [BE-01](BE-01.md) Copy keys, company source, claims test | backend (core) | 1, 2, 6, 7, 8, 10, 11, 17 | 0.5 d | — | no |
| [FE-01](FE-01.md) Company details on every page and /contact | frontend | 1, 2, 3 | 0.25 d | BE-01 keys | no |
| [FE-02](FE-02.md) Price card total, form sentence, no pre-ticked box | frontend | 7, 9, 11 | 0.5 d | BE-01 keys | no |
| [BE-02](BE-02.md) Order confirmation from the webhook | backend | 14, 15 | 1 d | BE-01 keys | yes |
| [BE-03](BE-03.md) Monthly price everywhere, checkout pinned | backend | 11, 12 | 0.5 d | — | no |
| **Total** | | | **2.75 d** | | |

Order: BE-01 first (keys only; a small commit). Then FE-01, FE-02, BE-02, BE-03 in any order;
their files are disjoint (`02-architecture.md` §6, "File ownership"). Nobody but BE-01 edits
`copy/index.ts` or `copy/en.ts`. Nothing edits `copy.legal` or `legal.lock.json`.

Before the PR is opened: `corepack pnpm -r typecheck && corepack pnpm -r test && corepack pnpm e2e:mock && corepack pnpm mail:lab`, then the two e2e specs (normal and gate mode).

AC-4, AC-16 and the clean-browser and test-order checks are Julian's (`02-architecture.md` §12, J-1…J-9).
