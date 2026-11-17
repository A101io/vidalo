# Verification — 003 ACM rules on the site

*delivery-lead · merges the lane reviews in `reviews/`. Severity rules as in `findings.md`.*

## Round 1 — 2026-11-17 (unattended verify run, 03:30 stand-in)

**Verdict: SHIP.**

Branch `claude/build-2026-11-16-003-acm-site-rules` at `ead862e` (reviewed), PR #136; `main` (`e808eec`) is contained in the branch.

### Why
- No open P0. The two P0-if-observed cases were tried on a real route (Postgres, mock off, no Stripe key) and were refused: F-009 → `?betaling=fout`, `checkout.refused {reason:"no_stripe"}`, no status change, no job; F-020 → `/app/abonnement`, `checkout.refused {reason:"addon_without_scan"}`.
- No new P1. The open P1s in `findings.md` (F-004, F-006, F-021) are Julian's items (J-3, J-2, J-4): release gates, not merge blockers.
- Every acceptance criterion a run may build (brief §(a)) is met with observed evidence. AC-4 and AC-16 are Julian's (J-1, J-6).

### Gate (observed)
typecheck 0 errors · core 1518 passed / 23 skipped (107 files) · worker 52 passed · `e2e:mock` OK · `mail:lab` 86 mails, 36/36 kinds, `order_confirmation nl 2 en 1`, OK · Playwright company-details + forms 19 passed, gate mode 3 passed, a11y 11 + 1 flake that passed alone.

### Lane results
| Lane | Review | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|
| qa | `reviews/qa-r1.md` | 0 | 0 | 0 | 3 (F-024, F-025, F-026) |
| security | `reviews/security-r1.md` | 0 | 0 | 2 (F-022 confirmed, F-023) | 1 (F-027) |
| compliance | `reviews/compliance-r1.md` | 0 | 0 | 1 (F-023, shared) | 1 (F-024, shared) |

Built findings verified in this round: F-001 (COMP-09), F-002 (COMP-21), F-003 (COMP-15), F-005, F-009 (observed), F-010, F-012, F-017, F-018, F-019 (for now), F-020 (observed).

### Not fixed tonight, and why
All new findings are P2/P3 and none blocks the merge. F-024 changes a customer-facing string and this run may not change copy; the rest are follow-ups (one small PR after the merge: F-022, F-023, F-024, F-025, F-027).

### Release gates (Julian; not findings)
J-1 complaints article + `legal:lock` · J-2 terms price clause · J-3 day-7/21 lawful basis (launch HARD STOP if counsel says consent) · J-4 trade name on the KvK extract (launch HARD STOP if not registered) · J-5 "Geen verborgen kosten" · J-6 test order per plan · J-7 clean-browser check on vidalo.ai · J-8 deploy · J-9 KvK field · J-10 Scan + Monthly sentence. Recorded in `docs/go-live-checklist.md` row L3.
