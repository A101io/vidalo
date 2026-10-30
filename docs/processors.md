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
| Cloudflare | Processor: facts pages, DNS | Visitor IPs of facts pages | Global edge | DPF / SCCs | open |
| Vercel (planned, web) | Processor: hosting | Visitor IPs, request logs | EU region selectable | DPF / SCCs | open: **not yet in the privacy statement** |
| Fly.io or Railway (planned, worker) | Processor: background jobs | Everything the database holds, in transit | EU region selectable | SCCs | open: **not yet in the privacy statement** |

Open: hosting is not chosen yet; once it is, add it to `copy.legal.privacy` and here.
