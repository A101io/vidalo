/**
 * The website assistant: what it may know and how it must speak. The web
 * app's /api/chat sends this as the system prompt to a model, or answers
 * from the same knowledge without one (mock mode). Everything the assistant
 * knows is derived from the copy, so a price or FAQ change reaches it in the
 * same commit; nothing is written twice.
 *
 * Rules the assistant carries (docs/MESSAGING.md, docs/CONTRACT.md,
 * playbook/LEGAL-NL.md §7): it is an AI and says so; it answers about Vidalo
 * only; it never claims control over what an AI assistant answers; it uses
 * none of the banned jargon; it points to hello@vidalo.io for anything it
 * cannot answer, and never asks for personal data.
 */
import type { CopyShape } from "../copy/index.js";
import { PRICES } from "../copy/index.js";
import type { Lang } from "../copy/index.js";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export const CHAT_LIMITS = { maxMessages: 12, maxChars: 600, maxReplyTokens: 350 } as const;

const BANNED = ["GEO", "AEO", "LLM", "prompt", "credits", "platform"];

/** Everything the assistant may state, as plain text, from the copy. */
export function buildKnowledge(copy: CopyShape, lang: Lang): string {
  const L = copy.landing;
  const nl = lang === "nl";
  const lines: string[] = [];
  lines.push(`${copy.brand}: ${copy.tagline}`);
  lines.push(nl ? "Wat Vidalo doet, in vier stappen:" : "What Vidalo does, in four steps:");
  for (const s of L.werkt.steps) lines.push(`- ${s.title}: ${s.body}`);
  lines.push(L.werkt.note);
  lines.push(nl ? "Prijzen (alle prijzen exclusief 21% btw):" : "Prices (all prices excluding 21% VAT):");
  lines.push(`- ${L.prijs.setup.name}: €${PRICES.setupEur} ${L.prijs.setup.unit}. ${L.prijs.setup.audience} ${L.prijs.setup.includes.join(" ")}`);
  lines.push(`- ${L.prijs.monitor.name}: €${PRICES.setupEur} ${L.prijs.setup.unit} + €${PRICES.monitorEurPerMonth} ${L.prijs.monitor.unit}. ${L.prijs.monitor.audience} ${L.prijs.monitor.includes.join(" ")}`);
  lines.push(L.prijs.sub);
  lines.push(nl ? "Betalen en opzeggen:" : "Paying and cancelling:");
  for (const f of copy.pricing.faq) lines.push(`- ${f.q} ${f.a}`);
  lines.push(nl ? "Veelgestelde vragen:" : "Frequently asked questions:");
  for (const f of L.vragen.items) lines.push(`- ${f.q} ${f.a}`);
  const notPromised = copy.legal.terms.sections.find((s) => /beloven|promise/i.test(s.h));
  if (notPromised) lines.push(`${notPromised.h}: ${notPromised.p.join(" ")}`);
  lines.push(nl ? "Wat de klant zelf doet: " + (L.vragen.items.find((i) => /zelf/i.test(i.q))?.a ?? "") : "");
  lines.push(`${nl ? "Bedrijf" : "Company"}: ${L.footer.legal}. ${nl ? "Contact" : "Contact"}: hello@vidalo.io.`);
  return lines.filter(Boolean).join("\n");
}

export function systemPrompt(copy: CopyShape, lang: Lang): string {
  const nl = lang === "nl";
  const rules = nl
    ? [
        "Je bent de assistent op de website van Vidalo. Je bent een AI en zegt dat als iemand het vraagt.",
        "Je beantwoordt alleen vragen over Vidalo, met de kennis hieronder. Weet je iets niet, zeg dat dan en verwijs naar hello@vidalo.io.",
        "Beloof nooit dat Vidalo bepaalt of verandert wat ChatGPT, Google AI, Copilot of een andere AI-assistent antwoordt. Vidalo herstelt bronnen; de assistenten beslissen zelf.",
        `Gebruik deze woorden nooit: ${BANNED.join(", ")}. Geen vakjargon, geen uitroeptekens, geen emoji.`,
        "Schrijf Nederlands, informeel (je), kort: hooguit negentig woorden, meestal minder. Noem bedragen altijd met 'excl. btw'.",
        "Vraag niet om persoonsgegevens. Geef geen juridisch, fiscaal of medisch advies.",
      ]
    : [
        "You are the assistant on Vidalo's website. You are an AI and say so when asked.",
        "You only answer questions about Vidalo, using the knowledge below. If you do not know, say so and point to hello@vidalo.io.",
        "Never promise that Vidalo decides or changes what ChatGPT, Google AI, Copilot or any other AI assistant answers. Vidalo fixes sources; the assistants decide for themselves.",
        `Never use these words: ${BANNED.join(", ")}. No jargon, no exclamation marks, no emoji.`,
        "Write English, informal, short: at most ninety words, usually fewer. Always state amounts as 'excl. VAT'.",
        "Do not ask for personal data. Give no legal, tax or medical advice.",
      ];
  return `${rules.join("\n")}\n\n${nl ? "KENNIS" : "KNOWLEDGE"}\n${buildKnowledge(copy, lang)}`;
}

const tokens = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4);

/**
 * Without a model: the closest FAQ or pricing answer by word overlap, or the
 * fallback. Deterministic, so it is testable and never invents a claim.
 */
export function mockAnswer(question: string, copy: CopyShape): { reply: string; matched: boolean } {
  const q = new Set(tokens(question));
  const L = copy.landing;
  if (q.size === 0) return { reply: copy.chat.fallback, matched: false };
  const priceWords = ["kost", "kosten", "prijs", "prijzen", "price", "cost", "costs", "tarief", "euro", "betalen"];
  if ([...q].some((w) => priceWords.includes(w)) || /€|\bkost\b/i.test(question)) {
    return { reply: `${L.prijs.setup.name}: €${PRICES.setupEur} ${L.prijs.setup.unit}. ${L.prijs.monitor.name}: €${PRICES.monitorEurPerMonth} ${L.prijs.monitor.unit}. ${L.prijs.exclVat}. ${L.prijs.sub}`, matched: true };
  }
  const candidates = [...copy.pricing.faq, ...L.vragen.items];
  let best: { score: number; a: string } | null = null;
  for (const c of candidates) {
    const words = [...new Set(tokens(`${c.q} ${c.a}`))];
    let score = 0;
    // A word counts when it appears, or when its first five letters start a
    // word in the answer ("opzeggen" finds "opzegtermijn"; Dutch compounds).
    for (const w of q) if (words.some((x) => x === w || (w.length >= 5 && x.startsWith(w.slice(0, 5))))) score++;
    if (score > 0 && (!best || score > best.score)) best = { score, a: c.a };
  }
  if (best) return { reply: best.a, matched: true };
  return { reply: copy.chat.fallback, matched: false };
}

/** With a model: the answer under the system prompt. Lives in core because that is where the openai dependency is. */
export async function modelAnswer(messages: ChatMessage[], system: string, opts: { apiKey: string; model?: string; timeoutMs?: number }): Promise<string> {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 20_000 });
  const completion = await client.chat.completions.create({
    model: opts.model || "gpt-4.1-mini",
    temperature: 0.3,
    max_tokens: CHAT_LIMITS.maxReplyTokens,
    messages: [{ role: "system", content: system }, ...messages],
  });
  const reply = completion.choices[0]?.message?.content?.trim();
  if (!reply) throw new Error("empty completion");
  return reply;
}

/** Request validation shared by the route and its test: shape and size, nothing else. */
export function validMessages(input: unknown): ChatMessage[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > CHAT_LIMITS.maxMessages) return null;
  const out: ChatMessage[] = [];
  for (const m of input) {
    if (!m || typeof m !== "object") return null;
    const { role, content } = m as { role?: unknown; content?: unknown };
    if ((role !== "user" && role !== "assistant") || typeof content !== "string") return null;
    const text = content.trim();
    if (!text || text.length > CHAT_LIMITS.maxChars) return null;
    out.push({ role, content: text });
  }
  if (out[out.length - 1]?.role !== "user") return null;
  return out;
}
