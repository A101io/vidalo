/**
 * Claude via the Anthropic Messages API with the server-side web search tool,
 * so answers are grounded like a user of claude.ai sees them. Citations are
 * the `web_search_result_location` entries on the text blocks.
 *
 * Model from CLAUDE_MODEL (default claude-opus-5-5). Thinking is always on for
 * this model family; effort "low" keeps a plain factual answer cheap. The
 * model has no temperature parameter. A safety refusal (stop_reason
 * "refusal") is reported as a skipped sample, as that is what a user would see.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { EngineClient, AskContext, EngineAnswer } from "./types";
import { SYSTEM_NL, ENGINE_TIMEOUT_MS } from "./types";
import { withTimeout } from "../util";

const MODEL = () => process.env.CLAUDE_MODEL ?? "claude-opus-5-5";

/** USD cents per 1M tokens (Anthropic list prices, Oct 2026) + web search per request. */
const PRICE: Record<string, { inCents: number; outCents: number }> = {
  "claude-opus-5-5": { inCents: 400, outCents: 2000 },
  "claude-sonnet-5-5": { inCents: 200, outCents: 1000 },
  "claude-haiku-5-5": { inCents: 10, outCents: 50 },
};
const WEB_SEARCH_CENTS = 1; // $10 / 1k searches

export function estimateClaudeCost(model: string, inputTokens: number, outputTokens: number, webSearches = 0): number {
  const p = PRICE[model] ?? PRICE["claude-opus-5-5"]!;
  const cents = (inputTokens * p.inCents + outputTokens * p.outCents) / 1_000_000 + webSearches * WEB_SEARCH_CENTS;
  return Math.round(cents * 100) / 100;
}

/** Server-side tool loops may pause; resume at most this often before giving up. */
const MAX_TURNS = 3;

let client: Anthropic | null = null;
export function anthropicClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: ENGINE_TIMEOUT_MS });
  return client;
}

export const claudeEngine: EngineClient = {
  engine: "claude",
  available: () => Boolean(process.env.ANTHROPIC_API_KEY),
  async ask(promptNl: string, _ctx: AskContext): Promise<EngineAnswer> {
    const model = MODEL();
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: promptNl }];
    let inTok = 0;
    let outTok = 0;
    let searches = 0;
    let text = "";
    const citations: string[] = [];
    let refused = false;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await withTimeout(
        anthropicClient().messages.create({
          model,
          max_tokens: 4096,
          system: SYSTEM_NL,
          output_config: { effort: "low" },
          tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3, user_location: { type: "approximate", country: "NL" } }],
          messages,
        }),
        ENGINE_TIMEOUT_MS,
        "claude",
      );
      inTok += res.usage.input_tokens;
      outTok += res.usage.output_tokens;
      searches += res.usage.server_tool_use?.web_search_requests ?? 0;
      for (const block of res.content) {
        if (block.type !== "text") continue;
        text += (text ? "\n" : "") + block.text;
        for (const c of block.citations ?? []) {
          if (c.type === "web_search_result_location" && c.url && !citations.includes(c.url)) citations.push(c.url);
        }
      }
      if (res.stop_reason === "refusal") refused = true;
      if (res.stop_reason !== "pause_turn") break;
      // The server-side search loop paused: send the answer so far back and let it resume.
      messages.push({ role: "assistant", content: res.content });
    }

    const costCents = estimateClaudeCost(model, inTok, outTok, searches);
    if (refused || !text.trim()) return { answerText: "", citations: [], costCents, skipped: true };
    return { answerText: text.trim(), citations, costCents };
  },
};
