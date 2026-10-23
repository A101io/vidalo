# Mail lab

Every e-mail Vidalo sends, produced by the real code paths, checked, and laid out on one page.
Built 23 Oct 2026.

## 1. Read and check every mail (no keys, nothing leaves the machine)

```
pnpm mail:lab
open out/mail-lab/index.html
```

Two journeys run in mock mode:
- **Free check only**: the report mail, then the day-7 and day-21 follow-ups.
- **Paying, verified owner**: welcome, the own-website check (against a fake site that blocks every robot), directory corrections, fixes, rechecks one, two and four weeks later (owner reminders), the monthly report, and the resolved and unfixable notices.

The correction request to a source and its follow-up are not reached in mock mode, because the mock answers cite no third-party site with a contact address. They are rendered from their templates with the journey's real finding, and the page marks them "template only".

The page shows one card per kind: recipient, sender, subject, the HTML and the plain text side by side, and every link. Each mail is checked:

| Check | Fails the run |
|---|---|
| Every one of the 13 kinds is produced | yes |
| Owner mail goes to the owner, third-party mail never does | yes |
| No `undefined`, `NaN`, `[object Object]`, `{{ }}` in subject or body | yes |
| Every link to our own site points to a page or route that exists in `apps/web/app` | yes |
| Commercial mail (follow-ups) carries `List-Unsubscribe` | yes |
| The same mail to the same third party more than once | no, a warning |

CI runs `pnpm mail:lab` in the `check` job, so a broken template fails the PR.

The `.eml` files are in `out/mail-lab/mail/`. They carry the mail's tags as `X-Vidalo-type` / `X-Vidalo-kind` headers. Only the mock files have these headers; Resend gets the tags as tags.

## 2. Real delivery to your own inbox (once Resend is live)

Needs `RESEND_API_KEY` and a verified sending domain for `EMAIL_FROM` (default `controle@vidalo.io`; `docs/mail.md`, `docs/setup/stripe-and-resend.md`). Both can come from the environment or the root `.env`.

```
pnpm mail:lab
pnpm mail:send --to you@example.com            # dry run: lists the 13 mails
pnpm mail:send --to you@example.com --send     # sends one of each kind
pnpm mail:send --to you@example.com --send --kinds welcome,baseline
```

- Every mail goes to `--to` only. The owner and third-party addresses from the lab are replaced, so no directory or website ever receives a test.
- The subject starts with `[Test <kind>]`. The original recipient is in the `X-Vidalo-Original-To` header.
- It goes through `sendMail`, the production path, so From, Reply-To and `List-Unsubscribe` are what a customer gets.
- Check in the inbox: it landed in the inbox, not spam; the sender name and address; the HTML in Gmail and Apple Mail, light and dark; the links open the right page on vidalo.io; the unsubscribe link works.

## 3. The sign-in link (Supabase)

Supabase sends the magic link itself, so the lab cannot capture it. Its wording lives in the Supabase dashboard (Authentication → Emails), not in this repo. Test it by hand once custom SMTP through Resend is set (go-live A2):
1. On vidalo.io, sign in at `/inloggen` with your own address.
2. Check that the mail arrives from `inloggen@vidalo.io`, in the inbox, with a link that signs you in and lands on `/app`.
3. Do the same at `/en/login`.

The template is the same in both languages today.

## Known findings (23 Oct 2026)

- **Directories get the same correction mail again and again.** Every sync sends a correction mail to every directory whose details differ, with no memory of an identical mail already sent. Sync runs at setup, after publishing, after rechecks and from the cron. One lab run sends the identical mail 14 to 46 times to one directory. The lab shows this as a warning.
- **All mails are Dutch**, also for an owner who chose English (CLAUDE.md, language preference).
