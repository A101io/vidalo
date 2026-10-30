# Hawk Academy "Claude SEO Skills": marketing review and what to take from it

Reviewed 18 Oct 2026 for Sonable, Vidalo and Sitty. Source: hawkacademy.co/claude-seo-skills plus
six subpages (ai-visibility, entity-seo-auditor, local-seo-audit, ai-citation-monitor, the
8-step audit guide, seo-tools). Hawk Academy is the free education arm of StudioHawk, a
120-person SEO agency in Australia.

## 1. What they are doing, and why it works

**The funnel is a library.** 56 skills (plain `.md` system prompts) and 37 browser tools, each on
its own landing page, each free, none gated. The chain is: skill or tool → guide that strings
skills into an 8-step workflow → free course enrolment (22,000+ learners claimed) → paid agency
audit. Email is only asked for on one toolkit download. They say why themselves: "the skills bring
practitioners to the library. Some eventually become workshop attendees or agency clients."

**Every page is the same template**, which is what makes 93 of them possible: label (Free Claude
Skill), title, one-sentence promise, two CTAs (Copy the prompt, Download), three install routes
(curl one-liner, Claude Code folder, paste into ChatGPT/Gemini), the full prompt visible in a code
block, "What it checks" in six blocks, a named author with credentials, BreadcrumbList schema.

**Transparency as proof.** The whole method is on the page. Giving the recipe away says "we know
what we are doing" louder than a testimonial, and it costs nothing because the buyer of an agency
audit was never going to run 56 prompts by hand.

**Riding a platform wave.** Anthropic announced Skills; within weeks they own the query cluster
"Claude SEO skills / Claude SEO checker / Claude SEO tool". Each FAQ answer is written for one of
those queries. Programmatic keyword capture of a new vocabulary before anyone else writes in it.

**A named framework.** SOURC-E (Structure, Offsite, Uniqueness, Relevance, Credibility,
Evaluation) with a formula, a book ("Be the SOURCE"), and a filter on the library. A proprietary
name turns a list of tactics into something you can be known for.

**Honesty baked into the tools.** "Says plainly what review schema will not do." "Flags for
review, never accuses." "Do not invent AI responses; if results are missing, stop and wait."
Guardrails are written into the prompt and then sold as a feature.

**Numbers in every promise.** 8 queries, score out of 8, 30-day plan. 4 trust scores and 3 fixes.
60-day catch-up plan. 4-week content plan. Every card has a count and a deadline.

## 2. Where it is weak

- Counts and claims drift: hero says 56 skills, filter says 57; "500+ client campaigns" on the hub,
  "1,000+ clients" on a skill page; "$400 a month of SaaS replaced" has no source.
- CTA labels differ card to card (Download Skill, Open the Skill, Get the skill, Get the prompt).
- 56 cards on one page is a catalogue, not a path. The 8-step guide repairs this, but it sits one
  click away.
- Most skills need the user to run prompts in ChatGPT by hand and paste the answers back. That is
  the manual version of what Vidalo automates. Their AI Visibility Check and AI Citation Monitor
  are exactly the DIY ceiling a paid product has to sit above.
- Everything is Australian English, Google-first. Nothing Dutch, nothing about facts being wrong
  as opposed to pages ranking low.

## 3. What applies to the three businesses

### Vidalo (closest fit)

Vidalo already has the two halves they built by hand: a free scan that is a real tool, and
programmatic sector pages (`/vak/[slug]`). What to add, in order of return for effort:

1. **A free "do it yourself" prompt page in Dutch.** One downloadable `.md` plus the prompt in
   plain sight: "Controleer zelf wat ChatGPT over je bedrijf zegt". Six customer-style questions
   per sector (reuse the pack templates), the three verdicts klopt / klopt niet / niet gevonden,
   and the instruction to ask each question three times. It ranks for "ChatGPT over mijn bedrijf"
   and "AI zegt dat ik gesloten ben", it proves the method, and it ends with the one thing the
   prompt cannot do: find the source and fix it. Keep it off the product UI's jargon rule by
   putting it under a `/kennis` or `/tools` section, not in the landing copy.
2. **Publish the criteria.** `docs/CRITERIA.md` is the prompt they would have put on the page.
   A public `/criteria` page (the twelve criteria, the stipregel, the measurement method) is the
   transparency play, already written, and it is the kind of page an AI assistant cites.
3. **Small browser tools that feed the "niet gevonden" story.** Two of their 37 are directly
   relevant and cheap: "Kan AI je pagina lezen?" (does the content exist without JavaScript) and
   "AI-crawler toegang" (does robots.txt block GPTBot, ClaudeBot, PerplexityBot, Google-Extended).
   Both explain a grey dot to an owner in one screen and both route to the scan.
4. **Numbers in every promise.** The landing already avoids scores, correctly. But the card copy
   can still say "6 vragen, 3 systemen, 3 keer" and "binnen 30 dagen opnieuw gecontroleerd".
   Count and deadline, never a score.
5. **One named method.** Vidalo has the stipregel and the three verdicts; it has no name for the
   whole. Something as plain as "de Vidalo-keuring" (the criteria doc already calls the scan "een
   keuring, geen mening") would do the SOURC-E job in Dutch.

### What can go into the Vidalo product itself

| Their skill | What it checks | Where it lands in Vidalo |
|---|---|---|
| Entity SEO Auditor | entity home page, Organization/LocalBusiness schema with `@id` + `sameAs`, Wikidata, cross-web consistency, disambiguation | The facts page already publishes schema.org JSON-LD. Add `sameAs` to the owner's verified profiles (GBP, KVK, directories) and a consistency check across the 13 directories as part of the setup job. Disambiguation maps onto criterium 11 (naamgenoot). |
| Clarity AI Bot Auditor / AI Crawler Access Checker | which AI crawlers are blocked or throttled | New check in the setup/publish job: fetch the owner's robots.txt and test GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, Bingbot. A blocked crawler means the facts page will never be read; today nothing warns about that. |
| Citation Share Auditor | Bing Webmaster Tools "AI Performance" export, owned / contested / absent per query | Tier 1 source for `docs/BRAIN.md` (Copilot citations) and a possible later data feed for the progress view. |
| AI Citation Monitor | re-run diff: new wins, lost citations, position shifts; "treat single changes as a signal to recheck, not a trend" | The progress view already does the per-period comparison. The "recheck before you call it a trend" rule matches the instabiel threshold and could be said in the UI. |
| Review Engine / Review Sentiment Optimizer | reviews as the source AI learned the brand description from | Reviews are a source of wrong facts (old hours, old address in a 2022 review). Add review text to the source-attribution candidates for findings. Not: responding to or soliciting reviews, that is marketing and outside the contract. |
| Local SEO Audit | one page per service, NAP in footer, named team and credentials on the About page | Overlaps with criterium 6 (diensten wel) and 12 (erkenningen). The fix-path advice for "eigen website" could point to exactly these three things. |

Add StudioHawk/Hawk Academy as a Tier 3 competitor-claims source in `docs/BRAIN.md`.

### Sonable

- **A calculator page.** Their Ad Spend Calculator and "calculator pages are a cheat code for
  topical authority" transfer directly: "Wat kost muziek in je hotel per jaar?" with BumaStemra
  and Sena tariffs by m² and venue type against Sonable's plan. Keep the D-006 phrasing: "geen
  BumaStemra-licentie nodig voor de muziek", never "royalty-free".
- **Industry checklists** on the Local SEO Audit model: "Achtergrondmuziek in hotels: de 7
  dingen die misgaan", one per ICP (hotels, autodealers, fitness). Each is a page that ranks and
  a PDF the outbound sequence can link to instead of a pitch.
- **Review sentiment as lead signal.** Their Review Proof Sorter reads reviews by topic. Running
  the same over hotel reviews for "muziek", "sfeer", "stil" during enrichment gives the outbound
  opener a real quote.

### Sitty

- **A calculator** for the venue side: "Wat verdient je lege stoel overdag?" (seats × hours × fill
  rate × price). The venue pitch is a revenue line nobody has computed for them.
- **Location pages** on their programmatic pattern: `/werkplek/rotterdam`, one per launch city,
  for the demand side ("rustige werkplek Rotterdam centrum"). Unique content per city, not a
  template with the name swapped, which is the exact fault their Local SEO Audit flags.
- Numbers in the promise: "weet het voor je binnenloopt" becomes stronger with a count (how many
  venues, how many seats, how far).

### All three

- **Author identity.** Every Hawk page has a named author with credentials, and their Author
  Authority Builder treats this as the E-E-A-T person layer. A101's footers deliberately carry no
  person's name (settled decision). That holds for the footer; it does not stop a guide or
  checklist page from carrying an author line. Worth deciding once for the content pages, not
  reopening for the footers.
- **Template, then volume.** Their 93 pages exist because the template was fixed first. The kit
  (`A101/kit/`) is the equivalent for the shell; the content-page template (promise, counts,
  method in plain sight, one CTA) does not exist yet and would serve all three brands.
- **Nothing gated.** Their email list comes from one toolkit, the rest is open. For products
  whose free tool is the acquisition channel (Vidalo's scan, a Sonable or Sitty calculator) that
  is the right call; ask for the address only where the result needs sending.

## 4. Not worth copying

- The 56-item catalogue page. A Dutch SMB owner needs one path, not a library.
- Scores out of 10 and letter grades. Vidalo's rule (never a score, colour plus counts) is better
  for its audience and already decided.
- GEO/AEO vocabulary. They need it for the keyword cluster; Vidalo's audience does not speak it
  and the UI rule forbids it.
- Case studies pasted inline by the prompt. Vidalo has no clients yet; placeholders would break
  the "every number has a verified source" rule in `docs/content-check.md`.
