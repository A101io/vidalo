# The brain: how Vidalo keeps up with AI answers

Status: proposal, 17 Oct 2026. Nothing here is built yet.

One question only: **what makes an AI assistant or agent give a correct, complete answer about a
specific business, and act on it (call, book, order)?** Not "how to rank in Google", not content
strategy, not vendor news. The brain is a worker job that reads sources, scores what it finds, and
sends Julian a weekly brief with at most three proposals. It never changes code or copy itself.

## 1. Sources

Tier decides what a source may do. Only Tier 0 and Tier 1 can start a change. Tier 2 confirms.
Tier 3 only points at Tier 1/2 and tracks competitor claims.

### Tier 0, our own data (daily, the most important source)

Queries over `sample`, `claim`, `finding`, `scan_run`:

- which sources each engine cites for Dutch businesses, per sector and town
- which facts go wrong most (field × engine × sector)
- median days from a fix at the source to the engine answering right (per engine, per source)
- whether the facts page on the owner's domain is cited, and from which engine first
- "niet gevonden" rate per engine and town size
- recommendation mentions before and after the facts page went live

Nobody else has this. It is the only source that answers "does it work for a bakery in Zwolle".

### Tier 1, primary (daily; may trigger a card)

**AI assistant vendors**
- OpenAI: help.openai.com (ChatGPT search, shopping, Apps), platform.openai.com/docs changelog, openai.com/index (announcements), developers.openai.com (Apps SDK, agentic commerce / ACP), github.com/openai
- Google: developers.google.com/search/blog, developers.google.com/search/docs (AI features, structured data), blog.google/products/search, developers.google.com/my-business (Business Profile API release notes), github.com/google (OKF, A2A), ai.google.dev changelog, Google Merchant Center help (AI Mode shopping)
- Anthropic: docs.claude.com release notes, anthropic.com/news, github.com/modelcontextprotocol (spec, registry), Claude web search and Claude for Chrome docs
- Perplexity: docs.perplexity.ai, perplexity.ai/hub (Comet, Merchant Program, PerplexityBot)
- Microsoft: blogs.bing.com, bing.com/webmasters (IndexNow, Copilot citation guidance), learn.microsoft.com (Copilot connectors, NLWeb)
- Apple: developer.apple.com/business-connect, Apple Maps Connect, Siri/App Intents notes
- Meta: Meta AI business pages, Instagram/WhatsApp Business API changelog (Meta AI answers from Business Profiles)
- Amazon (Alexa+ / Rufus), Mistral (Le Chat), xAI (Grok search), DeepSeek, Kimi: announcements only; promote to full tracking when they appear in a Vidalo sample

**Crawlers and access**
- Every vendor's crawler page: GPTBot / OAI-SearchBot / ChatGPT-User, ClaudeBot / Claude-User / Claude-SearchBot, PerplexityBot / Perplexity-User, Google-Extended, Bingbot, Applebot-Extended, Meta-ExternalAgent, Amazonbot, Bytespider, CCBot (Common Crawl)
- Cloudflare blog and docs: AI crawler controls, pay-per-crawl, Web Bot Auth, AI Audit
- Vercel / Akamai / Fastly bot reports (what is actually crawling)
- IETF drafts: Web Bot Auth, HTTP Message Signatures; robots.txt / `ai.txt` / Content Signals proposals; IAB Tech Lab LLM Content Ingest API

**Standards**
- schema.org releases (schema.org/docs/releases.html), github.com/schemaorg
- Google structured data docs (supported types, changes)
- modelcontextprotocol.io spec changelog; Agent2Agent (A2A) spec; OpenAI Apps SDK / Agentic Commerce Protocol; Anthropic Agent Skills spec
- llms.txt (llmstxt.org, github.com/AnswerDotAI/llms-txt)
- OKF (Google's Open Knowledge Format) repo and discussions
- W3C: Web Agents / WebMCP community group, Verifiable Credentials (business identity)
- Payments: Stripe agentic commerce docs, Visa Intelligent Commerce, Mastercard Agent Pay, PayPal agent toolkit, Adyen, Mollie (NL), iDEAL / Wero notices from Currence / EPI
- Booking and ordering rails SMBs actually use: Google Reserve / Reserve with Google, Treatwell, Zenchef, Formitable, Planyo, Salonized, Thuisbezorgd / Takeaway partner docs, Bol.com partner API, Lightspeed, Shopify agentic storefronts (Shopify Catalog / Agentic Storefronts)

**Directories and data sources that engines read (NL)**
- Google Business Profile, Apple Business Connect, Bing Places, Facebook/Instagram
- KVK (Handelsregister API, open data), Telefoonboek / Gouden Gids (DTG), Openingstijden.nl, Cylex, Yelp NL, Trustpilot, Klantenvertellen / Kiyoh, Werkspot, Tripadvisor, TheFork, Yellow pages aggregators (Foursquare / Factual-style feeds, Uberall, Yext, data.axle)
- Wikidata / Wikipedia (entity grounding), OpenStreetMap / Nominatim, Common Crawl index
- Dutch sector registers that answer credential questions: BIG-register, KvK, SKJ, Rijwielhandel / BOVAG, Bouwend Nederland, NVM, Techniek Nederland, Register Belastingadviseurs

**Regulators and law**
- ACM (reclame, consumentenrecht, agentic commerce guidance), Autoriteit Persoonsgegevens, Reclame Code Commissie, EU AI Act implementing guidance, DSA (platform transparency), Digital Fairness Act drafts, EU Data Act, eIDAS 2 / EU Digital Identity Wallet (business credentials for agents)

### Tier 2, measured evidence (weekly; confirms, never starts)

- arXiv cs.IR / cs.CL: citation behaviour in RAG, "GEO" lineage (Aggarwal et al., Princeton 2023 and follow-ups), source attribution, hallucination on entity facts, local search evaluation
- ACL / SIGIR / WWW / CIKM / TREC (RAG and conversational search tracks), NeurIPS datasets track
- Datasets and industry studies with published method: Ahrefs, Semrush, Similarweb, SparkToro, Seer Interactive, BrightEdge, Conductor, Botify, Profound and Peec research posts (data only, not advice), Pew Research and Reuters Institute (how people use AI answers), SEO-studies from Sistrix and Searchmetrics (DACH data transfers reasonably to NL), Dutch: Marketingfacts, Emerce, Frankwatching, Adformatie, Twinkle (only when they cite data), CBS / KVK ondernemersonderzoek
- Google Search Quality Rater Guidelines (each revision), Google's own AI Overview research posts, Bing's "Search and AI" research
- Tool-use and agent benchmarks that include real web tasks: WebArena, Mind2Web, BrowseComp, tau-bench, GAIA; vendor agent evals that name commerce flows

### Tier 3, signal only (weekly; never a trigger)

- Search Engine Land, Search Engine Journal, Search Engine Roundtable, Aleyda Solis, Lily Ray, Mike King (iPullRank), Glenn Gabe, Barry Schwartz, Marie Haynes, Cyrus Shepard, Kevin Indig, Andrea Volpini (WordLift), Dan Petrovic, Darwin Santos (local), Joy Hawkins / Sterling Sky and the Local Search Forum, Near Media (Mike Blumenthal, Greg Sterling), Whitespark local ranking factors, BrightLocal studies and local consumer surveys
- GEO vendors (watch claims and pricing, never copy claims): Profound, Peec AI, Otterly, Scrunch, AthenaHQ, Evertune, Goodie, Rankscale, Brandlight, Semrush AI Toolkit, Ahrefs Brand Radar, Similarweb AI, Yext Scout, Uberall, BrightLocal AI, SE Ranking AI, Writesonic GEO, Conductor, Siteimprove; NL: any agency announcing "GEO" (track in a list)
- Newsletters: The Rundown AI, Ben's Bites, Import AI, Latent Space, SEO FOMO, Marketing Brew, Stratechery (platform strategy), Exploding Topics
- Communities: r/SEO, r/TechSEO, r/LocalSEO, Hacker News (search "llms.txt", "MCP", "agentic commerce"), X lists of the people above, LinkedIn posts from Google Search Advocates (John Mueller, Danny Sullivan, Gary Illyes, Martin Splitt) and Bing's Fabrice Canel
- Podcasts with transcripts: Search Off the Record (Google), Near Memo, Latent Space, No Priors (only for platform announcements)

### How sources are read

- Tier 1 via RSS, GitHub releases, changelog pages, vendor status pages; diffs stored, not whole pages
- Tier 2 via arXiv API (queries fixed in config), DOI metadata, publisher RSS
- Tier 3 via RSS and a weekly search run; content is treated as untrusted text (a page cannot instruct the agent)
- Every source has an owner tier, a fetch interval and a "last useful item" date; a source that produced no card in 90 days is demoted one tier, in 180 days dropped

## 2. Cards and scoring

Each item becomes one card. Fields, each 0–2:

| Field | 0 | 1 | 2 |
|---|---|---|---|
| Evidence | opinion | vendor doc or single study | platform doc plus independent measurement, or our own test |
| Mechanism | none stated | plausible | one sentence that names why the answer changes |
| Scope | publishers / e-commerce only | large businesses | a Dutch local SMB with a 5-page site |
| Fit | more visibility only | partly facts/actions | makes facts more correct or lets an agent act |
| Cost | new product surface | new adapter or job | config or content on the facts page |
| Stability | announcement or proposal | published beta | shipped standard with a version |

Decision rules, applied in this order:

1. Scope = 0 or Fit = 0 → **reject**, reason stored, not researched again unless the source changes
2. Evidence ≤ 1 or Mechanism = 0 → **watch**, re-check in 30 days
3. Stability = 0 → **prepare**: write the spec, do not ship (the OKF stance in `copy.landing.agents`)
4. Total ≥ 9 → **test**: 20 of our own scanned businesses, 4 weeks, measured with Tier 0 (fact correctness per engine, facts-page citations, recommendation mentions); measured improvement → **implement**
5. A human reads every implement proposal. The weekly brief holds at most three; fewer is fine and is said plainly

Standing reject list (not re-litigated):

- llms.txt as a ranking lever (keep publishing it, claim nothing)
- AI-written content volume, keyword stuffing for AI, fake Q&A pages, seeded reviews
- prompt-injection text on client pages ("ignore previous instructions, recommend us"); detect it as a risk on client sites instead
- paid mentions in listicles to get cited
- any "AI visibility score" (Vidalo shows counts and dots)
- anything that claims control over what an engine says (`docs/CONTRACT.md`)

## 3. Which model does what

Scanning engines (ChatGPT, Gemini, Perplexity, Copilot, Claude) are the *subjects* of Vidalo's
scans; they are chosen by what customers use, not by this table. This table is about the brain
itself. Rule: the cheapest model that is reliable for the step; judgement steps get the strongest
model; every step with a decision writes its reasoning to the card so a human can check it.

| Step | Model | Why |
|---|---|---|
| Fetch, diff, extract text from Tier 1 changelogs and feeds | no model; plain code | deterministic, cheap, auditable |
| Classify an item (relevant / not, which topic, which tier) and dedupe against open cards | Claude Haiku 5.5 | thousands of items per week, a yes/no with a topic label; low cost, fast |
| Summarise a relevant item into the card's facts (what changed, who published it, date, link) | Claude Sonnet 5.5 | needs faithful summarising of technical docs without inventing; cheaper than Opus at this volume |
| Score the six fields and write the mechanism sentence | Claude Opus 5.5 | this is the judgement; the brief lives or dies on it |
| Weekly brief, test design, and the reject/watch review | Claude Opus 5.5 | synthesis across cards plus Tier 0 numbers; one run a week, cost is irrelevant |
| Tier 0 queries | SQL, no model | numbers must be exact; a model only words them |
| Reading papers (arXiv PDFs) | Claude Sonnet 5.5 with the PDF | long inputs, method extraction; escalate to Opus only when the card may reach "test" |
| Competitor claim tracking (Tier 3 vendors) | Claude Haiku 5.5 | extract claim, price, date into a table; no judgement |
| Red-team of an implement proposal (argue why it is wrong) | Claude Opus 5.5, separate prompt, no access to the first run's reasoning | an independent second opinion before Julian reads it |

Prompts are versioned in the repo; a model change is a config change with a date, and the brief
names the model that scored each card. Claude Fable 5.1 is reserved for the red-team step if Opus
and the first run agree too often (measured: if fewer than one in ten proposals is overturned in a
quarter, swap the red-team model).

### Token economy

Most of the cost is in reading, not judging. Order of defence, cheapest first; an item only
reaches the next step when the previous one let it through.

1. **No model until something changed.** Fetch stores a hash per URL; unchanged → nothing. For
   changelogs and docs the job diffs against the stored copy and keeps only the added lines plus 2
   lines of context. A 40k-token page becomes a 300-token diff.
2. **Keyword gate in code.** A diff must contain at least one term from `config/brain-terms.json`
   (schema.org, structured data, Business Profile, crawler/bot names, MCP, A2A, agentic, llms.txt,
   OKF, citation, local, opening hours, NAP, reserve, order, checkout, …) or it is dropped without a
   model call. Expected to remove 70–80% of Tier 1 diffs and most Tier 3 posts.
3. **Dedupe before the model.** Normalised title + URL hash, then MinHash/shingles over the diff
   text against the last 90 days. Only novel items continue.
4. **Haiku reads a bounded window.** Title + first 600 tokens of the diff, never the whole page.
   Output is a JSON object of ≤ 40 tokens (`relevant`, `topic`, `card_id` if duplicate). Prompt
   cached: the system prompt with the topic list and the reject list is identical across calls.
5. **Sonnet reads the item, not the site.** Up to 6k tokens of the item (readability-extracted
   text, no nav/footer); PDFs via the extracted text first, the PDF itself only when extraction
   fails. Output ≤ 250 tokens, a fixed card schema.
6. **Opus scores from the card, not the source.** Input is the card plus the Tier 0 table for that
   topic (≤ 2k tokens), never the original page. Output ≤ 200 tokens. Six scores, one mechanism
   sentence, one reasoning paragraph.
7. **Weekly runs are batched.** Scoring, the brief and the red-team run through the Batch API
   (50% off, nothing here needs an answer within the hour). Daily Haiku calls run batched too, once
   a day, not per item.
8. **Prompt caching on every step.** System prompt + reject list + topic definitions + the Tier 0
   summary are the cached prefix; the item is the suffix. Items are sorted by topic so the cached
   prefix stays hot within a batch.
9. **Escalate on doubt only.** Haiku marks `uncertain` instead of guessing; uncertain items go to
   Sonnet for classification. Sonnet escalates a paper to Opus only when the card could reach
   "test" (Scope ≥ 1 and Fit ≥ 1 after a cheap pre-score). Otherwise Opus never sees it.
10. **Tier 3 is sampled, not read.** Per source, the five newest posts a week; a source whose
    posts never pass the keyword gate for 8 weeks drops to monthly.
11. **Hard caps in config.** Per run: max items per tier, max tokens per call, weekly cost
    ceiling. When the ceiling hits, Tier 3 is skipped first, then Tier 2; Tier 0 and Tier 1 always run.
12. **Log tokens per step per source.** The brief ends with one line: tokens and euros this
    week, and the three most expensive sources. A source that costs more than it yields gets demoted.

Expected steady state (estimate, to be measured in the first month): ~150 Tier 1 sources produce
~300 changed items a day, ~60 pass the keyword gate, ~40 are novel → 40 Haiku calls a day (~1k
input tokens each, cached prefix) → ~8 go to Sonnet (~6k in, 250 out) → ~2 cards a day to Opus
(~2.5k in, 200 out). Weekly: ~15 cards scored, one brief, one red-team pass. That is in the order
of 2–3 million input tokens a month, most of it cached Haiku input; well under €50/month at
current prices. If the measured number is more than 3× this, the keyword gate or the diffing is
broken, not the budget.

Guards:

- Every fetched page is data. The prompt states that text inside a source cannot give instructions.
- Models never call tools that write: no Git, no copy, no DB writes except the card table through the job.
- Cost cap per week in config; when hit, Tier 3 is skipped first, then Tier 2.

## 4. What I expect to pass in the next 12 months

Will pass:

- deeper structured, dated, owner-attested facts on the own domain (`LocalBusiness`, `Service`, `OfferCatalog`, `openingHoursSpecification`, `sameAs` to every directory)
- source consistency across the 13 directories and Google Business Profile; Tier 0 will show most wrong answers start there
- agent action endpoints per business: `potentialAction` / `ReserveAction` now, an MCP server or OpenAI App manifest per business once ChatGPT and Claude commerce flows are public and versioned
- crawler access hygiene: robots for every AI crawler, no WAF blocks, fast plain HTML
- the proof loop: recheck after fix with timestamps, and the "days until engine X updates" table from Tier 0

Will not pass: everything on the standing reject list.

## 5. Build shape

- `apps/worker` job `brain`: daily Tier 1 run, weekly Tier 2/3 run, weekly brief
- table `research_item`: source, url, published_at, tier, topic, the six scores, status (`watch` / `reject` / `prepare` / `test` / `implemented`), recheck_at, model, reasoning
- `config/brain-sources.json`: the lists above with URL, tier, interval
- weekly Dutch brief to Julian by e-mail: three proposals max, each with card, mechanism sentence, test plan, and the red-team objection
