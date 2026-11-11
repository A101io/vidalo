# ChatGPT Business Hub as a channel (spec, not built)

Status: proposal of 11 November 2026. Nothing in this file is implemented. The only shipped part is the FAQ answer in `copy.landing.vragen` (NL and EN).

Source: OpenAI Help Center, "Setting up your business on ChatGPT", read 11 November 2026.
https://help.openai.com/en/articles/20001635-setting-up-your-business-on-chatgpt

## What OpenAI offers (as read on 11 Nov 2026)

| | |
|---|---|
| Claim | Search the business in Business Hub, verify by business phone (SMS or call), business e-mail, a DNS TXT record or Shopify. OpenAI reviews and mails its decision. |
| Identity | Persona check (government ID, business registration, proof of authority) before anything can be published, before insights, and for the blue check. |
| Editable | Website, description, product or service category, logo, cover photo, delivery policy, return policy, "other optional details". A product feed (CSV or Shopify) for prices and availability. |
| Not listed as editable | Opening hours, phone, address, service area. |
| Insights | Mentions, website clicks, discovery topics, 28 days, aggregate. No prompts, no competitors, nothing on whether an answer was right. Blank can mean "below threshold". |
| Where | Online businesses: where ChatGPT is available and verification is supported. Local stores and restaurants: only an existing U.S. listing. Business agents: U.S. ecommerce and online services only. |
| Limits OpenAI states itself | Changes are reviewed and take time; "ChatGPT may also use other sources"; claiming does not guarantee more visibility. |
| Access for others | The claiming admin can add teammates and grant an agency access. No central management of several brands or locations. No API is described. |

## What this changes for Vidalo

- For one of the five AI systems there is now a place where the owner states facts directly. That is a new fix path, the same kind as the Google Business Profile.
- It does not check answers. Whether ChatGPT then says the right thing stays unmeasured by OpenAI; that is what our samples and rechecks do.
- For a Dutch local business nothing changes today: it cannot claim.

## Stages

**0. Now (shipped with this PR).** FAQ answer with the dated facts. The article is re-read when it changes; the answer carries its own date and `docs/content-check.md` names the source.

**1. When a Dutch local business can claim: guided claim.** The trigger is the article dropping the U.S.-only line, or a Dutch listing being claimable in Business Hub.
- New `ChannelType` `chatgpt`, name "ChatGPT", `status: "manual"` until the owner says it is claimed. No adapter can write to it, so `syncChannel` returns the owner's instruction, as it does for other owner-only channels.
- `/app/vermeldingen/[id]` for this channel shows the steps in order, with the link to Business Hub and, per field, the value from the confirmed facts to paste (website, description, category). The DNS TXT method is the one we recommend: the owner already added one DNS record for the facts page.
- "Ik heb dit aangepast" works as on a finding: it stores the owner's statement with the date and queues a recheck of the ChatGPT cells only (5 then 10 samples, the existing sequential sampling). The log line links the before and after samples as proof.
- We never ask for the owner's ChatGPT password and never do the Persona step for them: it is their identity.

**2. Agency access.** If OpenAI's agency access works for a company like ours without a managed contract, Vidalo is added as agency on the owner's profile. A facts change then produces a diff that is held until the owner approves it (`meta.pendingDiff` / `meta.diffApproval`, the same rule as the Google Business Profile), and an operator applies it by hand in Business Hub. Evidence is a screenshot plus the recheck.

**3. An API, if OpenAI publishes one.** The operator step becomes an adapter in `publisher/channels/`. Nothing else changes.

## Field mapping (stage 1 and later)

| Business Hub field | From |
|---|---|
| Website | `Facts.website` |
| Description | new owner-confirmed text; until then the facts page's opening sentence |
| Category | `Facts.kind`, else the sector pack's name |
| Logo, cover photo | owner uploads in Business Hub; we do not store images |
| Delivery and return policy | `Facts.policies` where the owner entered them |
| Hours, phone, address | no field at OpenAI yet; these keep coming from the facts page, Google, Bing, Apple and the directories |

## Insights

We do not ingest them and do not compete with them. In the owner's report, "how often am I named by ChatGPT" may point to the owner's own Business Hub insights once they have them; our numbers stay what they are: counts of right, wrong and not-found answers out of the samples we asked.

## Not doing

- Product feeds and business agents: ecommerce, U.S. only, not our customer.
- Claiming on the owner's behalf, in any form.
- Any promise in copy that we "set up ChatGPT for you" before stage 1 exists.

## Decisions for Julian

1. Build stage 1 only when the Dutch trigger fires (suggested), or build it now for the businesses abroad that can already claim (online businesses only)?
2. Ask OpenAI whether agency access is open to Vidalo (suggested: yes, one mail from hello@vidalo.io once stage 1 is live).
