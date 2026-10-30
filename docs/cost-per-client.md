# Cost per client, and where it can drop

Written 30 Oct 2026 from the code as it is (`packages/core/src/scanner`, `fixer`, `apps/worker/src/cron.ts`). Nothing below has been measured against a real bill yet: no paid scan has run. Prices are the ones the code itself uses (`engines/*.ts`), with the public price next to it where it differs. Verify the three marked prices before acting; the ranking does not change if they are off by half.

## 1. What one paying client triggers

| When | What runs | Engine calls |
|---|---|---|
| Month 1 (setup, paid by the €149) | baseline scan: ~34 prompts × 10 samples × 4 live engines (copilot is a stub and is skipped) | 1,360 + ~880 extraction calls |
| Every month | monthly scan, same size | 1,360 + ~880 |
| Every 7–30 days per open finding | recheck: affected prompts (1–3) × 10 samples × 1 engine, one `runScan` per fix | 10–30 per finding |
| Whenever the owner clicks "Controleer nu" | on-demand scan: ~34 prompts × 5 samples × 4 engines, no cap | 680 + ~440 |
| Monthly / weekly | own-site check, Google index check, DNS poll, mails | no AI cost |

Prompt count: up to 20 base (`prompts/index.ts`) + up to 6 sector questions + 6 recommendation questions + 6 rotating bank questions (`rotation.ts`). `docs/ARCHITECTURE.md` still says 20.

## 2. Unit prices per sample

| Engine | Code's own table | Public price today | Per full scan (340 samples) |
|---|---|---|---|
| ChatGPT `gpt-4.1-mini` + `web_search_preview` | 2.5¢ per search call + ~0.15¢ tokens | the newer `web_search` tool is listed at $10/1k calls plus an 8,000-token input block (~0.3¢) **verify** | $9.0 (code) / ~$4.8 (new tool) |
| Gemini `gemini-2.0-flash` + grounding | 3.5¢ per grounded prompt | $35/1k, with a free daily allowance on 2.5 Flash that forum posts put at 1,500/day; Gemini 3 moved to $14/1k search queries with 5,000 free prompts a month **verify** | $11.9 (or $0 inside the allowance) |
| Perplexity `sonar` | 0.5¢ request + ~0.2¢ tokens | matches | $2.4 |
| Google AI Overview via SerpApi | 1¢ per search, 2 when a page token is needed | plan-dependent, 0.9–2.5¢; **cached repeats are free and not counted** | $0.5–1 real, $3.4–6.8 as the code counts it |
| Extraction `gpt-4.1-mini` (one call per fact sample) | not counted | ~0.05¢ | $0.45 |

Full scan at the code's prices: about **$24.5 (≈ €22.5)**. Inside Gemini's free allowance: about $12.6.

## 3. Monthly cost of one active client

| Line | Cost | Note |
|---|---|---|
| Monthly scan | €22.5 | €11.6 if Gemini stays free |
| Rechecks (6 open findings, 2 prompts each, 2 rounds) | €4.5 | |
| One "Controleer nu" | €11 | unbounded; zero if nobody clicks |
| Fixed infra share at 10 clients (Supabase Pro $25, Workers $5, SerpApi plan $75) | €9.7 | €1.9 at 50 clients |
| Mail, Twilio code, DNS, site check | < €0.5 | |
| **Total** | **€27–48** against €49 ex btw | `ARCHITECTURE.md` says €11–14 |

The margin at €49 is 2–45% depending on Gemini's allowance and on how often the owner clicks. That is the problem to fix, not the infra.

## Built 30 Oct 2026

Savings 1–3 below are in the code (`FIRST_SAMPLES`, `SAMPLES_CAP`, `samplesFor` in `scanner/index.ts`; `web_search` in `engines/chatgpt.ts`): every (prompt, engine) cell is asked 5 times, and goes to 10 only when a first answer was wrong, not found, about a namesake or did not name the business; `google_ai` gets 1 sample; ChatGPT uses the current search tool and its price. Verified with the unit tests and `pnpm e2e:mock`; not yet with a paid scan. The copy now says "tot tien keer" / "up to ten times"; the landing scene still draws ten boxes per engine as an illustration.

## 4. Savings, biggest first

| # | Change | Saves per client per month | Where |
|---|---|---|---|
| 1 | **Sequential sampling.** Ask 5 samples per (prompt, engine); go to 10 only when any sample disagrees with the facts, is not found, or names another entity. Criteria with threshold "any" (1, 2, 8, 11) flag on one sample already; the "≥ 30%" criteria keep 10 samples where it matters. | ~€10–13 (about half of all engine spend, scan and rechecks) | `scanner/index.ts` `sampleAll`, `SCAN_DEFAULTS` |
| 2 | **One sample for `google_ai`.** The same Google query returns the same AI Overview, and SerpApi serves repeats from cache. Ten "samples" are ten copies of one answer: no extra evidence, but they do count 10× in the ratios and the stip. | €0.5–3 on usage; lets the SerpApi plan drop from $75 to $25 (about €4.5 per client at 10 clients) | `SCAN_DEFAULTS`, or `samplesPerPrompt` per engine |
| 3 | **ChatGPT: `web_search_preview` → `web_search`** and update `PRICE` / `WEB_SEARCH_CALL_CENTS`. | ~€4 | `engines/chatgpt.ts` |
| 4 | **Gemini inside the free allowance.** Pin `GEMINI_MODEL` to a current Flash model (the `gemini-2.0-flash` default is likely retired), confirm the daily or monthly free grounding quota, and keep the daily number of full scans under it (one scan ≈ 340 grounded calls; 1,500/day ≈ 4 scans/day ≈ 120 clients spread over 28 anniversary days). Add a daily counter that falls back to fewer samples once the quota is used. | up to €11 while under the quota | `engines/gemini.ts`, `cron.ts monthlySlot` |
| 5 | **Scope the on-demand scan.** "Controleer nu" after a facts edit should ask only the prompts whose probes touch the changed fact keys, only the engines with open findings, and run at most once per 7 days (`ARCHITECTURE.md` already says "mini-scan after 7d"). | €9–10 per click, and the line becomes bounded | `apps/web/app/app/actions.ts checkNow`, `scanner/index.ts loadPrompts` |
| 6 | **One recheck run per business per day.** `enqueueDueRechecks` enqueues one job per fix; two findings on the same prompt and engine sample it twice. Union the due fixes' prompt ids and engines into one `runScan`, then judge each fix from that report. | €1–2 | `cron.ts`, `fixer/index.ts runRecheck` |
| 7 | **Skip extraction when it cannot add anything.** Run `looksNotFound` before the LLM call (today it runs after), and cache extraction per (prompt id, answer hash) so identical answers are extracted once. | €0.2–0.4 | `scanner/extract.ts` |
| 8 | **Make the number true.** Fix the price table (ChatGPT, SerpApi), count extraction in `costCents`, and correct `ARCHITECTURE.md` line 34 and the "20 prompts" sentence. Costs nothing, but every pricing decision rests on it. | — | `engines/*.ts`, `docs/ARCHITECTURE.md` |

After 1–5 the monthly scan is roughly €5–7, rechecks about €2, and the on-demand check about €1. The client costs **€8–12 a month** including infra at 10 clients, against €49.

## 5. What not to touch

- The cron that fires every minute (`wrangler.jsonc`): 43k Worker invocations a month sit inside the $5 plan and the queries are trivial.
- Perplexity: already the cheapest engine per sample and the one with the most varied answers; leave at the sampling rule in #1.
- Attribution's page fetches (up to 8 per finding): egress is free on Workers.
- The free scan (€0.40–0.60 each, 25 a day cap): #2 and #3 bring it to about €0.25 without any further change.

## 6. Verify before acting (Julian or a session with web access)

| Price | Where to read it |
|---|---|
| OpenAI web search tool: per-call fee and token block for `gpt-4.1-mini`, both tools | https://platform.openai.com/docs/pricing → "Built-in tools" |
| Gemini grounding: free allowance and per-prompt or per-query price for the Flash model chosen | https://ai.google.dev/gemini-api/docs/pricing → "Grounding with Google Search" |
| SerpApi: plan and the line that cached searches are not counted | https://serpapi.com/pricing |
