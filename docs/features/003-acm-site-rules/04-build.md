# Build log — 003 ACM rules on the site

*Unattended build run, night 1, 2026-11-16. Tickets: BE-01, FE-01, FE-02, BE-03. BE-02 (complex) is not in this night.*

Every claim below was observed in this run. "Red" means the test failed on the old string
or code put back; "green" means it passed again with the change.

## BE-01 — Copy keys, one company source, the claims test

Built: `COMPANY` in `core/shared/contact.ts`; every key of `02-architecture.md` §5 in
`copy/index.ts` and `copy/en.ts` (incl. `mails.order`, used by BE-02); `PRICES` moved to
`copy/prices.ts` and re-exported from `copy/index.ts` (so EN can build strings from it
without an import cycle: `index.ts` imports `en.ts`); `packages/core/test/copy-claims.test.ts`.

| Claim | Evidence |
|---|---|
| Rule 1, no popularity claim | old chip `Meest gekozen` put back: red (`['nl:landing.prijs.monitor.chip']`), green with the new chip |
| Rule 2, "10.000 bedrijven" names its country | `10.000 bedrijven klopte` put back in `snippers.body`: red (`['nl:landing.snippers.body']`) |
| Rule 3, €49 per month names the €149 | the old `dashboard.scanOnly.bodyNone` (no €149) put back: red (1 hit) |
| Rule 4, company line complete | footer without ` · btw ${COMPANY.vat}`: red (`footer.legal lacks NL869514192B01`) |
| Rule 5, gratis/free list | the word `gratis` added to the new chip: red (snapshot differs); the snapshot holds 71 key paths, NL and EN, for Julian to read once |
| `legal.lock.json` unchanged | nothing under `copy.legal` edited; `legal.test.ts` green; `git status` shows no change to `copy/legal.lock.json` |
| Gate | `pnpm -r typecheck` green; core 94 files, 1425 passed / 23 skipped; worker 7 files, 52 passed; `pnpm e2e:mock` OK |

Deviations from the ticket text, for the PR reader:
- The complaint and order-mail strings use `CONTACT.support` and `CONTACT.phone` (so `support@vidalo.ai`), not the `support@vidalo.io` the architecture table still shows; the repo moved to vidalo.ai on 15 Nov (CLAUDE.md). FE-01's e2e therefore expects `CONTACT.email`, not `hello@vidalo.io`.
- `mails.order.termsMonthly` EN says ‘Subscription’ (the real EN name of the page, `billing.h1`), the architecture draft said ‘Plan’.
- The ticket's control for rule 3 ("the old `monitor.limit`") would not go red: the old limit already contained €149. The old `bodyNone` is the real old string that does.
