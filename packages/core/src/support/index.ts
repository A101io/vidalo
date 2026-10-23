/**
 * support@vidalo.io auto-replies — Vidalo's configuration of the A101 kit's
 * support brain (./kit-support.ts, vendored) and the dependencies the
 * `/api/support-autoreply` route hands it.
 *
 * One knowledge file: `buildKnowledge` and `assistantRules` from ../chat are
 * what the website assistant reads, so a price or FAQ change reaches the mail
 * responder in the same commit. The relay in the Workspace mailbox
 * (A101/kit/adopt/support/support-inbox-relay.gs) sends whatever this returns
 * as `Vidalo Support <support@vidalo.io>`; docs/mail.md has the whole picture.
 */
import { assistantRules, buildKnowledge } from "../chat/index.js";
import { copyFor, type Lang } from "../copy/index.js";
import type { Db } from "../db/types.js";
import {
  handleRelayRequest,
  type RelayHandlerDeps,
  type SupportAccountContext,
  type SupportBrainConfig,
  type SupportModelProvider,
} from "./kit-support.js";

export * from "./kit-support.js";

/** The statutory line that closes every reply, in the reader's language, plus the support address. */
export function supportIdentityLine(lang: Lang): string {
  return `${copyFor(lang).landing.footer.legal} · support@vidalo.io`;
}

/**
 * What the content scan refuses over Vidalo's name, beyond the kit's generic
 * list. Each entry is a rule the website assistant already carries
 * (docs/MESSAGING.md, docs/CONTRACT.md): Vidalo never claims to decide or
 * change what an AI assistant answers, never uses the banned jargon, and is
 * not called Maicro any more.
 */
export const VIDALO_DENY_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["claim_controls_ai", /\b(bepaalt|bepalen|verandert|veranderen|garandeert|garanderen|stuurt|sturen)\b[^.]{0,60}\b(chatgpt|google ai|copilot|gemini|ai-assistent|ai-assistenten)\b/i],
  ["claim_controls_ai", /\b(controls?|changes?|guarantees?|decides?|steers?)\b[^.]{0,60}\b(what )?(chatgpt|google ai|copilot|gemini|ai assistants?)\b/i],
  ["banned_jargon", /\b(GEO|AEO|LLM)\b/],
  ["banned_jargon", /\b(prompts?|credits?)\b/i],
  ["claim_wrong_product_name", /\bmaicro\b/i],
];

export const VIDALO_SUPPORT_CONFIG: SupportBrainConfig = {
  brand: "Vidalo",
  productDescription:
    "an AI facts check for Dutch businesses: it checks what ChatGPT, Google AI and Copilot say about a business, finds wrong facts and their sources, publishes a facts page on the owner's domain and corrects the sources. Customers are Dutch business owners.",
  supportEmail: "support@vidalo.io",
  salesEmail: "hello@vidalo.io",
  identityLine: supportIdentityLine,
  knowledge: (lang) => buildKnowledge(copyFor(lang), lang),
  responseRules: [...assistantRules("nl"), ...assistantRules("en")].join("\n"),
  productNames: ["Vidalo"],
  ownDomains: ["vidalo.io", "a101.io"],
  allowedLinkHosts: ["vidalo.io", "www.vidalo.io"],
  denyPatterns: VIDALO_DENY_PATTERNS,
};

/** The OpenAI adapter the website assistant uses (../chat modelAnswer), in the kit's provider shape. */
export function openAiSupportProvider(opts: { apiKey: string; model?: string; timeoutMs?: number }): SupportModelProvider {
  return {
    async complete({ system, messages, maxTokens, temperature }) {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({ apiKey: opts.apiKey, timeout: opts.timeoutMs ?? 20_000 });
      const completion = await client.chat.completions.create({
        model: opts.model || "gpt-4.1-mini",
        temperature: temperature ?? 0.2,
        max_tokens: maxTokens,
        messages: [{ role: "system", content: system }, ...messages],
      });
      return { text: completion.choices[0]?.message?.content?.trim() ?? "" };
    },
  };
}

/**
 * The sender's business, when they own one, so the answer is written for
 * that account. Status and language only; never billing details, never a
 * token. A failed lookup is the kit's problem: it falls back to the prospect line.
 */
export async function vidaloAccountContext(db: Db, email: string): Promise<SupportAccountContext | null> {
  const business = await db.getBusinessByOwner({ email });
  if (!business) return null;
  return {
    line: `This sender owns the business "${business.name}" (${business.place}) on Vidalo; its status is "${business.status}". Answer for that account. Do not state anything about its invoices or payments; a colleague confirms those.`,
    language: business.language,
    matched: { businessId: business.id, status: business.status },
  };
}

export interface VidaloSupportEnv {
  /** SUPPORT_RELAY_SECRET; unset → 503 to everything. */
  secret: string | undefined;
  /** OPENAI_API_KEY; unset → every non-robot message escalates to a person. */
  apiKey: string | undefined;
  model?: string;
}

/** Everything `handleRelayRequest` needs, bound to this request's database. */
export function vidaloSupportDeps(db: Db, env: VidaloSupportEnv): RelayHandlerDeps {
  return {
    secret: env.secret,
    config: VIDALO_SUPPORT_CONFIG,
    provider: env.apiKey ? openAiSupportProvider({ apiKey: env.apiKey, model: env.model }) : null,
    lookupAccount: (email) => vidaloAccountContext(db, email),
    counters: (mail) => db.supportAutoreplyCounters(mail.from, mail.threadId ?? null),
    record: (row) => db.recordSupportAutoreply(row),
  };
}

/** The route in one call. */
export function handleVidaloSupportRelay(req: Request, db: Db, env: VidaloSupportEnv): Promise<Response> {
  return handleRelayRequest(req, vidaloSupportDeps(db, env));
}
