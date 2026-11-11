/**
 * Who the assistant names instead. For every recommendation question in a
 * scan: how many answers named the business, which other businesses were
 * named and how often, and which sites the answers cited. This is what an
 * owner needs to see next to "niet genoemd": AI noemt deze drie, en haalt
 * dat van deze sites.
 *
 * Names are read from the answer text: list items ("1. **Van der Berg** –
 * ...") and bold names. Position is never counted, only whether a name
 * appears in an answer.
 */
import type { Engine, Facts, Prompt, RecommendationSummary, Sample } from "../types";
import { mentionsBusiness, normalizeName } from "./extract";

/** Headings and labels that look like names in a list but are not businesses. */
const NOT_A_NAME = new Set(
  [
    "tip", "tips", "let op", "conclusie", "samenvatting", "openingstijden", "adres", "telefoon", "telefoonnummer", "website",
    "prijs", "prijzen", "reviews", "beoordeling", "waarom", "voordelen", "nadelen", "specialiteit", "specialiteiten", "locatie",
    "contact", "bereikbaarheid", "advies", "bronnen", "bron", "opties", "kosten", "ervaring", "service", "diensten",
  ].map((w) => w.toLowerCase()),
);

const MAX_NAME = 60;

function clean(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // markdown link -> text
    .replace(/[*_`#>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;,–—-]+$/, "")
    .trim();
}

function looksLikeName(s: string): boolean {
  if (s.length < 2 || s.length > MAX_NAME) return false;
  if (!/^[A-Z0-9À-Ý'‘’"“]/.test(s)) return false;
  if (s.endsWith("?")) return false;
  if (s.split(" ").length > 7) return false;
  return !NOT_A_NAME.has(s.toLowerCase());
}

/** The business names in one answer, in order, without duplicates. */
export function namedBusinesses(answerText: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const name = clean(raw);
    const key = normalizeName(name);
    if (!looksLikeName(name) || !key || seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  for (const line of answerText.split(/\r?\n/)) {
    const item = /^\s*(?:\d+[.)]|[-*•])\s+(.+)$/.exec(line);
    if (item) {
      const body = item[1]!.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
      const bold = /\*\*([^*]+)\*\*/.exec(body);
      // "Naam – omschrijving", "Naam: omschrijving", "Naam (Wijk)", "Naam, adres"
      push(bold ? bold[1]! : body.split(/\s[–—-]\s|:|\(|,/)[0]!);
      continue;
    }
    for (const m of line.matchAll(/\*\*([^*]{2,60})\*\*/g)) push(m[1]!);
  }
  return out;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export const QUOTE_MAX = 240;
export const QUOTES_PER_QUESTION = 3;
/** Same bound as the other patterns on AI text (extract.ts MATCH_LIMIT). */
const QUOTE_SCAN_LIMIT = 8000;

function plainSentences(answerText: string): string[] {
  return answerText
    .slice(0, QUOTE_SCAN_LIMIT)
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .split(/\r?\n+/)
    .flatMap((line) => line.replace(/^\s*(?:#{1,6}|\d+[.)]|[-*•])\s+/, "").split(/(?<=[.!?])\s+/))
    .map((t) => t.replace(/[*_`#>]/g, "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length >= 12);
}

function clipAtWord(text: string, max = QUOTE_MAX): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > 0 ? cut.slice(0, at) : cut).replace(/[\s,;:–—-]+$/, "")}…`;
}

/**
 * Up to three sentences that name the business and no other business seen in this
 * question's answers (AC-5: we never put AI's words about a competitor on the page).
 * The first sentence per engine comes first, then the rest in answer order.
 */
export function quotesFor(
  samples: { answerText: string; engine?: Engine }[],
  others: string[],
  facts: Pick<Facts, "name" | "place"> & Partial<Pick<Facts, "profile">>,
): { text: string; engine: Engine }[] {
  const otherKeys = others.map((o) => ` ${normalizeName(o)} `).filter((k) => k.trim());
  const firstPerEngine: { text: string; engine: Engine }[] = [];
  const rest: { text: string; engine: Engine }[] = [];
  const seen = new Set<string>();
  const engines = new Set<Engine>();
  for (const s of samples) {
    if (!s.engine) continue;
    for (const sentence of plainSentences(s.answerText)) {
      if (!mentionsBusiness(sentence, facts)) continue;
      const norm = ` ${normalizeName(sentence)} `;
      if (otherKeys.some((k) => norm.includes(k))) continue;
      const text = clipAtWord(sentence);
      if (seen.has(text)) continue;
      seen.add(text);
      if (!engines.has(s.engine)) {
        engines.add(s.engine);
        firstPerEngine.push({ text, engine: s.engine });
      } else rest.push({ text, engine: s.engine });
    }
  }
  return [...firstPerEngine, ...rest].slice(0, QUOTES_PER_QUESTION);
}

/** One summary per recommendation prompt that has answers in this scan. */
export function summarizeRecommendations(args: {
  samples: (Pick<Sample, "id" | "promptId" | "answerText" | "citations"> & Partial<Pick<Sample, "engine">>)[];
  prompts: (Pick<Prompt, "id" | "textNl" | "kind" | "intent" | "pool" | "probes"> & Partial<Pick<Prompt, "templateKey">>)[];
  /** sample id -> verdict; "named" on a recommendation sample means the business was named (compare.ts) */
  verdicts: Map<string, string>;
  facts: Pick<Facts, "name" | "place"> & Partial<Pick<Facts, "profile">>;
  /** how many other names / sources to keep per question */
  top?: number;
}): RecommendationSummary[] {
  const top = args.top ?? 5;
  const out: RecommendationSummary[] = [];
  for (const prompt of args.prompts) {
    if (prompt.kind !== "recommendation") continue;
    const samples = args.samples.filter((s) => s.promptId === prompt.id);
    if (!samples.length) continue;
    const others = new Map<string, { name: string; answers: number }>();
    const sources = new Map<string, { host: string; url: string; answers: number }>();
    let named = 0;
    for (const s of samples) {
      if (args.verdicts.get(s.id) === "named") named++;
      for (const name of namedBusinesses(s.answerText)) {
        if (mentionsBusiness(name, args.facts)) continue; // the business itself
        const key = normalizeName(name);
        const row = others.get(key) ?? { name, answers: 0 };
        row.answers++;
        others.set(key, row);
      }
      const hosts = new Set<string>();
      for (const url of s.citations) {
        const host = hostOf(url);
        if (!host || hosts.has(host)) continue;
        hosts.add(host);
        const row = sources.get(host) ?? { host, url, answers: 0 };
        row.answers++;
        sources.set(host, row);
      }
    }
    const key = prompt.templateKey ?? "";
    const family: RecommendationSummary["family"] = key.startsWith("online.alt.") || prompt.intent === "alternative" ? "alternative" : key.startsWith("online.rec.") ? "rec_category" : "rec_town";
    const byCount = <T extends { answers: number }>(a: T, b: T) => b.answers - a.answers;
    out.push({
      promptId: prompt.id,
      prompt: prompt.textNl,
      intent: prompt.intent ?? null,
      family,
      quotes: family === "rec_town" ? [] : quotesFor(samples, [...others.values()].map((o) => o.name), args.facts),
      pool: prompt.pool ?? "core",
      probe: prompt.probes[0] ?? null,
      answers: samples.length,
      named,
      others: [...others.values()].sort(byCount).slice(0, top),
      sources: [...sources.values()].sort(byCount).slice(0, top),
    });
  }
  const order = ["quality", "trust", "now", "specialty", "price", "place"];
  const rank = (s: RecommendationSummary) => (s.pool === "bank" ? 10 : 0) + (s.intent ? order.indexOf(s.intent) : 6);
  return out.sort((a, b) => rank(a) - rank(b));
}

/** Bank questions where the business is mostly not named: they move to the fixed set. */
export const PROMOTE_MAX_PER_SCAN = 2;
export const PROMOTE_MIN_ANSWERS = 3;

export function promotionCandidates(summaries: RecommendationSummary[]): string[] {
  return summaries
    .filter((s) => s.pool === "bank" && s.answers >= PROMOTE_MIN_ANSWERS && s.named / s.answers < 0.5)
    .sort((a, b) => a.named / a.answers - b.named / b.answers)
    .slice(0, PROMOTE_MAX_PER_SCAN)
    .map((s) => s.promptId);
}
