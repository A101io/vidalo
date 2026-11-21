# ADR-0012 — Lines are written by the server only; the limit is checked under a lock; access is one function

*2026-11-21 · status: accepted*

## Context
Every active line adds up to 14 questions per market to every monthly check (about €2.50–4.10 per
line and market per month). Price (D1), limits (D2) and who may enter lines (D3) are open; Julian
will decide them and they must be cheap to change. 0016 set the pattern: members read through
SELECT-only `member_*` policies, all writes go through the server after a membership check.
`Db.withLock` exists for count-then-insert limits.

## Decision
- RLS on `product_line` and `product_line_facts`: SELECT for members (`member_product_line`,
  `member_product_line_facts`); `revoke all` from anon and authenticated, `grant select` to
  authenticated. No insert, update or delete policy.
- Writes only in `Db.saveProductLine` and `Db.setProductLineStatus`, called by the two server actions
  after `requireOwnerOf(businessFromForm(form))` (membership) and `productLineAccess(business,
  session.userId)`. Inside the method, under `withLock("product_line:<businessId>")`, a new line or a
  reactivation is refused when the business already has `maxActive` active lines; the caller passes
  `PRODUCT_LINE_LIMITS.lines`.
- `PRODUCT_LINE_LIMITS` (`core/shared/product-lines.ts`) is the only place the numbers live; the
  database CHECK on a version's size is a looser backstop, not the plan limit.
- `productLineAccess` (same file) is the only place that says who may save and scan lines: today the
  verified owner, paying, on the monthly plan, not paused. The web action and the worker's gate both
  call it.

## Consequences
**Good:** D1/D2/D3 change one constant or one function; a crafted request cannot add a line, raise
a limit or skip the sanitiser; parallel saves cannot pass the limit.
**Bad:** the limit lives in code, so a script with the service role that bypasses `saveProductLine`
is not stopped by the database; the lock serialises a business's line saves (harmless at this rate).
**We can no longer:** let the browser write a line through the Data API, or express a per-plan limit
in SQL without a second copy of the number.

## Alternatives rejected
| Option | Why not |
|---|---|
| An RLS insert/update policy for members | The policy cannot see the plan, the limit, the version numbering or the sanitiser |
| A trigger counting active lines against a constant | A second copy of a number that is about to change with D2 |
| A conditional insert without a lock | Two concurrent saves each count below the limit |
| `requireVerifiedOwnerOf` in the page | It redirects to `/app/google`; AC1 wants the page shown with the reason |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
