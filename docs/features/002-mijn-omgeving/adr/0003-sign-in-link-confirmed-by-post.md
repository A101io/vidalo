# ADR-0003 — The sign-in link opens a page; the session starts on its POST

*2026-11-11 · status: accepted*

## Context
`/auth/confirm` (`lib/auth-confirm.ts`) calls `verifyOtp` on the GET of the mail link.
Mail filters that open links (Outlook Safe Links and similar) can use the single-use link
before the owner clicks (inferred, S5). Julian accepted one extra click (Q5). `next` checks
are inline in three places and miss encoded forms (AC-4c). Route handlers have no Origin
check (S7); server actions do.

## Decision
- `GET /auth/confirm` becomes a page with one button; its form posts the link's
  `token_hash`, `type`, `code` and `next` to the server action `confirmSignInAction`, which
  calls `verifyOtp` / `exchangeCodeForSession`, records the sign-in (ADR-0002) and redirects
  to `safeNext(next)`. The page is `noindex`, `no-store`, `Referrer-Policy: no-referrer`,
  loads no third-party resource, and renders in English when `next` starts with `/en`.
- `GET /auth/callback` answers 303 to `/auth/confirm` with the same query (older links and
  the address-change link).
- The Supabase mail template does not change: it links to `RedirectTo`, which stays
  `/auth/confirm?next=…`.
- `safeNext` lives in one module (`core/shared/safe-next.ts`): decode up to three times,
  refuse backslashes, control characters and a leading `//`, require that resolving the
  result against a fixed base keeps that base's origin, and check the normalised pathname
  again for a leading `//` or `/\` (`/.//evil.example` normalises to `//evil.example`, F-023).
- Route handlers that change state call `refuseCrossSite(req, baseUrl)`
  (`core/shared/same-origin.ts`) first.

## Consequences
**Good:** a GET uses nothing up; the session-starting request carries Next's Origin check;
every redirect target passes one function with one test table.
**Bad:** one more click and page load per sign-in (watched by the brief's first metric); a
link opened on a phone mail preview still needs the owner to tap the button.
**We can no longer:** sign someone in from a link alone, for example in an e-mail client that
renders the page but does not submit forms.

## Alternatives rejected
| Option | Why not |
|---|---|
| Keep GET verification, detect scanners by user agent or timing | Scanners imitate browsers; a false negative is a used link and a confused owner |
| A six-digit code to type instead of a link | More friction than a click; needs a second template and input page |
| Auto-submit the form with JavaScript | A scanner that runs JavaScript uses the link again |

## How to challenge this
New evidence only, and the challenge becomes a new ADR that supersedes this one. This file is
then marked superseded and kept. See `_OS/playbook/PIPELINE.md` rule 6.
