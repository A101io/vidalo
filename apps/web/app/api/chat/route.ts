import { NextResponse } from "next/server";
import { copyFor } from "@vidalo/core/copy";
import { mockAnswer, modelAnswer, systemPrompt, validMessages } from "@vidalo/core/chat";
import { env } from "@/lib/env";
import { requestBehindGate } from "@/lib/gate-state";

export const runtime = "nodejs";

/** Per isolate: 30 requests per 10 minutes per address. Enough for a conversation, not for a loop. */
const WINDOW_MS = 10 * 60 * 1000;
const PER_WINDOW = 30;
const hits = new Map<string, number[]>();
function limited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > PER_WINDOW;
}

/**
 * POST { messages, lang } → { reply, provider }. With OPENAI_API_KEY the
 * model answers under core/chat's system prompt; without it the reply comes
 * from the FAQ and pricing copy (provider "faq"). Nothing is stored: the
 * conversation lives in the visitor's tab only (the cookie statement says so).
 */
export async function POST(req: Request) {
  // Behind the launch gate the assistant is off: no widget, and no model calls for anyone without the preview cookie.
  if (requestBehindGate(req)) return NextResponse.json({ reply: "", provider: "off" }, { status: 404 });
  const ip = req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const body = (await req.json().catch(() => null)) as { messages?: unknown; lang?: unknown } | null;
  const lang = body?.lang === "en" ? "en" : "nl";
  const copy = copyFor(lang);
  if (limited(ip)) return NextResponse.json({ reply: copy.chat.rateLimited, provider: "limit" }, { status: 429 });
  const messages = validMessages(body?.messages);
  if (!messages) return NextResponse.json({ reply: copy.chat.error, provider: "invalid" }, { status: 400 });

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || env.mock) {
    const { reply } = mockAnswer(messages[messages.length - 1]!.content, copy);
    return NextResponse.json({ reply, provider: "faq" });
  }
  try {
    const reply = await modelAnswer(messages, systemPrompt(copy, lang), { apiKey, model: process.env.CHAT_MODEL?.trim() });
    return NextResponse.json({ reply, provider: "openai" });
  } catch (err) {
    console.error("chat.failed", { message: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ reply: copy.chat.error, provider: "error" }, { status: 502 });
  }
}
