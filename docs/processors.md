# Processors (baseline P1)

Every vendor that touches personal data. The privacy statement's recipient list must match this table; change both in the same commit. Status of each DPA is what has been *seen*, not assumed. Not legal advice.

| Vendor | Role | What it gets | Region | Transfer basis | DPA |
|---|---|---|---|---|---|
| Supabase | Processor: database, sign-in | Owner email, business facts, reports, events | EU (eu-west-1, Ireland), project `bbynmqvaxpjdnkaasutd` | EU | open: accept in Supabase dashboard (Org → Legal) |
| OpenAI | Processor: asks the questions, extracts claims | Business facts only, never email addresses | US | DPF / SCCs | open |
| Google (Gemini, Places, Business Profile, OAuth) | Processor; OAuth also sign-in | Business facts; for verification the owner's Google account id and their Business Profile locations | US/EU | DPF / SCCs | open |
| Perplexity | Processor: asks the questions | Business facts only | US | SCCs | open |
| Anthropic (Claude) | Processor: asks the questions | Business facts only | US | DPF / SCCs | open |
| SerpAPI | Processor: Google AI answers | Business facts only | US | SCCs | open |
| KvK | Source: business lookup | Business name and place | NL | EU | n/a (public register) |
| Stripe | Independent controller for payments; processor for invoices | Name, email, payment details (Vidalo never sees card or bank numbers) | EU/US | DPF / SCCs | open: Stripe DPA is part of the Services Agreement |
| Resend | Processor: email | Owner email, report links | US | DPF / SCCs | open |
| Twilio | Processor: rings, texts or WhatsApps the ownership code (Verify; WhatsApp goes through Meta as sub-processor) | The business phone number Google lists, the code, call/SMS/WhatsApp logs | US | DPF / SCCs | open: Twilio DPA (Console → Legal) |
| Cloudflare | Processor: hosting of web and worker (Workers, queue), facts pages, DNS, Turnstile | Visitor IPs and request data; everything the database holds, in transit; browser signals (Turnstile, on the free check and sign-in) | Global edge (US company) | DPF / SCCs | open |
| Google Workspace | Processor: the vidalo.io mailbox (hello@, support@) | Whatever people mail us | EU/US | DPF / SCCs | open: part of the Workspace terms |
| WhatsApp (Meta) | Contact channel on /contact | Messages people send us there | EU/US | WhatsApp's own terms | n/a: only if the visitor chooses WhatsApp |
| Sources with an error (sites, directories) | Recipients of correction requests | The business's confirmed facts | NL/EU | n/a | n/a |

Hosting is Cloudflare (decided 13 Oct 2026); Vercel and Fly/Railway were never used. The public list is the privacy statement's "Met wie we gegevens delen" (`copy.legal.privacy`, 26 Oct 2026).
