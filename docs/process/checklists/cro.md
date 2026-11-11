# Standing CRO checklist

Per-feature CRO review is a **diff against this list**. Every finding must name the metric it
moves and an estimate of by how much — a CRO finding without a number is a P2 by rule.

## The primary flows and their one metric each
Fill this table once per venture from its `CLAUDE.md` or `knowledge/`. A flow with no metric
cannot be reviewed; a feature that touches none of these flows gets a P2 at most.

| Flow | Metric | Owner of the number |
|---|---|---|
| <visitor → first conversion> | | cro |
| <lead → activated account> | | cro |
| <returning user → repeat> | | cro |

## Non-negotiable
- [ ] One primary action per screen, visible without scrolling on a 375px-wide phone
- [ ] The price, what is delivered, and the cancellation rule are visible **before** any form
- [ ] No account required before a person knows what they get; defer the account to the last possible step
- [ ] Every form field earns its place — each one costs conversion. If it is not needed to fulfil, it is not on the form
- [ ] Errors are inline, specific, and keep what the person already typed
- [ ] The state after success says what happens next and where to find it again
- [ ] Loading states never move the primary action
- [ ] Trust at the moment of payment: what is charged, when, what happens if it cannot be fulfilled
- [ ] A sticky-sidebar or `flex-wrap` layout is checked at 375px **in the built markup**, not
      assumed from the desktop mock — a row that wraps to one column commonly drops the primary
      action below several sections of content that were beside it on desktop
- [ ] Where a login or account gate is a settled decision and not CRO's to relitigate, the review
      still names *where* it costs least: model the flow as browse (no gate) → commit to a
      specific offer (gate here, at the latest) → pay, and cost whichever placement was chosen

## Instrumentation — no CRO claim without it
- [ ] Every step of a primary flow emits a named event, defined in the ticket before build
- [ ] Events carry enough properties to segment by the venture's own dimensions (region, account,
      device, new vs returning)
- [ ] The funnel is queryable end-to-end before the feature is called done
- [ ] No event contains personal data beyond a pseudonymous id — see the compliance checklist
- [ ] A funnel step is only "counted in the database" if a row is written for it independent of
      the step's outcome. A state machine that writes a row only on success (e.g. only the payment
      webhook confirms the order) has no row for the abandoned case, and a conversion-rate target
      on that step is unmeasurable until an attempt-level row exists
- [ ] A hard, legally- or policy-required stop (an age gate, a jurisdiction block) gets its own
      named event, separate from ordinary abandonment — otherwise a required refusal and avoidable
      friction show up as the same number and get chased as the same problem

## Activation funnels (two-sided products)
General to any flow where a supply-side account is created before it can transact.
- [ ] A required legal/consent step (terms acceptance, a data notice) has an actual screen or
  inline moment drawn for it. If the design has no screen for it, that is a hidden step-count
  regression waiting to be discovered at build, not a settled step count
- [ ] A flow with several independent verification checks (each of which can fail on its own)
  has a **designed failure state for each check**, not just the happy path. Designs default to
  simulating success; the undesigned failure states are usually where the flow's own stall metric
  will turn out to live
- [ ] An out-of-scope control drawn next to an in-scope primary action on the same screen is filed
  even when a brief's exclusion list already covers it elsewhere — an exclusion list does not stop
  a drawn control from being carried into build by habit

## Out of lane
Colour, typography, brand tone, and anything that cannot be tied to one of the primary metrics.
