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
import type { Facts, Prompt, RecommendationSummary, Sample } from "../types";
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

/** One summary per recommendation prompt that has answers in this scan. */
export function summarizeRecommendations(args: {
  samples: Pick<Sample, "id" | "promptId" | "answerText" | "citations">[];
  prompts: Pick<Prompt, "id" | "textNl" | "kind" | "intent" | "pool" | "probes">[];
  /** sample id -> verdict; "correct" on a recommendation sample means the business was named */
  verdicts: Map<string, string>;
  facts: Pick<Facts, "name" | "place">;
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
      if (args.verdicts.get(s.id) === "correct") named++;
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
    const byCount = <T extends { answers: number }>(a: T, b: T) => b.answers - a.answers;
    out.push({
      promptId: prompt.id,
      prompt: prompt.textNl,
      intent: prompt.intent ?? null,
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
