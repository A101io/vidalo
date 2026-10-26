/**
 * Google AI Overviews via SerpApi (engine=google, hl=nl, gl=nl).
 *
 * SerpApi returns an `ai_overview` block when Google showed one. It either
 * contains `text_blocks` + `references` inline, or only a `page_token`; in the
 * latter case we fetch engine=google_ai_overview with that token. When Google
 * shows no AI Overview at all we return an empty, skipped answer.
 */
import type { EngineClient, AskContext, EngineAnswer } from "./types";
import { ENGINE_TIMEOUT_MS } from "./types";

const SERPAPI_SEARCH_CENTS = 1; // ~ $10 / 1k searches on a mid plan; two calls when a page_token is needed

interface TextBlock {
  type?: string;
  snippet?: string;
  list?: TextBlock[];
  text_blocks?: TextBlock[];
  reference_indexes?: number[];
}

interface AiOverview {
  text_blocks?: TextBlock[];
  references?: { link?: string; title?: string; source?: string }[];
  page_token?: string;
  error?: string;
}

interface SerpResponse {
  ai_overview?: AiOverview;
  error?: string;
}

/** Flatten SerpApi text_blocks (paragraphs, lists, nested lists) into plain text. */
export function flattenTextBlocks(blocks: TextBlock[] | undefined, depth = 0): string {
  if (!blocks) return "";
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.snippet) lines.push(`${"  ".repeat(depth)}${depth > 0 ? "- " : ""}${b.snippet}`);
    if (b.list) lines.push(flattenTextBlocks(b.list, depth + 1));
    if (b.text_blocks) lines.push(flattenTextBlocks(b.text_blocks, depth));
  }
  return lines.filter(Boolean).join("\n");
}

async function serp(params: Record<string, string>): Promise<SerpResponse> {
  const url = new URL("https://serpapi.com/search.json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("api_key", process.env.SERPAPI_KEY!);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ENGINE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`serpapi ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as SerpResponse;
  } finally {
    clearTimeout(timer);
  }
}

export const googleAiEngine: EngineClient = {
  engine: "google_ai",
  available: () => Boolean(process.env.SERPAPI_KEY),
  async ask(promptNl: string, ctx: AskContext): Promise<EngineAnswer> {
    let cost = SERPAPI_SEARCH_CENTS;
    const country = ctx.business.country ?? "NL";
    const local: Record<string, string> = country === "NL" ? { hl: "nl", gl: "nl", google_domain: "google.nl" } : { hl: "en", gl: country.toLowerCase() };
    const first = await serp({ engine: "google", q: promptNl, ...local });
    let overview = first.ai_overview;
    if (overview?.page_token && !overview.text_blocks) {
      cost += SERPAPI_SEARCH_CENTS;
      const second = await serp({ engine: "google_ai_overview", page_token: overview.page_token });
      overview = second.ai_overview;
    }
    if (!overview || overview.error || !overview.text_blocks?.length) {
      return { answerText: "", citations: [], costCents: cost, skipped: true };
    }
    const text = flattenTextBlocks(overview.text_blocks);
    const citations = (overview.references ?? []).map((r) => r.link).filter((l): l is string => Boolean(l));
    return { answerText: text.trim(), citations: [...new Set(citations)], costCents: cost };
  },
};
