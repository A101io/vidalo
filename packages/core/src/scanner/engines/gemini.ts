/**
 * Gemini via @google/generative-ai with Google Search grounding. Citations are
 * the web URIs in groundingMetadata.groundingChunks.
 *
 * Note: the SDK's typings (v0.21) still describe the Gemini 1.5 tool shape
 * (`googleSearchRetrieval`) and misspell `groundingChuncks`; Gemini 2.x uses
 * `{ googleSearch: {} }`. We send the 2.x shape and read both spellings.
 */
import { GoogleGenerativeAI, type Tool } from "@google/generative-ai";
import type { EngineClient, AskContext, EngineAnswer } from "./types";
import { systemFor, ENGINE_TIMEOUT_MS } from "./types";
import { withTimeout } from "../util";

const MODEL = () => process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

/** USD cents per 1M tokens (flash pricing) + grounding per request. */
const IN_CENTS = 10;
const OUT_CENTS = 40;
const GROUNDING_CENTS = 3.5; // $35 / 1k grounded prompts

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
    const result = await withTimeout(
      model.generateContent({ contents: [{ role: "user", parts: [{ text: promptNl }] }], generationConfig: { temperature: 0.7 } }),
      ENGINE_TIMEOUT_MS,
      "gemini",
    );
    const response = result.response;
    const text = response.text();
    const candidate = response.candidates?.[0];
    const gm = (candidate?.groundingMetadata ?? {}) as { groundingChunks?: GroundingChunkLike[]; groundingChuncks?: GroundingChunkLike[] };
    const chunks = gm.groundingChunks ?? gm.groundingChuncks ?? [];
    const citations: string[] = [];
    for (const c of chunks) {
      const uri = c.web?.uri;
      if (uri && !citations.includes(uri)) citations.push(uri);
    }
    const usage = response.usageMetadata;
    const inTok = usage?.promptTokenCount ?? 0;
    const outTok = usage?.candidatesTokenCount ?? 0;
    const grounded = chunks.length > 0 ? GROUNDING_CENTS : 0;
    return {
      answerText: text.trim(),
      citations,
      costCents: Math.round(((inTok * IN_CENTS + outTok * OUT_CENTS) / 1_000_000 + grounded) * 100) / 100,
    };
  },
};
