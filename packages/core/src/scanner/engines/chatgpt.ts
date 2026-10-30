/**
 * ChatGPT via the OpenAI Responses API with web search. Citations come from
 * the `url_citation` annotations on the output text.
 */
import OpenAI from "openai";
import type { EngineClient, AskContext, EngineAnswer } from "./types";
import { SYSTEM_NL, ENGINE_TIMEOUT_MS } from "./types";
import { withTimeout } from "../util";
import { openAiUserLocation } from "./location";

const MODEL = () => process.env.CHATGPT_MODEL ?? "gpt-4.1-mini";

/** Rough price table (USD cents per 1M tokens) used for cost accounting. */
const PRICE: Record<string, { inCents: number; outCents: number }> = {
  "gpt-4.1-mini": { inCents: 40, outCents: 160 },
  "gpt-4.1": { inCents: 200, outCents: 800 },
  "gpt-4o-mini": { inCents: 15, outCents: 60 },
  "gpt-4o": { inCents: 250, outCents: 1000 },
};
const WEB_SEARCH_CALL_CENTS = 2.5; // $25 / 1k calls

export function estimateOpenAiCost(model: string, inputTokens: number, outputTokens: number, webSearchCalls = 0): number {
  const p = PRICE[model] ?? PRICE["gpt-4.1-mini"]!;
  const cents = (inputTokens * p.inCents + outputTokens * p.outCents) / 1_000_000 + webSearchCalls * WEB_SEARCH_CALL_CENTS;
  return Math.round(cents * 100) / 100;
}

let client: OpenAI | null = null;
export function openaiClient(): OpenAI {
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: ENGINE_TIMEOUT_MS });
  return client;
}

export const chatgptEngine: EngineClient = {
  engine: "chatgpt",
  available: () => Boolean(process.env.OPENAI_API_KEY),
  async ask(promptNl: string, ctx: AskContext): Promise<EngineAnswer> {
    const model = MODEL();
    const res = await withTimeout(
      openaiClient().responses.create({
        model,
        instructions: SYSTEM_NL,
        input: promptNl,
        tools: [{ type: "web_search_preview", user_location: openAiUserLocation(ctx.business), search_context_size: "low" }],
        temperature: 0.7,
      }),
      ENGINE_TIMEOUT_MS,
      "chatgpt",
    );

    const citations: string[] = [];
    let webSearchCalls = 0;
    let text = "";
    for (const item of res.output ?? []) {
      if (item.type === "web_search_call") webSearchCalls++;
      if (item.type !== "message") continue;
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        text += (text ? "\n" : "") + part.text;
        for (const a of part.annotations ?? []) {
          if (a.type === "url_citation" && a.url && !citations.includes(a.url)) citations.push(a.url);
        }
      }
    }
    if (!text) text = res.output_text ?? "";
    const usage = res.usage;
    return {
      answerText: text.trim(),
      citations,
      costCents: estimateOpenAiCost(model, usage?.input_tokens ?? 0, usage?.output_tokens ?? 0, webSearchCalls),
    };
  },
};
