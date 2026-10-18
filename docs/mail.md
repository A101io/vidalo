# Mail for vidalo.io — Google Workspace, the Sonable way

Written 18 Oct 2026. Mirrors `A101/_OS/SONABLE.md` (Communication channels) and
`A101/_OS/DNS_AND_MAIL_CHANGES.md`. Nothing here is done yet; the DNS zone is on
Cloudflare (`5d39e2dacc81b8603d5dc69a163b6bca`) and has no mail records at all.
Verify with `bash scripts/verify-mail-dns.sh` after each step.

## The addresses

Same shape as Sonable: one licensed user (`julian.devriend@a101.io`), everything else an
alias on that user. No second licence.

| Address | Role | Sonable twin |
|---|---|---|
| `support@vidalo.io` | **Customer-facing support.** Where the product sends people when something goes wrong: the assistant's fallback and errors, checkout failures, a broken unsubscribe link, Google connect help, the "Support" footer link, security.txt. Customer-initiated only; never an outbound cold sender. | `support@sonable.io` |
| `hello@vidalo.io` | **General contact.** The footer "Contact" link, the legal pages' "Vragen?", the coming-soon page, llms.txt, the Organization markup, Vidalo's own facts record, the assistant's knowledge. Was `hallo@` until 19 Oct 2026. | — |
| `julian@vidalo.io` | **Outbound sending identity.** From and Reply-To for outreach; the address Julian replies from. Needs the alias *and* "Send mail as", or replies go out as a101.io and the thread changes identity halfway. | `julian@sonable.io` |
| `controle@vidalo.io` | Resend sender for reports and notifications (`EMAIL_FROM`, `packages/core/src/reporter/mail.ts`). Alias so that replies land instead of bouncing. | — |
| `inloggen@vidalo.io` | Resend/Supabase SMTP sender for magic links (`docs/setup/stripe-and-resend.md`). Alias for the same reason. | — |

DMARC reports go to `julian@vidalo.io`, filtered to a label. Not a `dmarc@` alias:
Sonable's drifted to one and the reports sit unread (LEARNINGS C-14).

## Steps, in order

Each step is one screen. Do them top to bottom; 3 and 5 wait on DNS propagation.

### 1. Add the domain to Workspace
admin.google.com → Account → Domains → Manage domains → **Add a domain** →
`vidalo.io` → **Secondary domain** (not "user alias domain": that would mirror every
a101.io address onto vidalo.io). Google shows a `google-site-verification=…` value.

### 2. Verify it on Cloudflare
dash.cloudflare.com → vidalo.io → DNS → Records → Add:

| Type | Name | Content | Proxy |
|---|---|---|---|
| TXT | `@` | `google-site-verification=<the value from step 1>` | DNS only |

Back in the admin console → **Verify**.

### 3. Mail records on Cloudflare
Add these four. All "DNS only" (Cloudflare cannot proxy MX or TXT anyway).

| Type | Name | Content | Priority |
|---|---|---|---|
| MX | `@` | `smtp.google.com` | 1 |
| TXT | `@` | `v=spf1 include:_spf.google.com ~all` | |
| TXT | `_dmarc` | `v=DMARC1; p=none; pct=100; rua=mailto:julian@vidalo.io; fo=1` | |

Google's single `smtp.google.com` record is what it hands out for new domains; the five
`aspmx.l.google.com` records on a101.io and sonable.io are the older equivalent. Do not add
`amazonses.com` to the root SPF: Resend bounces via `send.vidalo.io`, which gets its own SPF
when the Resend domain is verified (`docs/setup/stripe-and-resend.md`). After a few weeks of
clean reports, change `p=none` to `p=quarantine`, as planned for Sonable.

Then admin.google.com → Apps → Google Workspace → Gmail → **Set up MX / Activate Gmail**
for `vidalo.io`.

### 4. DKIM
admin.google.com → Apps → Google Workspace → Gmail → **Authenticate email** → select
`vidalo.io` → **Generate new record**, key length 2048. Add on Cloudflare:

| Type | Name | Content |
|---|---|---|
| TXT | `google._domainkey` | `v=DKIM1; k=rsa; p=…` (the long value) |

Wait until `dig TXT google._domainkey.vidalo.io` answers, then **Start authentication**.

### 5. Aliases on Julian's user
admin.google.com → Directory → Users → Julian de Vriend → User information →
**Alternate email addresses** → add, one per line:

```
support@vidalo.io
hello@vidalo.io
julian@vidalo.io
controle@vidalo.io
inloggen@vidalo.io
```

Save. Mail to all five now lands in the a101.io inbox.

### 6. Send mail as (Gmail, not the admin console)
Gmail → Settings → See all settings → Accounts → **Send mail as** → Add another email
address, three times:

| Name | Address | Treat as alias |
|---|---|---|
| Vidalo | `support@vidalo.io` | yes |
| Vidalo | `hello@vidalo.io` | yes |
| Julian de Vriend | `julian@vidalo.io` | yes |

Same screen: "When replying to a message" → **Reply from the same address the message
was sent to**. Sonable's note applies word for word: without this, a reply to a vidalo.io
thread goes out as a101.io.

### 7. Filter
Gmail → Settings → Filters → Create: `to:(@vidalo.io)` → apply label **Vidalo**, never send
to spam. Second filter: `to:julian@vidalo.io subject:"Report domain"` → label
**Vidalo/DMARC**, skip inbox.

### 8. Prove it (with a control)
1. From an outside address (not Workspace), mail `support@vidalo.io` and `hello@vidalo.io`.
   Both must land under the Vidalo label.
2. Reply to each. The outside inbox must show the address you mailed as sender, not a101.io.
3. Control: mail `definitely-not-a-mailbox-xyz9@vidalo.io`. It must **bounce**. If it is
   accepted, step 5 is wrong (catch-all) and the aliases prove nothing (LEARNINGS 2026-08-16).
4. `bash scripts/verify-mail-dns.sh` is all green.

Then flip `SETUP_STATUS.md` G1 to done and record the date in `A101/_OS/VIDALO.md`.

## What this does not cover
- Resend (`send.vidalo.io`, `resend._domainkey`): `docs/setup/stripe-and-resend.md`.
  Resend signs `d=vidalo.io`, so it aligns strictly, same as Sonable.
- Supabase custom SMTP for `inloggen@vidalo.io`: go-live A2, after Resend.
- An auto-reply on `support@`: Sonable has one (`sonable/docs/support-autoreply.md`); decide
  after the first real support mail, not before.
