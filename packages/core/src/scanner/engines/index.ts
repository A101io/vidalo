/**
 * Engine registry. Real engines are used when their keys exist and
 * VIDALO_MOCK is not "1"; otherwise every engine is the deterministic mock.
 */
import { ENGINES, type Engine } from "../../types";
import { chatgptEngine } from "./chatgpt";
import { geminiEngine } from "./gemini";
import { perplexityEngine } from "./perplexity";
import { googleAiEngine } from "./google_ai";
import { copilotEngine } from "./copilot";
import { claudeEngine } from "./claude";
import { createMockEngine } from "./mock";
import type { EngineClient } from "./types";

export type { EngineClient, AskContext, EngineAnswer } from "./types";
export { createMockEngine } from "./mock";
export { setCopilotAdapter } from "./copilot";

const REAL: Record<Engine, EngineClient> = {
  chatgpt: chatgptEngine,
  gemini: geminiEngine,
  perplexity: perplexityEngine,
  google_ai: googleAiEngine,
  copilot: copilotEngine,
  claude: claudeEngine,
};

/** True when engines must not call any external API. */
export function isMockEngines(): boolean {
  return process.env.VIDALO_MOCK === "1";
}

/**
 * Pick the client for an engine. In mock mode, or when the real client has no
 * key, the mock is returned (so a scan always produces evidence offline). Pass
 * `{ strict: true }` to get the real client even when unavailable, so the
 * caller can report it as skipped.
 */
export function getEngine(engine: Engine, opts: { strict?: boolean } = {}): EngineClient {
  if (isMockEngines()) return createMockEngine(engine);
  const real = REAL[engine];
  if (real.available() || opts.strict) return real;
  return createMockEngine(engine);
}

/**
 * Clients for a list of engines (default: all). In real mode an engine without
 * a key is returned as-is (available() false) so runScan can mark it skipped;
 * in mock mode every engine is available.
 */
export function getEngines(engines: Engine[] = ENGINES): EngineClient[] {
  return engines.map((e) => (isMockEngines() ? createMockEngine(e) : REAL[e]));
}

/** Engines that have keys configured (or all, in mock mode). */
export function availableEngines(): Engine[] {
  return getEngines().filter((c) => c.available()).map((c) => c.engine);
}
