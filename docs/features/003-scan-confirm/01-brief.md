# 003 — Free check starts only after the e-mail is confirmed

## Request (Julian, 11 Nov 2026, verbatim)
> Hoe voorkomen we nu dat bots of kwaadaardige agents duizenden scans kunnen uitvoeren.
> Laten we voor nu wel de mailbevestiging invoeren, en zet erbij dat we het doen om te voorkomen dat kwaadaardige bots toegang krijgen.
> en bouw 1-3

Points 1–3 from the analysis: (1) count IPv6 visitors per /64, (2) check the free-check caps before the Places lookup, (3) an edge rate limit in Cloudflare (a dashboard setting, handed to Julian).

## Acceptance criteria
- AC-1 A free-check post from a visitor who is not signed in never starts engine calls; it stores a pending request and queues one confirmation mail to the given address.
- AC-2 The mail link opens a page that starts nothing; only its button (POST) starts the check, through the same daily cap and per-visitor allowance as before.
- AC-3 A link works once and for 24 hours; a second press goes where the first went; an unknown, malformed or expired link starts nothing and says so.
- AC-4 The address never appears in a URL; only a hash of the link secret is stored.
- AC-5 Confirmation mails are capped per address (3/day), per connection (5/day, IPv6 per /64) and site-wide (4 × FREE_SCANS_PER_DAY per 24 h) while engines are real.
- AC-6 The reason ("kwaadaardige bots buiten de deur houden") is stated in the mail, on /scan/mail and /scan/bevestigen, and in the privacy statement, NL and EN.
- AC-7 IPv6 addresses in the same /64 share one allowance; IPv4 counting is unchanged.
- AC-8 The daily cap and the per-visitor allowance are checked before the Places lookup on POST /api/scan.
- AC-9 The Cloudflare rate-limit rule is written down for Julian with exact values (go-live X9).
- AC-10 typecheck, unit tests, e2e:mock and the Playwright mock suite stay green.
