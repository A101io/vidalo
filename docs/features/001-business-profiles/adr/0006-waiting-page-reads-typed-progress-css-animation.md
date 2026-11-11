# ADR-0006 — The waiting page reads a typed progress state; motion is CSS on React-rendered markup

*2026-11-11 · status: accepted*

## Context
Amendment A4 / AC-A9/A10: `/scan/[token]` shows the real steps (understand → choose questions →
asking per AI system with an answer counter → comparing → report), animated in design G, without
fake timers, without motion under `prefers-reduced-motion`, working without JavaScript (it
reloads), with each step change announced (`aria-live`). `public/motion.js` only animates and never
changes markup (CLAUDE.md: a script that touches React-rendered text before hydration makes React
discard the server HTML). The scan runs in another process from the page (queue consumer on
Cloudflare); state crosses through the `scan.progress` event, polled every 2 s today.

## Decision
- `ScanJobState` drops `steps[]` (labels were copy stored in the scan's language) and carries
  `stage`, `profile` (summary), `questions` (`{id, text}`) and `engines`
  (`{engine, received, expected}`), driven only by `runScan`'s progress events (`profile`,
  `questions`, `start` with per-engine totals, `asked`, `escalate`, `phase`). `persistScanState`
  coalesces writes as today. Labels come from the page's copy by stage key.
- The status endpoint returns that state plus `reportUrl`, never the error text. Polling stays at 2 s.
- The page server-renders the current state (so a reload without JavaScript shows real progress)
  and adds `<noscript><meta http-equiv="refresh" content="5"></noscript>` plus a visible
  "Vernieuwen" link inside `<noscript>`. When done, the server redirect to the report applies as today.
- Motion is CSS only, in a stylesheet for this page: a new question or stage row enters with a
  short rise/fade keyframe when React mounts it; the active stage's dot pulses (amber = bezig);
  the counters change as text. `@media (prefers-reduced-motion: reduce)` sets every animation to
  none. No `data-motion` attributes on this page, so `motion.js` never touches it.
- One visually hidden `aria-live="polite"` region holds a single sentence for the current stage
  (with the profile sentence once known); counters are not in a live region (they would chatter).
- Design G rules: one accent blue, status colours only in dots, no emoji, no dark mode. The exact
  visual is Julian's at the design gate; this ADR fixes the data and the mechanism.

## Consequences
**Good:** what the visitor sees is what the scan did; no hydration risk; reduced motion is one rule;
the page and the scanner are built in parallel against one JSON shape.
**Bad:** a state stored before the deploy has no `stage` (shown from the asking step); 2 s polling
means counters move in steps; the question list appears all at once when chosen (the per-item entry
animation staggers by CSS `animation-delay`, which is presentation of real data, not a timer that
fakes state).
**We can no longer:** reuse the stored step labels in other places (they are gone), or show
progress for a scan whose state predates this change in the new form.

## Alternatives rejected
| Option | Why not |
|---|---|
| Server-sent events or WebSockets | Streaming through OpenNext on Workers is not proven in this repo; polling works today on both runtimes |
| Animating with `motion.js` / Web Animations from a script | It does not know React state; the rule is that it never changes markup, and timing it to data would need exactly that |
| Fake progress between polls (timers advancing counters) | AC-A9 forbids fake timers |
| Announcing every counter change | Screen readers would hear a number every two seconds |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
