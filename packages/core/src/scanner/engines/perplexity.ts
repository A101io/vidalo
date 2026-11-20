/**
 * Perplexity via plain fetch to the Agent API (`/v1/agent`). Sonar chat
 * completions lost support on 27 Sep 2026; Perplexity maps sonar to effort
 * "fast". Web search runs as `search_type: "fast"` ($1 / 1k calls instead of
 * $2.50), told the business's town. Citations are the `citation` annotations
 * on the answer plus the `search_results` item; the cost is the one Perplexity
 * reports in `usage.cost`.
 */
import type { EngineClient, AskContext, EngineAnswer } from "./types";
import { systemFor, ENGINE_TIMEOUT_MS } from "./types";
import { perplexityUserLocation } from "./location";

const EFFORT = () => process.env.PERPLEXITY_EFFORT ?? "fast";

interface PerplexityResponse {
  output?: {
    type?: string;
    content?: { type?: string; text?: string; annotations?: { type?: string; url?: string }[] }[];
    results?: { url?: string }[];
  }[];
  usage?: { input_tokens?: number; output_tokens?: number; cost?: { total_cost?: number } };
}

/** Fallback when the response carries no cost: fast search $1/1k + ~$1/M tokens. */
export function estimatePerplexityCost(inTok: number, outTok: number): number {
  return Math.round(((inTok + outTok) * 100 / 1_000_000 + 0.1) * 100) / 100;
}

/** Answer text, cited URLs and cost (US cents) from an Agent API response. */
export function readPerplexityResponse(data: PerplexityResponse): EngineAnswer {
  let text = "";
  const citations: string[] = [];
  for (const item of data.output ?? []) {
    if (item.type === "search_results") {
      for (const r of item.results ?? []) if (r.url) citations.push(r.url);
      continue;
    }
    if (item.type !== "message") continue;
    for (const c of item.content ?? []) {
      if (c.type !== "output_text" || !c.text) continue;
      text += (text ? "\n" : "") + c.text;
      for (const a of c.annotations ?? []) if (a.type === "citation" && a.url) citations.push(a.url);
    }
  }
  const reported = data.usage?.cost?.total_cost;
  return {
    answerText: text.trim(),
    citations: [...new Set(citations)],
    costCents: typeof reported === "number" ? Math.round(reported * 100 * 100) / 100 : estimatePerplexityCost(data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0),
  };
}

export const perplexityEngine: EngineClient = {
  engine: "perplexity",
  available: () => Boolean(process.env.PERPLEXITY_API_KEY),
  async ask(promptNl: string, ctx: AskContext): Promise<EngineAnswer> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ENGINE_TIMEOUT_MS);
    try {
      const res = await fetch("https://api.perplexity.ai/v1/agent", {
        method: "POST",
        signal: ctrl.signal,
        headers: { authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          effort: EFFORT(),
          instructions: systemFor(ctx.business.country),
          input: promptNl,
          tools: [{ type: "web_search", search_type: "fast", user_location: perplexityUserLocation(ctx.business) }],
        }),
      });
      if (!res.ok) throw new Error(`perplexity ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return readPerplexityResponse((await res.json()) as PerplexityResponse);
    } finally {
      clearTimeout(timer);
    }
  },
};
