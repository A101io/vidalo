/**
 * The question library (ADR-0004, brief Amendment A3). Every scan writes, per question template, how
 * often it was asked and how often an AI system gave a usable answer. Online checks prefer templates
 * proven for their category and never ask retired ones. The ledger holds templates and counts only:
 * never a filled question, a fact value or a business name (compliance B2, C-14).
 *
 * The numbers below are the only place that decides proven / retired. They count DIFFERENT businesses,
 * not answers (security S-23): one visitor running many free checks on one business is one business.
 */
// Load the prompts barrel first: profile.ts and index.ts import each other, and entering through this file would see one half-built.
import "./index";
import type { Db, LibraryRow, QuestionUseInput } from "../db/types";
import { scanLang } from "../shared/country";
import type { SampleVerdict } from "../scanner/compare";
import { normalizeName, parseProbe, type PromptLike } from "../scanner/extract";
import { namedBusinesses } from "../scanner/recommendations";
import type { BusinessProfile, Claim, Facts, Prompt, ProfileMode, QuestionFamily, Sample } from "../types";
import { ONLINE_TEMPLATES } from "./online";
import { ONLINE_TEMPLATES_EN } from "./online.en";
import { familyOf, type PickTemplates, type QuestionLibrary } from "./profile";
import { sanitizeSlot } from "./slots";

/** A template is proven for a category once this many different businesses were asked it and the share is high enough. */
export const PROVEN_MIN_BUSINESSES = 5;
export const PROVEN_MIN_SHARE = 0.6;
/** It is retired for a category only after this many different businesses were asked it and the share is below the line. */
export const RETIRE_MIN_BUSINESSES = 10;
export const RETIRE_BELOW_SHARE = 0.3;

export type LibraryStatus = "proven" | "trial" | "retired";

/** Exact integer comparison against the share thresholds (no float edge at 0.6 / 0.3). */
const SHARE_SCALE = 10;
const atLeast = (row: { asked: number; usable: number }, share: number) => row.usable * SHARE_SCALE >= row.asked * Math.round(share * SHARE_SCALE);
const below = (row: { asked: number; usable: number }, share: number) => row.usable * SHARE_SCALE < row.asked * Math.round(share * SHARE_SCALE);

/**
 * A row that names its mode and family is only ever retired when it is an online recommendation or
 * alternative template: the fixed questions feed the dot, and door and visit questions are never picked
 * or retired by the library (AC-A2, AC-3). A bare {asked, usable, businesses} is judged as a candidate.
 */
export function libraryStatus(row: { asked: number; usable: number; businesses: number; mode?: ProfileMode; family?: QuestionFamily }): LibraryStatus {
  if (row.asked <= 0) return "trial";
  const retirable = (row.mode === undefined || row.mode === "online") && (row.family === undefined || RETIRABLE.has(row.family));
  if (retirable && row.businesses >= RETIRE_MIN_BUSINESSES && below(row, RETIRE_BELOW_SHARE)) return "retired";
  if (row.businesses >= PROVEN_MIN_BUSINESSES && atLeast(row, PROVEN_MIN_SHARE)) return "proven";
  return "trial";
}

/**
 * Is this stored answer usable? The opposite is the report's "geen bruikbaar antwoord".
 * recommendation: the business is named, or the answer names any business at all.
 * about: a judged verdict (correct, wrong, another business, not found) or a value that could not be checked.
 */
export function isUsable(args: { prompt: PromptLike; verdict: SampleVerdict | undefined; answerText: string; claims: Claim[] }): boolean {
  const { prompt, verdict, answerText, claims } = args;
  if (prompt.kind === "recommendation") return verdict === "named" || namedBusinesses(answerText).length > 0;
  if (verdict === "correct" || verdict === "wrong" || verdict === "other_entity" || verdict === "not_found") return true;
  const wanted = new Set(prompt.probes.map((p) => parseProbe(p).factKey));
  return claims.some((c) => wanted.has(c.factKey) && c.value.trim() !== "");
}

const RETIRABLE: ReadonlySet<QuestionFamily> = new Set(["rec_category", "alternative"]);
export { RETIRABLE as RETIRABLE_FAMILIES };

/**
 * n templates of a family for an online check. When the category has at least n proven templates of the
 * family, the n with the highest usable share (ties: built-in order); otherwise the first n built-ins
 * that are not retired. Other families have one template each and feed the dot: never picked or retired.
 */
export function pickTemplates<T extends { key: string; family: QuestionFamily }>(family: QuestionFamily, n: number, builtIns: T[], rows: LibraryRow[]): T[] {
  if (!RETIRABLE.has(family)) return builtIns.slice(0, n);
  const byKey = new Map(rows.filter((r) => r.mode === "online").map((r) => [r.templateKey, r]));
  const status = (t: T): LibraryStatus => {
    const r = byKey.get(t.key);
    return r ? libraryStatus(r) : "trial";
  };
  const open = builtIns.filter((t) => status(t) !== "retired");
  const share = (t: T) => {
    const r = byKey.get(t.key)!;
    return r.usable / r.asked;
  };
  const proven = open.filter((t) => status(t) === "proven");
  if (proven.length >= n) {
    const order = new Map(builtIns.map((t, i) => [t.key, i]));
    return [...proven].sort((a, b) => share(b) - share(a) || order.get(a.key)! - order.get(b.key)!).slice(0, n);
  }
  return open.slice(0, n);
}

/** The key the ledger files a question under. */
export function templateKeyOf(prompt: Pick<Prompt, "kind" | "category" | "intent" | "templateKey">, mode: ProfileMode): string {
  return prompt.templateKey ?? `${mode}.${prompt.kind ?? "about"}.${prompt.category}${prompt.intent ? "." + prompt.intent : ""}`;
}

/**
 * The text the ledger keeps for a question. Online: the code-held template with its {slots}. Door and
 * visit: a generic label built from the key's own parts only. Today's door questions embed owner-entered
 * values verbatim (policies, services, credentials, prices, the kind of business), so none of the question's
 * text is kept, not even with name and place replaced (compliance B2).
 */
export function templateTextOf(prompt: Pick<Prompt, "kind" | "category" | "intent" | "templateKey">, facts: Pick<Facts, "country">): string {
  const key = prompt.templateKey ?? "";
  if (key.startsWith("online.")) {
    const set = scanLang(facts.country) === "nl" ? ONLINE_TEMPLATES : ONLINE_TEMPLATES_EN;
    const t = set.find((x) => x.key === key) ?? ONLINE_TEMPLATES.find((x) => x.key === key);
    if (t) return t.text;
  }
  const what = prompt.kind === "recommendation" ? "Aanbevelingsvraag" : "Vraag";
  return `${what} over ${prompt.category}${prompt.intent ? ` (${prompt.intent})` : ""}`;
}

/** The ledger's category for a business: the profile's category, cleaned, and never one that contains the business's name. */
export function libraryCategory(profile: Pick<BusinessProfile, "category"> | null, facts: Pick<Facts, "name">): string {
  const clean = profile?.category ? sanitizeSlot(profile.category, "category") : null;
  if (!clean) return "onbekend";
  const name = normalizeName(facts.name);
  return name && normalizeName(clean).includes(name) ? "onbekend" : clean;
}

/**
 * One row per template key per scan: the samples of every prompt sharing the key are summed.
 * Only stored samples count; an answer that was never obtained (engine down) is not "asked".
 */
export function useRows(args: {
  scanRunId: string;
  profile: BusinessProfile | null;
  facts: Facts;
  prompts: Prompt[];
  samples: Sample[];
  claimsPerSample: Claim[][];
  verdicts: Map<string, SampleVerdict>;
}): QuestionUseInput[] {
  const { scanRunId, profile, facts, prompts, samples, claimsPerSample, verdicts } = args;
  const mode: ProfileMode = profile?.mode ?? "door";
  const category = libraryCategory(profile, facts);
  const promptById = new Map(prompts.map((p) => [p.id, p]));
  const rows = new Map<string, QuestionUseInput>();
  samples.forEach((s, i) => {
    const prompt = promptById.get(s.promptId);
    if (!prompt) return;
    const key = templateKeyOf(prompt, mode);
    let row = rows.get(key);
    if (!row) {
      row = { scanRunId, category, mode, templateKey: key, templateNl: templateTextOf(prompt, facts), family: familyOf(prompt), intent: prompt.intent ?? null, asked: 0, usable: 0 };
      rows.set(key, row);
    }
    row.asked++;
    if (isUsable({ prompt, verdict: verdicts.get(s.id), answerText: s.answerText, claims: claimsPerSample[i] ?? [] })) row.usable++;
  });
  return [...rows.values()];
}

/** The QuestionLibrary the question chooser takes, bound to the ledger rows of one category. */
export function libraryFromRows(rows: LibraryRow[]): QuestionLibrary {
  const pick: PickTemplates = (family, n, builtIns) => pickTemplates(family, n, builtIns, rows);
  return { pick };
}

/** Reads the category's ledger for an online check; a failing read means the built-in order (never fails the scan). */
export async function loadLibrary(db: Pick<Db, "questionLibrary">, profile: BusinessProfile | null, facts: Pick<Facts, "name">): Promise<QuestionLibrary | undefined> {
  if (profile?.mode !== "online") return undefined;
  try {
    return libraryFromRows(await db.questionLibrary({ category: libraryCategory(profile, facts), mode: "online" }));
  } catch {
    return undefined;
  }
}

const retirableKey = (r: LibraryRow) => r.mode === "online" && RETIRABLE.has(r.family);

/**
 * After a scan: write its rows, then log `library.retired` once for every online recommendation or
 * alternative template this scan moved into "retired". A failure is logged as `library.record_failed`
 * (no error text) and never reaches the caller.
 */
export async function recordScanUse(db: Db, businessId: string, scanRunId: string, build: () => QuestionUseInput[]): Promise<void> {
  try {
    const rows = build();
    if (!rows.length) return;
    const { category } = rows[0]!;
    const before = (await db.questionLibrary({ category, mode: "online" })).filter(retirableKey);
    await db.recordQuestionUse(rows);
    const wasRetired: Set<string> = new Set(before.filter((r) => libraryStatus(r) === "retired" && !wasRetired.has(r.templateKey)).map((r) => r.templateKey));
    const after = (await db.questionLibrary({ category, mode: "online" })).filter(retirableKey);
    for (const r of after) {
      if (libraryStatus(r) === "retired") await db.logEvent(null, "library.retired", { category: r.category, mode: r.mode, templateKey: r.templateKey });
    }
  } catch {
    try {
      await db.logEvent(businessId, "library.record_failed", { scanRunId });
    } catch {
      /* the ledger is not on the scan's critical path */
    }
  }
}
