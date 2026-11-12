# Sign-in e-mail (Supabase Auth)

The magic-link e-mail is sent by Supabase, not by our code. Three settings in the
Supabase dashboard make it Vidalo's: the sender, the template, and the allowed links.
Project `bbynmqvaxpjdnkaasutd`. Written 22 Oct 2026, after the first real test
arrived as a Supabase-branded English mail with a `*.supabase.co` link.

## 1. Sender (Custom SMTP through Resend)

https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/smtp

| Field | Value |
|---|---|
| Enable Custom SMTP | on |
| Sender email | `inloggen@vidalo.io` |
| Sender name | `Vidalo` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | a Resend API key with **sending** access for `vidalo.io` |
| Minimum interval between e-mails | 60 seconds (default) |

`vidalo.io` must show "Verified" in Resend first (https://resend.com/domains; DNS records
`resend._domainkey` and `send` are on Cloudflare since Oct 2026). Without custom SMTP,
Supabase sends at most a few mails per hour, from its own address.

## 2. Template

https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/templates

Paste `sign-in.html` into **both** "Magic Link" and "Confirm signup" (a first sign-in
of a new address uses "Confirm signup").

| Field | Value |
|---|---|
| Subject (both) | `Je inloglink voor Vidalo · Your Vidalo sign-in link` |
| Body (both) | the whole of `sign-in.html` |

The button links to `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`. The app
sets RedirectTo to `<site>/auth/confirm?next=<path>`, so the link shows our own address.
Since feature 002 (12 Nov 2026, ADR-0003) `/auth/confirm` is a page with one button: opening
the link uses nothing up (a mail filter that opens links cannot spend it), and the button's
POST (`app/auth/confirm/actions.ts`) verifies it and records the sign-in. Unlike Supabase's
default link, this works in any browser and an older link stays valid after a newer one
is sent (until it is used or an hour passes).

## 3. Allowed links (URL Configuration)

https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/url-configuration

| Field | Value |
|---|---|
| Site URL | `https://vidalo.ai` |
| Redirect URLs | `https://vidalo.ai/**`, `https://www.vidalo.ai/**`, `https://vidalo.io/**`, `https://vidalo-web-staging.julian-devriend.workers.dev/**`, `https://vidalo-web-preview.julian-devriend.workers.dev/**`, `http://localhost:3000/**` |

**Required for the template:** when a RedirectTo is not on this list, Supabase replaces
it with the bare Site URL, and the template's link becomes `https://vidalo.ai&token_hash=...`,
which is broken. Every host that sends sign-in links must be listed.

## 4. Change of address, sessions, limits (feature 002, D1)

These are the dashboard values `docs/features/002-mijn-omgeving/02-architecture.md` (D1) asks for.
The app enforces the session lifetime and the link limit itself; these settings add Supabase's
own layer. Project ref `bbynmqvaxpjdnkaasutd` (Sitty and Sonable sit in the same organisation).

| Page | Field | Value |
|---|---|---|
| https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/templates | Change Email Address, the button's link | `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email_change` |
| https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/providers | Email → Secure email change | `on` |
| https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/sessions | Detect and revoke potentially compromised refresh tokens | `on` |
| same page | Refresh token reuse interval | `10` |
| same page, only on the Pro plan | Time-box user sessions | `2160` (hours = 90 days) |
| same page, only on the Pro plan | Inactivity timeout | `720` (hours = 30 days) |
| https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/settings/jwt | Access token expiry time | `3600` |
| https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/rate-limits | Rate limit for sending emails | `30` per hour |

What the app does on top (no setting): a sign-in ends after 30 days without use or 90 days after
signing in (`auth_session`, `core/shared/session-life.ts`); "Overal uitloggen" ends every sign-in
of the login; a sign-in link is limited to 5 per address and 20 per IP address per hour
(`auth_throttle`, `core/shared/auth-throttle.ts`), which needs the secret `VIDALO_AUTH_SECRET` on
`vidalo-web` (production and staging): the output of `openssl rand -hex 32`, set with
`wrangler secret put VIDALO_AUTH_SECRET`. Without it, sign-in links are refused once Supabase is
configured.

## Apply from the command line

Steps 2 and 3 can be applied in one go, after `supabase login` (the CLI keeps its token in
the keychain):

```bash
node scripts/supabase-auth-config.mjs          # apply, then print each setting with ✓ or ✗
node scripts/supabase-auth-config.mjs --check  # read back only
```

It never touches step 1 (the SMTP sender and the Resend key).

## Check

Request a link on `/inloggen`, then confirm: sender "Vidalo <inloggen@vidalo.io>", Dutch
and English text, the button's address starts with the site's own host and
`/auth/confirm`, and clicking it lands signed in (`/app`, or "geen bedrijf" for an
address without a business).
