# First real scan

The handoff's step 2, and the one that tests the idea: ask ChatGPT about 20
real businesses in one town and read what comes back. Everything below is
ready except the key and the list.

## 1. Cap the bill before adding the key

Create a separate OpenAI **project** for Vidalo and set a hard monthly budget
on it (Settings → Limits). The code keeps its own estimate, but only the
project budget actually stops spending.

## 2. Pick the town and the 20 businesses

`packages/core/examples/businesses.csv` is fictional and spread over ten towns;
it is for mock runs. For the real run, write `scans/<town>.csv`, one town, the
kinds of business Vidalo would sell to (bakers, plumbers, garages,
hairdressers), copied exactly as they appear on Google Maps:

```
name,place
<Bedrijfsnaam>,<Plaats>
```

## 3. Run it, ChatGPT only

```bash
export OPENAI_API_KEY=sk-...          # the Vidalo project's key
VIDALO_MOCK=0 pnpm scan --list scans/<town>.csv --kind free --engines chatgpt --out out/scans
```

No `DATABASE_URL`: the run uses the in-memory store and writes nothing to
Supabase. Without `GOOGLE_PLACES_API_KEY` each business resolves to one
candidate built from the name and town, so the "correct" facts it compares
against are thin. That still shows what ChatGPT *says*; for a judgement on
right versus wrong, add the Places key first (step 3 in CLAUDE.md).

## 4. What it costs (estimate)

A free scan is 6 questions x 3 samples = 18 ChatGPT calls with web search,
plus 18 small extraction calls. At the prices in
`packages/core/src/scanner/engines/chatgpt.ts` (gpt-4.1-mini, the `web_search`
tool at $10 per 1,000 calls plus about 8,000 input tokens of search content
per call) that is roughly **$0.25 per business, about $5 for 20**.
Check the table against OpenAI's current pricing page. The CLI prints the
estimated cost of each business's answers and a running total; the small
extraction calls are not in that figure.

## 5. Read

`out/scans/*.md`: one Dutch summary per business. The question to answer is
the business one: how often is ChatGPT wrong about a small local business in
a way the owner would pay to fix?
