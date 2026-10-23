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
sets RedirectTo to `<site>/auth/confirm?next=<path>`, so the link shows our own address
and `/auth/confirm` verifies it (`apps/web/lib/auth-confirm.ts`). Unlike Supabase's
default link, this works in any browser and an older link stays valid after a newer one
is sent (until it is used or an hour passes).

## 3. Allowed links (URL Configuration)

https://supabase.com/dashboard/project/bbynmqvaxpjdnkaasutd/auth/url-configuration

| Field | Value |
|---|---|
| Site URL | `https://vidalo.io` |
| Redirect URLs | `https://vidalo.io/**`, `https://vidalo-web-staging.julian-devriend.workers.dev/**`, `https://vidalo-web-preview.julian-devriend.workers.dev/**`, `http://localhost:3000/**` |

**Required for the template:** when a RedirectTo is not on this list, Supabase replaces
it with the bare Site URL, and the template's link becomes `https://vidalo.io&token_hash=...`,
which is broken. Every host that sends sign-in links must be listed.

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
