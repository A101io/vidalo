# Records of processing (GDPR art. 30, baseline P2)

Controller: A101 B.V. (trading as Vidalo), Factorij 80, 3071 AV Rotterdam, KvK 42057858. Contact: hello@vidalo.io. Not legal advice; retention periods marked *(counsel)* are not fixed until counsel says so.

| Activity | Purpose | Data subjects | Data categories | Legal basis | Recipients | Retention | Security |
|---|---|---|---|---|---|---|---|
| Free check | Show a business what AI assistants say about it | Business owners (only when the business carries a person's name); the requester | Business name, place, public facts; requester email if they ask for the report | Legitimate interest | Supabase, OpenAI, Google, Perplexity, SerpAPI | Report link 30 days; data *(counsel)* | RLS on every table; reports by unguessable id |
| Reminder emails after a free check | Follow-up at 7 and 21 days | Requester | Email, business name | Legitimate interest; one-click unsubscribe (RFC 8058) | Resend | Until unsubscribe or 21 days | Signed unsubscribe tokens |
| Account and sign-in | Let the owner manage their business | Owner | Email, Supabase user id | Contract | Supabase | While customer, then *(counsel)* | Supabase Auth; RLS by owner_user_id |
| Ownership verification | Prove the signed-in person manages the Google Business Profile | Owner | Google account id, Business Profile location ids | Contract | Google | Verification timestamp kept; tokens not stored | OAuth state cookie, server-side check |
| Paid service | Publish facts, sync directories, fix sources, monthly checks | Owner; business | Confirmed facts, findings, fix evidence | Contract | Supabase, Cloudflare, directories, AI providers | While customer + 90 days, then invoice data only | RLS; service role server-side only |
| Billing | Take payment, invoice | Owner | Name, email, Stripe customer id | Contract; legal obligation (invoices 7 years) | Stripe | Invoices 7 years (NL tax law) | Webhook signature verified, idempotent |
