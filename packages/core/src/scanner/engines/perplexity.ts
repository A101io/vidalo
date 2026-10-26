/**
 * Perplexity "sonar" via plain fetch to the chat completions endpoint.
 * Citations come back as `citations: string[]` on the response.
 */
import type { EngineClient, AskContext, EngineAnswer } from "./types";
import { systemFor, ENGINE_TIMEOUT_MS } from "./types";

const MODEL = () => process.env.PERPLEXITY_MODEL ?? "sonar";

interface PerplexityResponse {
  choices?: { message?: { content?: string } }[];
  citations?: string[];
  search_results?: { url?: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** sonar: $1/M in, $1/M out, plus ~$5/1k requests (low context). */
export function estimatePerplexityCost(inTok: number, outTok: number): number {
  return Math.round(((inTok + outTok) * 100 / 1_000_000 + 0.5) * 100) / 100;
}

export const perplexityEngine: EngineClient = {
  engine: "perplexity",
  available: () => Boolean(process.env.PERPLEXITY_API_KEY),
  async ask(promptNl: string, ctx: AskContext): Promise<EngineAnswer> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ENGINE_TIMEOUT_MS);
    try {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        signal: ctrl.signal,
        headers: { authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: MODEL(),
          messages: [
            { role: "system", content: systemFor(ctx.business.country) },
            { role: "user", content: promptNl },
          ],
          temperature: 0.7,
          search_domain_filter: undefined,
          web_search_options: { search_context_size: "low", user_location: { country: ctx.business.country ?? "NL" } },
        }),
      });
      if (!res.ok) throw new Error(`perplexity ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = (await res.json()) as PerplexityResponse;
      const text = data.choices?.[0]?.message?.content ?? "";
      const citations = [...(data.citations ?? []), ...(data.search_results ?? []).map((s) => s.url).filter((u): u is string => Boolean(u))];
      return {
        answerText: text.trim(),
        citations: [...new Set(citations)],
        costCents: estimatePerplexityCost(data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0),
      };
    } finally {
      clearTimeout(timer);
    }
  },
};
