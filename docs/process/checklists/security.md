# Standing security checklist

The per-feature checklist in `checklists/security.md` is generated from this file **in phase
1, off the architecture**. In phase 4, security verifies against that per-feature list. A P0
in phase 4 that was foreseeable in phase 1 and missing from the list is capped at P1 — unless
it is a live exploit. See `../SEVERITY.md`. The platform-level standard (Control Room rows
S1–S12) is `_OS/playbook/SECURITY.md`; this list is what a feature review checks on top of it.

## Authorisation
- [ ] Every read and every write is authorised **at the data layer**, not only in the UI
- [ ] Authorisation is by membership, never by ownership. The ownership bug has shipped inside A101 once already
- [ ] Every policy has a test that fails when the policy is removed. A policy test that has never gone red proves nothing
- [ ] Identity is re-established inside every test transaction — a test that silently runs as an anonymous user looks exactly like a failing policy
- [ ] Every guard that keys on **who the caller is** allow-lists the privileged identity and denies everything else. `if caller <> 'the_web_role' then allow` fails open the moment the name changes; `if caller = 'the_owner' then allow` fails closed. A connection pooler can change the name the database sees, so check the session identity through the real pooler, not only locally
- [ ] …and that allow-list must not match the platform's **default** connection identity (the copy-paste pooler username). Assert the deployed session identity in the runbook, by name, and fail the step on anything else

## Money and integrity
- [ ] Nothing that grants value can be written by a client. Confirmation comes from the payment provider's webhook and nowhere else
- [ ] Webhook signatures verified against the correct secret, for every endpoint scope in use
- [ ] Scarce capacity is enforced under a row lock inside one transaction. Prove it with a concurrency test that oversells when the lock is removed
- [ ] Amounts are integers in minor units, computed server-side, never taken from the client
- [ ] Rates and commissions are snapshotted onto the record, never recomputed from current config

## Secrets and surface
- [ ] No secret in the bundle, the repo, a log, or an error message. Grep the built artifact before believing it
- [ ] Server-only keys never leave the server; the client gets publishable keys only
- [ ] Every third-party call has a timeout and a failure path that does not leave a half-finished transaction
- [ ] No literal control, bidi or zero-width character in any source, config or doc file — escapes only. CI fails the build on any such byte (`grep -rP '[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x{200b}-\x{200f}\x{202a}-\x{202e}\x{2066}-\x{2069}\x{feff}]'`)
- [ ] Input validated at the boundary against an explicit schema; output encoded for its context
- [ ] Rate limits on anything that sends mail, costs money, or calls a model
- [ ] Any AI call is capped by a counter that lives in the database and fails closed
- [ ] A limiter, quota or breaker whose **binding or backend is absent** fails **closed**, and says so in a log. A `if (!limiter) return allow` branch written for local dev must be gated on the environment, or the control silently disappears on the deploy where it matters
- [ ] Anything configured through a platform key that the tooling accepts silently — an unknown field, an `unsafe` block, a binding that may or may not be provisioned — has a **CI assertion that it is present**. The failure mode of a mis-keyed binding is silence, so something has to listen for it
- [ ] Every unauthenticated endpoint that opens a **database connection** is counted against the connection pool, not just against a per-client rate limit. N sources × the per-source limit is the real number. Health and status endpoints are the usual offender — cache them, or do not let them touch the database. "Unauthenticated" includes every endpoint whose only gates are an `Origin` header and a cookie: a non-browser client sets both in one `curl`. Fix the whole class, not the one endpoint the finding named
- [ ] A queue or outbox with an **attempts ceiling** and a **stale-claim reclaim** excludes rows at the ceiling from the reclaim, and retires them. Otherwise one row that keeps being reclaimed violates the ceiling, the batch statement throws, and the queue stops for ever — silently. Re-verify a *permanent* failure with each step in its own committed transaction: a reproduction wrapped in one transaction rolls its own poison back when the error fires, and then reports a still-broken system as healthy
- [ ] Retiring a codebase **rotates its credentials at the moment of retirement**. Git history is readable for ever, and an archive tag is not deletion. This includes keys that are "public by design" (anon/publishable): they are only as safe as the row-level policies behind them, and nobody maintains those after a retirement
- [ ] A build that bundles or uploads local files named in content (Markdown, config, queue files) resolves each path with `realpath` and confines it to its intended folder; a bare `os.path.join(root, ref)` follows absolute paths, `../` and symlinks to anything on the disk (Control Room Marketing tab, 6 Nov 2026: a quoted invoice path would have been published)
- [ ] Generated pages: the page script is syntax-checked (`node --check`) after every build; JavaScript kept inside a non-raw Python string loses its `\\` escapes (`\'`, `\n`) silently

## Static sites, the edge and DNS (from 001 company-site, 2026-11-06)
- [ ] The **production** response is the built artifact: page bodies hash-equal to `dist/`, and the cookie, storage, third-party-request and console tests run against production as well as the preview. Zone features (Bot Fight / bot management `__cf_bm`, Email Address Obfuscation, Rocket Loader, JS detections, Web Analytics auto-inject, Zaraz) change production only, so a preview-only test passes while production breaks the privacy statement or the CSP
- [ ] HSTS has one source. Read the zone's edge HSTS setting before writing a `Strict-Transport-Security` header in `_headers`; the edge may already send `includeSubDomains` for the whole zone
- [ ] A DNS cut-over baselines **every** mail record before the change (MX, every apex TXT, `_dmarc`, every `*._domainkey`, which may be CNAMEs, the record type a web cut-over deletes) and keeps a dashboard zone export for rollback; DoH cannot show a proxied record's origin
- [ ] DNS and live-HTTP checks go through DoH or `curl --resolve`, never the local resolver: an ISP "safe browsing" sinkhole can answer for the domain (Odido did for a101.io)
- [ ] Vendored third-party JS is pinned by sha256, the hash is shown equal to the file in the upstream package tarball, and a test asserts it
- [ ] A build that imports from a sibling repo outside version control records that repo's commit and a clean tree for the imported paths at deploy time
- [ ] Static hosting redirects (trailing-slash handling, host redirects) are probed for open redirects: `//evil.example/`, `/%2Fevil.example/`, `/%5Cevil.example/` never yield a `Location` off-site

- [ ] Any proof of payment that grants access (a Checkout session id, a receipt link) is checked server-side for *this* resource, and a second purchase of an already-paid resource is refused unless the signed-in owner makes it — otherwise a stranger buys fresh proof (Vidalo SEC-01, 6 Nov 2026)
- [ ] A URL parameter that grants anything never reaches analytics: GA4 and the Meta pixel send the full URL after consent, so strip it from the address bar before they load
- [ ] A mock or dev fallback that skips a check is gated on mock mode, never on "the key is missing"

## Out of lane
Code style, architecture taste, and library preference. Security files P0s and P1s with an
exploit path, not opinions about structure.

## Learned (Vidalo, 11 Nov 2026)
- Every regex run on AI answer text, or on values extracted from it, gets a length cap before matching and a timing test on a long hostile input; no `\s*` or `.*` next to a repeated group under the `m` flag.
- A public page reachable by a guessable key (slug, name + town) shows nothing beyond what that key's owner chose to publish; private data only behind an unguessable id or the owner's session.
