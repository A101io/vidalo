/**
 * Gemini via @google/generative-ai with Google Search grounding. Citations are
 * the web URIs in groundingMetadata.groundingChunks.
 *
 * Note: the SDK's typings (v0.21) still describe the Gemini 1.5 tool shape
 * (`googleSearchRetrieval`) and misspell `groundingChuncks`; Gemini 2.x uses
 * `{ googleSearch: {} }`. We send the 2.x shape and read both spellings.
 *
 * Default model gemini-3.1-flash-lite (gemini-2.0-flash is shut down). Gemini 3
 * bills grounding per search query, not per prompt, and Google advises leaving
 * its temperature at the default, so 3.x gets none.
 */
import { GoogleGenerativeAI, type Tool } from "@google/generative-ai";
import type { EngineClient, AskContext, EngineAnswer } from "./types";
import { systemFor, ENGINE_TIMEOUT_MS } from "./types";
import { withTimeout } from "../util";

const MODEL = () => process.env.GEMINI_MODEL ?? "gemini-3.1-flash-lite";

/**
 * USD cents per 1M tokens + grounding (Google price page, 2 Nov 2026). List
 * prices: the free grounding allowance (Gemini 3: 5,000 a month per account;
 * 2.5: 1,500 a day) is not subtracted.
 */
const PRICE: Record<string, { inCents: number; outCents: number; groundingCents: number }> = {
  "gemini-3.1-flash-lite": { inCents: 25, outCents: 150, groundingCents: 1.4 }, // $14 / 1k search queries
  "gemini-3.5-flash-lite": { inCents: 30, outCents: 250, groundingCents: 1.4 },
  "gemini-2.5-flash-lite": { inCents: 10, outCents: 40, groundingCents: 3.5 }, // $35 / 1k grounded prompts
};

interface GroundingChunkLike {
  web?: { uri?: string; title?: string };
}

export const geminiEngine: EngineClient = {
  engine: "gemini",
  available: () => Boolean(process.env.GEMINI_API_KEY),
  async ask(promptNl: string, ctx: AskContext): Promise<EngineAnswer> {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({
      model: MODEL(),
      systemInstruction: systemFor(ctx.business.country),
      tools: [{ googleSearch: {} } as unknown as Tool],
    });
    const gemini3 = MODEL().startsWith("gemini-3");
    const result = await withTimeout(
      model.generateContent({ contents: [{ role: "user", parts: [{ text: promptNl }] }], ...(gemini3 ? {} : { generationConfig: { temperature: 0.7 } }) }),
      ENGINE_TIMEOUT_MS,
      "gemini",
    );
    const response = result.response;
    const text = response.text();
    const candidate = response.candidates?.[0];
    const gm = (candidate?.groundingMetadata ?? {}) as { groundingChunks?: GroundingChunkLike[]; groundingChuncks?: GroundingChunkLike[]; webSearchQueries?: string[] };
    const chunks = gm.groundingChunks ?? gm.groundingChuncks ?? [];
    const citations: string[] = [];
    for (const c of chunks) {
      const uri = c.web?.uri;
      if (uri && !citations.includes(uri)) citations.push(uri);
    }
    const usage = response.usageMetadata;
    const inTok = usage?.promptTokenCount ?? 0;
    // Thinking tokens are billed as output; the v0.21 typings do not know the field.
    const outTok = (usage?.candidatesTokenCount ?? 0) + ((usage as { thoughtsTokenCount?: number } | undefined)?.thoughtsTokenCount ?? 0);
    const p = PRICE[MODEL()] ?? PRICE["gemini-3.1-flash-lite"]!;
    const searches = gm.webSearchQueries?.length ?? (chunks.length > 0 ? 1 : 0);
    const grounded = gemini3 ? searches * p.groundingCents : chunks.length > 0 ? p.groundingCents : 0;
    return {
      answerText: text.trim(),
      citations,
      costCents: Math.round(((inTok * p.inCents + outTok * p.outCents) / 1_000_000 + grounded) * 100) / 100,
    };
  },
};
