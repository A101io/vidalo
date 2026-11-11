/**
 * The questions this business's free check asks and the ones a full check asks this month, built the way
 * loadPrompts builds them for a business without stored prompts. The free report's "Dit was een steekproef"
 * block (11 Nov 2026) counts and names the difference, so the number on the page is the real set, not an estimate.
 */
import type { Db } from "../db";
import { ENGINE_LABEL, type Business, type Engine, type Facts } from "../types";
import type { CopyShape } from "../copy";
import { withCountry } from "../shared/country";
import { applies, familyOf, freeScanPrompts, generatePrompts, promptsForFullScan, selectQuestions, type PromptTemplate } from "../prompts";
import { loadLibrary } from "../prompts/library";
import { effectiveProfile, withProfile } from "./understand";

export async function questionSets(
  db: Pick<Db, "questionLibrary">,
  business: Pick<Business, "country" | "sector"> & Parameters<typeof effectiveProfile>[0],
  stored: Facts,
  now = new Date(),
): Promise<{ free: PromptTemplate[]; full: PromptTemplate[] }> {
  const profile = effectiveProfile(business);
  const facts = withProfile(withCountry(stored, business), profile);
  const sector = business.sector;
  if (profile?.mode === "online") {
    const library = await loadLibrary(db, profile, facts);
    return {
      free: selectQuestions({ profile, facts, kind: "free", sector, library }),
      full: selectQuestions({ profile, facts, kind: "baseline", sector, library }),
    };
  }
  const mine = (list: PromptTemplate[]) => (profile?.mode === "visit" ? list.filter((p) => applies(familyOf(p), profile, facts)) : list);
  return { free: mine(freeScanPrompts(facts, { sector })), full: mine(promptsForFullScan(generatePrompts(facts, { sector }), now)) };
}

export interface MoreQuestionsView {
  h2: string;
  body: string;
  topics: string[];
  examples: string[];
  cta: string;
}

/**
 * The free report's "De gratis controle stelde 6 van de 35 vragen": the business's own full set
 * (questionSets above) against what its free check asked. The report page and the free report mail both show it. Topics are the fact kinds and the
 * recommendation questions not asked; examples are real questions from that set, a recommendation one first.
 */
export function moreQuestionsView(sets: { free: PromptTemplate[]; full: PromptTemplate[] }, engines: Engine[], copy: CopyShape): MoreQuestionsView | null {
  const asked = new Set(sets.free.map((p) => p.textNl));
  const notAsked = sets.full.filter((p) => !asked.has(p.textNl));
  if (!notAsked.length) return null;
  const M = copy.result.more;
  const about = notAsked.filter((p) => p.kind !== "recommendation");
  const recs = notAsked.filter((p) => p.kind === "recommendation");
  const topics = [...new Set(about.map((p) => copy.factKey[p.category]))];
  if (recs.length) topics.push(M.recommendations(recs.length));
  const pick = [recs.find((p) => p.pool === "core"), about.find((p) => p.pool === "core"), recs.find((p) => p.pool === "bank"), about[0], recs[0]];
  const examples = [...new Set(pick.flatMap((p) => (p ? [p.textNl] : [])))].slice(0, 3);
  // The two the free check asked first, then the rest.
  const order: Engine[] = ["chatgpt", "google_ai", "gemini", "perplexity", "claude", "copilot"];
  const names = [...engines].sort((a, b) => order.indexOf(a) - order.indexOf(b)).map((e) => ENGINE_LABEL[e]);
  const enginesText = names.length > 1 ? `${names.slice(0, -1).join(", ")} ${copy.report.and} ${names[names.length - 1]}` : (names[0] ?? "");
  return { h2: M.h2(sets.free.length, sets.full.length), body: M.body(sets.free.filter((p) => p.kind !== "recommendation").length, sets.free.filter((p) => p.kind === "recommendation").length, enginesText), topics, examples, cta: M.cta(sets.full.length) };
}
