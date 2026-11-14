# ADR-0009 — Company identity has one source; every company line outside the legal texts is built from it

*2026-11-15 · status: accepted (architect, feature 003)*

## Context
The company's name, address, KvK number, btw number and phone are typed by hand in at least
five places: the footer line in both languages (`packages/core/src/copy/index.ts:684`,
`en.ts:668`), the legal contact line in both languages (`index.ts:755`, `en.ts:732`) and
Vidalo's own facts record (`packages/core/src/shared/own.ts:45-48`). `CONTACT`
(`core/shared/contact.ts`) already holds phone and email once. Feature 003 adds the btw number
to the footer, which would be a sixth hand-typed copy. The legal texts are Julian's
(`_OS/AUTHORITY.md`) and are hashed by `legal.test.ts`; a run may not change them.

## Decision
`COMPANY` (`legalName`, `tradeName`, `street`, `postcode`, `city`, `kvk`, `vat`) lives beside
`CONTACT` in `core/shared/contact.ts`. `landing.footer.legal` in both languages, and any future
company line outside `copy.legal`, is a template over `COMPANY` and `CONTACT`. `copy.legal.contact`
stays hand-written and a test asserts it contains the same values, so a change to one without
the other is red.

## Consequences
**Good:** one edit changes every page footer, every owner mail footer (`reporter/layout.ts:145`)
and every support reply (`support/index.ts:27`); the btw number cannot drift.
**Bad:** a move or a new KvK entry is two edits (the constant and the legal text), held
together only by a test.
**We can no longer:** type an identity field into copy outside `copy.legal`.

## Alternatives rejected
| Option | Why not |
|---|---|
| Type the btw number into `footer.legal` | A sixth copy; the same drift risk the ADR exists to stop |
| Build `copy.legal.contact` from `COMPANY` too | Edits legal text (Julian's) in this feature; and later a code-file edit of `COMPANY` would silently become a change of the legal texts, decided outside the legal review |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
