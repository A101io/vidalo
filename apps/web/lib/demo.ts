/**
 * Demo content. Three things live here:
 *  1. `demoReport()`: a static, fictional ScanReport (Bakkerij De Vries, red)
 *     for /r/voorbeeld, matching docs/design-g/ResultG.dc.html.
 *  2. `demoGreyReport()`: the grey state (Polyvale Installatie: AI kent je
 *     niet) for /r/voorbeeld-grijs, matching ResultGGrey.dc.html.
 *  3. `seedDemo(db)`: in mock mode, creates the fictional owner business
 *     (login: eigenaar@bakkerijdevries.nl) with a finished free scan so the
 *     dashboard has content.
 */
import type { Db } from "@vidalo/core/db";
import type { CriteriumId, Engine, EngineStip, FactKey, Finding, ProductLineData, ScanReport } from "@vidalo/core/types";
import { ABSENT_LABEL, ABSENT_VALUE, NOT_FOUND_LABEL, PRESENT_VALUE } from "@vidalo/core/types";
import { ENGINE_NL_USAGE, engineCounts, overallStip } from "@vidalo/core/criteria";
import { PRODUCT_LINE_LIMITS } from "@vidalo/core/shared";
import { saveRunSummary, type PromptInput, type RunSummary } from "@vidalo/core/db";
import type { ProgressCell } from "@vidalo/core/progress";
import { prepareBusiness, runScan, groupBySeverity, createMockEngine } from "@vidalo/core/scanner";
import { ENGINES } from "@vidalo/core/types";
import { openFixesForScan } from "@vidalo/core/fixer";
import type { SourceRowData } from "./report";
import type { CopyShape } from "@vidalo/core/copy";

export const DEMO_OWNER_EMAIL = "eigenaar@bakkerijdevries.nl";
export const DEMO_SLUG = "bakkerij-de-vries-haarlem";
export const DEMO_IDS = { red: "voorbeeld", grey: "voorbeeld-grijs", online: "voorbeeld-online" } as const;

const checkedAt = "2026-10-07T12:32:00.000Z";
const base = { businessId: "demo", scanRunId: DEMO_IDS.red, sampleCount: 3, verdict: "wrong" as const, resolvedAt: null, evidenceBefore: null, evidenceAfter: null, status: "open" as const, firstSeenAt: checkedAt };

/** Seven questions: four wrong, one not found, two correct (ResultG board). */
export const demoFindings: Finding[] = [
  { ...base, id: "f-demo-1", factKey: "hours", subject: "6", engine: "chatgpt", wrongValue: "09:00-17:00", correctValue: "closed", frequency: 3, sourceUrl: "https://openingstijden.nl/haarlem/bakkerij-de-vries", sourceType: "directory_form", evidenceKind: "about", criterium: 3 },
  { ...base, id: "f-demo-2", factKey: "phone", subject: null, engine: "perplexity", wrongValue: "023 532 00 41", correctValue: "023 535 22 18", frequency: 2, sourceUrl: "https://www.telefoonboek.nl/bedrijven/haarlem/bakkerij-de-vries", sourceType: "third_party", evidenceKind: "about", criterium: 2 },
  { ...base, id: "f-demo-3", factKey: "payment", subject: "pin", engine: "google_ai", wrongValue: "alleen contant", correctValue: "yes", frequency: 3, sourceUrl: "https://bakkerijdevries.nl/praktisch", sourceType: "owned_website", evidenceKind: "about", criterium: 10 },
  { ...base, id: "f-demo-4", factKey: "existence", subject: null, engine: "chatgpt", wrongValue: "permanently_closed", correctValue: "open", frequency: 1, sourceUrl: "https://www.haarlemsdagblad.nl/heemstede/bakkerij-de-vries-sluit", sourceType: "other_entity", evidenceKind: "about", criterium: 11 },
  { ...base, id: "f-demo-5", factKey: "service", subject: "glutenvrij brood", engine: "google_ai", verdict: "not_found", wrongValue: NOT_FOUND_LABEL, correctValue: "ja, op bestelling", frequency: 3, sourceUrl: null, sourceType: "none", evidenceKind: "about", criterium: 6 },
];

export const demoEngineStips: EngineStip[] = [
  { engine: "chatgpt", stip: "rood", usage: 0.83, counts: true },
  { engine: "google_ai", stip: "oranje", usage: 0.6, counts: true },
  { engine: "perplexity", stip: "rood", usage: 0.15, counts: true },
];

export const demoCorrect: ScanReport["correct"] = [
  { prompt: "Is Bakkerij De Vries in Haarlem op zondag open?", engine: "google_ai", value: "zondag gesloten", raw: "closed", factKey: "hours", subject: "6" },
  { prompt: "Is Bakkerij De Vries in Haarlem op zondag open?", engine: "perplexity", value: "zondag gesloten", raw: "closed", factKey: "hours", subject: "6" },
  { prompt: "Wat is het telefoonnummer van Bakkerij De Vries in Haarlem?", engine: "chatgpt", value: "023 535 22 18", factKey: "phone", subject: null },
  { prompt: "Wat is het telefoonnummer van Bakkerij De Vries in Haarlem?", engine: "google_ai", value: "023 535 22 18", factKey: "phone", subject: null },
  { prompt: "Kan ik pinnen bij Bakkerij De Vries in Haarlem?", engine: "chatgpt", value: "ja", raw: "yes", factKey: "payment", subject: "pin" },
  { prompt: "Kan ik pinnen bij Bakkerij De Vries in Haarlem?", engine: "perplexity", value: "ja", raw: "yes", factKey: "payment", subject: "pin" },
  { prompt: "Bestaat Bakkerij De Vries in Haarlem nog?", engine: "google_ai", value: "open", raw: "open", factKey: "existence", subject: null },
  { prompt: "Bestaat Bakkerij De Vries in Haarlem nog?", engine: "perplexity", value: "open", raw: "open", factKey: "existence", subject: null },
  { prompt: "Wat is het adres van Bakkerij De Vries in Haarlem?", engine: "chatgpt", value: "Grote Houtstraat 112", factKey: "address", subject: null },
  { prompt: "Wat is het adres van Bakkerij De Vries in Haarlem?", engine: "google_ai", value: "Grote Houtstraat 112", factKey: "address", subject: null },
  { prompt: "Wat is het adres van Bakkerij De Vries in Haarlem?", engine: "perplexity", value: "Grote Houtstraat 112", factKey: "address", subject: null },
  { prompt: "Kan ik bij Bakkerij De Vries in Haarlem taarten bestellen?", engine: "chatgpt", value: "ja", raw: "yes", factKey: "service", subject: "taarten op bestelling" },
  { prompt: "Kan ik bij Bakkerij De Vries in Haarlem taarten bestellen?", engine: "google_ai", value: "ja", raw: "yes", factKey: "service", subject: "taarten op bestelling" },
  { prompt: "Kan ik bij Bakkerij De Vries in Haarlem taarten bestellen?", engine: "perplexity", value: "ja", raw: "yes", factKey: "service", subject: "taarten op bestelling" },
];

export function demoReport(): ScanReport {
  const findings = demoFindings;
  return {
    business: { id: "demo", slug: DEMO_SLUG, name: "Bakkerij De Vries", place: "Haarlem" },
    scanRunId: DEMO_IDS.red,
    kind: "free",
    comparedAs: "bakker",
    checkedAt,
    totalAnswers: 7 * 3 * 3,
    wrongAnswers: 9,
    notFoundAnswers: 3,
    visibility: "found",
    engines: [
      { engine: "chatgpt", correct: 2, wrong: 4, notFound: 1, skipped: false },
      { engine: "google_ai", correct: 5, wrong: 1, notFound: 1, skipped: false },
      { engine: "perplexity", correct: 4, wrong: 2, notFound: 1, skipped: false },
    ],
    findings,
    // One entry per answer, as a real report has (Google AI gets one sample, the others three): the "Alle antwoorden" counts read right.
    correct: demoCorrect.flatMap((c) => Array.from({ length: c.engine === "google_ai" ? 1 : 3 }, () => c)),
    stip: "rood",
    engineStips: demoEngineStips,
    findingsBySeverity: groupBySeverity(findings),
    instable: [],
    criteriaNotFound: [{ criterium: 6, engine: "google_ai", frequency: 3, sampleCount: 3 }],
    recommendations: [
      {
        promptId: "demo-rec-1",
        prompt: "Wat is de beste bakker in Haarlem?",
        intent: "quality",
        family: "rec_town",
        quotes: [],
        pool: "core",
        probe: "existence:beste",
        answers: 9,
        named: 1,
        others: [
          { name: "Bakkerij Van der Berg", answers: 7 },
          { name: "Brood & Zo", answers: 5 },
          { name: "Bakker Smit", answers: 3 },
        ],
        sources: [
          { host: "tripadvisor.nl", url: "https://www.tripadvisor.nl/", answers: 6 },
          { host: "telefoonboek.nl", url: "https://www.telefoonboek.nl/", answers: 2 },
        ],
      },
    ],
  };
}

export const DEMO_DOMAIN = "bakkerijdevries.nl";

// ---------------------------------------------------------------------------
// Grey: AI kent je niet (Polyvale Installatie, Haarlem)
// ---------------------------------------------------------------------------

const greyBase = { ...base, businessId: "demo-grijs", scanRunId: DEMO_IDS.grey, sourceUrl: null, sourceType: "none" as const, evidenceKind: "about" as const };
const nf = (id: string, factKey: Finding["factKey"], subject: string | null, engine: Engine, criterium: CriteriumId, correctValue: string, frequency = 3): Finding => ({ ...greyBase, id, factKey, subject, engine, verdict: "not_found", wrongValue: NOT_FOUND_LABEL, correctValue, frequency, criterium });

const demoGreyFindings: Finding[] = [
  { ...greyBase, id: "g-1", factKey: "service", subject: "warmtepompen", engine: "chatgpt", wrongValue: ABSENT_LABEL, correctValue: "yes", frequency: 3, evidenceKind: "recommendation", criterium: 6 },
  nf("g-2", "phone", null, "perplexity", 2, "023 528 10 10"),
  { ...greyBase, id: "g-3", factKey: "identity", subject: "Polyvale in Polen", engine: "google_ai", wrongValue: "een bedrijf in Polen", correctValue: "een ander bedrijf", frequency: 2, sourceType: "other_entity", criterium: 11 },
  nf("g-4", "area", "Heemstede", "chatgpt", 4, "ja"),
  nf("g-5", "urgency", null, "google_ai", 5, "ja"),
  nf("g-6", "credential", "warmtepompen", "perplexity", 12, "ja"),
  nf("g-8", "phone", null, "chatgpt", 2, "023 528 10 10"),
  nf("g-9", "area", "Heemstede", "perplexity", 4, "ja"),
  nf("g-10", "urgency", null, "perplexity", 5, "ja"),
  nf("g-11", "credential", "warmtepompen", "chatgpt", 12, "ja"),
];

export function demoGreyReport(): ScanReport {
  const findings = demoGreyFindings;
  return {
    business: { id: "demo-grijs", slug: "polyvale-installatie-haarlem", name: "Polyvale Installatie", place: "Haarlem" },
    scanRunId: DEMO_IDS.grey,
    kind: "free",
    checkedAt: "2026-10-07T13:10:00.000Z",
    totalAnswers: 18,
    wrongAnswers: 2,
    notFoundAnswers: 16,
    visibility: "unknown",
    engines: [
      { engine: "chatgpt", correct: 0, wrong: 0, notFound: 6, skipped: false },
      { engine: "google_ai", correct: 0, wrong: 2, notFound: 4, skipped: false },
      { engine: "perplexity", correct: 0, wrong: 0, notFound: 6, skipped: false },
    ],
    findings,
    correct: [],
    stip: "grijs",
    engineStips: [
      { engine: "chatgpt", stip: "grijs", usage: 0.83, counts: true },
      { engine: "google_ai", stip: "grijs", usage: 0.6, counts: true },
      { engine: "perplexity", stip: "grijs", usage: 0.15, counts: true },
    ],
    findingsBySeverity: groupBySeverity(findings),
    instable: [],
    criteriaNotFound: ([2, 4, 5, 12] as CriteriumId[]).flatMap((criterium) => (["chatgpt", "google_ai", "perplexity"] as Engine[]).map((engine) => ({ criterium, engine, frequency: 3, sampleCount: 3 }))),
  };
}

export const DEMO_GREY_DOMAIN = "polyvale.nl";

/** Source audit rows for the grey demo (ResultGGrey board). Real scans use the facts/business instead. */
export function demoGreySources(copy: CopyShape): SourceRowData[] {
  const S = copy.result.sources;
  return [
    { label: S.rows.website, status: S.demoWebsite, tone: "muted" },
    { label: S.rows.gbp, status: S.unclaimed, tone: "rood" },
    { label: S.rows.bingApple, status: S.missing, tone: "rood" },
    { label: S.rows.directories(12), status: S.demoDirectories, tone: "muted" },
    { label: S.rows.kvk, status: S.ok, tone: "groen" },
  ];
}

/**
 * Seven months of checks for the progress view: the free check, the first
 * full check, then monthly checks in which fewer answers are wrong, as
 * sources get fixed. The mock decides per question whether it is wrong, so a
 * lower rate only takes wrong questions away and the line really improves.
 */
const DEMO_HISTORY: { monthsAgo: number; kind: "free" | "baseline" | "monthly"; wrongPairRate: number }[] = [
  { monthsAgo: 7, kind: "free", wrongPairRate: 0.35 },
  { monthsAgo: 6, kind: "baseline", wrongPairRate: 0.35 },
  { monthsAgo: 5, kind: "monthly", wrongPairRate: 0.3 },
  { monthsAgo: 4, kind: "monthly", wrongPairRate: 0.24 },
  { monthsAgo: 3, kind: "monthly", wrongPairRate: 0.2 },
  { monthsAgo: 2, kind: "monthly", wrongPairRate: 0.12 },
  { monthsAgo: 1, kind: "monthly", wrongPairRate: 0.06 },
  { monthsAgo: 0, kind: "monthly", wrongPairRate: 0.02 },
];

function monthsBack(n: number, now = new Date()): string {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - n);
  d.setUTCDate(7);
  d.setUTCHours(6, 0, 0, 0);
  return (d > now ? now : d).toISOString();
}

/** Mock-mode owner business with seven months of finished checks. Idempotent. */
export async function seedDemo(db: Db): Promise<void> {
  if (await db.getBusiness(DEMO_SLUG)) return;
  const { business } = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
  await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ownerEmail: DEMO_OWNER_EMAIL, ownerUserId: "mock-user-1", plan: "monitor", status: "trial", anniversaryDay: 7 });
  const runDates = new Map<string, string>();
  const dated = new Set<string>();
  const resolvedDated = new Set<string>();
  for (const h of DEMO_HISTORY) {
    const engines = h.kind === "free" ? undefined : ENGINES;
    const clients = (engines ?? ["chatgpt", "google_ai", "perplexity"]).map((e) => createMockEngine(e, { wrongPairRate: h.wrongPairRate }));
    const report = await runScan({ businessId: business.id, kind: h.kind, engines, samplesPerPrompt: 3, clients, db });
    const at = monthsBack(h.monthsAgo);
    await db.updateScanRun(report.scanRunId, { startedAt: at, finishedAt: at });
    runDates.set(report.scanRunId, at);
    // MemDb hands out its own rows, so the demo can date the findings like the checks (mock only).
    if (db.kind === "mem") {
      for (const f of await db.listFindings(business.id)) {
        if (!dated.has(f.id)) {
          f.firstSeenAt = at;
          dated.add(f.id);
        }
        // The scan itself resolves a finding it now sees answered right; date that to this check.
        if (f.status === "resolved" && !resolvedDated.has(f.id)) {
          f.resolvedAt = at;
          resolvedDated.add(f.id);
        }
      }
    }
  }
  if (db.kind === "mem") {
    // A finding the latest check no longer saw was fixed at the next check after the last one it was in.
    const order = [...runDates.entries()].sort((a, b) => a[1].localeCompare(b[1]));
    const latestRun = order[order.length - 1]![0];
    const open = (await db.listFindings(business.id)).filter((f) => f.status !== "resolved");
    for (const f of open) {
      if (f.scanRunId === latestRun) continue;
      const i = order.findIndex(([id]) => id === f.scanRunId);
      f.status = "resolved";
      f.resolvedAt = order[i + 1]?.[1] ?? order[order.length - 1]![1];
    }
    for (const f of open.filter((x) => x.scanRunId === latestRun && x.verdict === "wrong").slice(0, 2)) f.status = "fixing";
  }
  await db.upsertChannel({ businessId: business.id, type: "facts_page", name: "Feitenpagina", externalId: null, url: `https://feiten.${business.domain ?? "bakkerijdevries.nl"}`, status: "pending" });
  await db.upsertChannel({ businessId: business.id, type: "gbp", name: "Google Bedrijfsprofiel", externalId: null, url: null, status: "pending" });
  await db.upsertChannel({ businessId: business.id, type: "bing", name: "Bing Places", externalId: null, url: null, status: "synced", lastSyncedAt: new Date().toISOString() });
  if (db.kind === "mem") {
    // The demo owner has proven ownership (what /api/google/callback does) and confirmed the facts (what
    // /app/gegevens does), so the owner's buttons work in mock mode and the Google sync has something to compare.
    await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ownerVerifiedAt: new Date().toISOString(), ownerVerifiedVia: "mock" });
    const provisional = await db.latestFacts(business.id);
    await db.insertFacts(
      business.id,
      {
        ...provisional!,
        address: "Grote Houtstraat 112",
        postcode: "2011 SR",
        phone: "+31235352218",
        website: "https://bakkerijdevries.nl",
        openStatus: "open",
        hours: [
          ...([0, 1, 2, 3, 4] as const).map((day) => ({ day, open: "08:00", close: "18:00", closed: false })),
          { day: 5 as const, open: "08:00", close: "17:00", closed: false },
          { day: 6 as const, open: null, close: null, closed: true },
        ],
        servicesYes: ["taarten op bestelling", "glutenvrij brood op bestelling"],
        paymentMethods: ["pin", "contant"],
        notConfusedWith: ["Bakkerij De Vries in Heemstede"],
      },
      { provisional: false, verifiedAt: new Date().toISOString() },
    );
    // What the understanding step read for the demo bakery (the scans above stored an empty door profile): shown on /app/gegevens.
    const read = (await db.getBusiness(DEMO_SLUG))?.profileAuto;
    if (read) await db.setAutoProfile(business.id, { ...read, offer: "brood, gebak en taarten op bestelling", audience: "buurtbewoners in Haarlem", category: "bakkerij", basis: ["google", "website"], grounded: true });
    // The fix round the worker runs after a check: one fix per open finding, with its evidence, the owner mail,
    // the republished facts page and a sync of every channel. The Google sync then holds its change for the owner.
    const latest = [...runDates.entries()].sort((a, b) => a[1].localeCompare(b[1])).pop()?.[0];
    if (latest) await openFixesForScan(latest);
    await seedDemoLines(db, business.id);
  }
}

// ---------------------------------------------------------------------------
// Product lines (feature 006): two fictional lines of the demo bakery, three monthly runs per (line, market).
// Written through the Db methods, so the pages show them without BE-03/BE-04. Every name here is made up.
// ---------------------------------------------------------------------------

type LineKey = "speltbrood" | "kerststol";
interface LineSeed {
  key: LineKey;
  versions: ProductLineData[];
}
const SPELT_V2: ProductLineData = {
  name: "Haarlems Speltbrood",
  category: "speltbrood",
  useCases: ["ontbijt", "lunch"],
  markets: ["NL", "BE"],
  specs: [{ label: "Gewicht", value: "800 g" }, { label: "Houdbaarheid", value: "4 dagen" }],
  certificates: [{ name: "EKO", number: "EKO-0000", validUntil: "2027-06-30" }],
  outlets: [{ market: "NL", name: "Versmarkt Haarlem", url: "https://versmarkt-haarlem.example" }, { market: "BE", name: "Broodhuys Gent", url: "https://broodhuys-gent.example" }],
  replaces: ["Speltbrood Classic"],
  replacedBy: null,
};
const DEMO_LINES: LineSeed[] = [
  { key: "speltbrood", versions: [{ ...SPELT_V2, certificates: [{ name: "EKO", number: null, validUntil: "2027-06-30" }] }, SPELT_V2] },
  {
    key: "kerststol",
    versions: [
      {
        name: "Grote Houtstraat Kerststol",
        category: "kerststol",
        useCases: ["kerstontbijt"],
        markets: ["NL"],
        specs: [{ label: "Gewicht", value: "1 kg" }],
        certificates: [],
        outlets: [{ market: "NL", name: "Bakkerij De Vries", url: "https://bakkerijdevries.nl" }],
        replaces: [],
        replacedBy: null,
      },
    ],
  },
];
const LINE_ENGINES: Engine[] = ["chatgpt", "google_ai", "perplexity"];
const LINE_SAMPLES: Record<string, number> = { chatgpt: 5, perplexity: 5, google_ai: 1 };
/** Months back of the three runs, oldest first. */
const LINE_MONTHS = [2, 1, 0] as const;
/** Recommendation counts per (line|market) and month back (index 0 = 2 months ago): the contract numbers are the last entry. */
const RECOMMEND: Record<string, { named: number; answers: number; others: { name: string; answers: number }[] }[]> = {
  "speltbrood|NL": [1, 2, 3].map((named) => ({ named, answers: 10, others: [{ name: "Korenhoek Brood", answers: 4 }, { name: "Speltsmid", answers: 3 }] })),
  "speltbrood|BE": [0, 0, 0].map((named) => ({ named, answers: 5, others: [{ name: "Gentse Speltbakkerij", answers: 3 }] })),
  "kerststol|NL": [2, 3, 4].map((named) => ({ named, answers: 5, others: [{ name: "Stollenbakker Noord", answers: 1 }] })),
};

type PlannedPrompt = PromptInput & { spec?: string };
function linePrompts(key: LineKey, market: string, v: ProductLineData, brand: string): PlannedPrompt[] {
  const nl = market === "NL";
  const named = v.name.toLowerCase().includes(brand.toLowerCase());
  const of = named ? "" : nl ? ` van ${brand}` : ` by ${brand}`;
  const country = nl ? "Nederland" : market === "BE" ? "Belgium" : market;
  const out: PlannedPrompt[] = [];
  for (const use of v.useCases) {
    out.push({ category: "existence", textNl: nl ? `Welk ${v.category} is het beste voor ${use}?` : `Which ${v.category} is best for ${use}?`, probes: [`existence:${use}`], active: true, kind: "recommendation", criterium: 6, templateKey: "line.rec.use" });
  }
  for (const sp of v.specs) {
    out.push({ category: "spec", textNl: nl ? `Welke ${sp.label.toLowerCase()} heeft ${v.name}${of}?` : `What ${sp.label.toLowerCase()} does ${v.name}${of} have?`, probes: [`spec:${sp.label}`], active: true, kind: "about", criterium: 13, templateKey: "line.spec", spec: sp.label });
  }
  for (const c of v.certificates) {
    out.push({ category: "certificate", textNl: nl ? `Is ${v.name}${of} ${c.name}-gecertificeerd?` : `Is ${v.name}${of} ${c.name} certified?`, probes: [`certificate:${c.name}`], active: true, kind: "about", criterium: 14, templateKey: "line.cert" });
  }
  if (v.outlets.some((o) => o.market === market)) {
    out.push({ category: "outlet", textNl: nl ? `Waar koop ik ${v.name}${of} in ${country}?` : `Where can I buy ${v.name}${of} in ${country}?`, probes: [`outlet:${market}`], active: true, kind: "about", criterium: 15, templateKey: "line.outlet" });
  }
  for (const old of v.replaces) {
    out.push({ category: "successor", textNl: nl ? `Wat is de opvolger van ${old}${of}?` : `What is the successor of ${old}${of}?`, probes: [`successor:${old}`], active: true, kind: "about", criterium: 16, templateKey: "line.successor" });
  }
  void key;
  return out;
}

export async function seedDemoLines(db: Db, businessId: string): Promise<void> {
  const business = await db.getBusiness(businessId);
  if (!business) return;
  if ((await db.listProductLines(businessId)).length) return;
  const monthAt = (n: number) => monthsBack(n);
  const lineIds = new Map<LineKey, string>();
  for (const l of DEMO_LINES) {
    let id: string | null = null;
    for (const data of l.versions) {
      const r = await db.saveProductLine({ businessId, productLineId: id, data, maxActive: PRODUCT_LINE_LIMITS.lines });
      if (!r.ok) throw new Error(`seedDemoLines: ${r.reason}`);
      id = r.line.id;
    }
    lineIds.set(l.key, id!);
  }
  // Findings are made at the run that saw them; the plan says where a wrong answer sits (key|market|engine|prompt category:spec).
  const wrongPlan: Record<string, { value: string; correct: string; wrongSamples: number[] }> = {
    "speltbrood|NL|chatgpt|spec:Gewicht": { value: "500 g", correct: "800 g", wrongSamples: [3, 3, 4] },
    "kerststol|NL|perplexity|spec:Gewicht": { value: "750 g", correct: "1 kg", wrongSamples: [3, 0, 0] },
    "speltbrood|BE|google_ai|outlet:BE": { value: "Gentse Warenwinkel", correct: "Broodhuys Gent", wrongSamples: [0, 1, 1] },
  };
  const seen = new Map<string, string>(); // plan key -> finding id
  const evidence = new Map<string, { before: string | null; after: string | null }>();
  const runsOf = new Map<string, string[]>();
  for (const l of DEMO_LINES) {
    const id = lineIds.get(l.key)!;
    const current = l.versions[l.versions.length - 1]!;
    for (const market of current.markets) {
      const promptsPlanned = linePrompts(l.key, market, current, business.name);
      const prompts = await db.insertPrompts(businessId, promptsPlanned, { productLineId: id, market });
      const pk = `${l.key}|${market}`;
      for (const [mi, month] of LINE_MONTHS.entries()) {
        // The first run of a line with two versions was asked with version 1 (same questions, the certificate had no number yet).
        const version = l.versions.length > 1 && mi === 0 ? 1 : l.versions.length;
        const at = monthAt(month);
        const run = await db.createScanRun({ businessId, kind: "monthly", engines: LINE_ENGINES, samplesPerPrompt: 5, status: "done", productLineId: id, productLineVersion: version, market });
        await db.updateScanRun(run.id, { startedAt: at, finishedAt: at, status: "done" });
        runsOf.set(pk, [...(runsOf.get(pk) ?? []), run.id]);
        const cells: ProgressCell[] = [];
        const rec = RECOMMEND[pk]![mi]!;
        for (const [pi, p] of prompts.entries()) {
          const planned = promptsPlanned[pi]!;
          for (const engine of LINE_ENGINES) {
            const n = LINE_SAMPLES[engine]!;
            const planKey = `${pk}|${engine}|${p.probes[0]}`;
            const plan = wrongPlan[planKey];
            const wrongN = Math.min(n, plan?.wrongSamples[mi] ?? 0);
            const rows = Array.from({ length: n }, (_, i) => {
              const wrong = i < wrongN;
              const isRec = p.kind === "recommendation";
              const named = isRec && rec.named > 0 && i % Math.max(1, Math.floor(n / Math.max(1, rec.named))) === 0;
              const value = isRec ? (named ? PRESENT_VALUE : ABSENT_VALUE) : wrong ? plan!.value : (plan?.correct ?? valueFor(planned, current));
              const factKey: FactKey = isRec ? "existence" : (p.category as FactKey);
              const text = isRec ? (named ? `${business.name} wordt genoemd.` : `Genoemd worden onder meer ${rec.others[0]!.name}.`) : `${p.textNl.replace(/\?$/, "")}: ${value}.`;
              return { wrong, value, factKey, text };
            });
            const stored = await db.insertSamples(
              rows.map((r) => ({ scanRunId: run.id, promptId: p.id, engine, answerText: r.text, citations: r.wrong ? ["https://broodwiki.example/speltbrood"] : [], costCents: 1 })),
            );
            await db.insertClaims(stored.map((smp, i) => ({ sampleId: smp.id, factKey: rows[i]!.factKey, subject: p.probes[0]!.split(":")[1] ?? null, value: rows[i]!.value, confidence: 0.9, otherEntity: false, rawQuote: rows[i]!.text })));
            const wrongCount = rows.filter((r) => (p.kind === "recommendation" ? r.value === ABSENT_VALUE : r.wrong)).length;
            cells.push({ promptId: p.id, engine, criterium: (p.criterium ?? 6) as CriteriumId, kind: p.kind ?? "about", verdict: wrongCount * 2 >= n && wrongCount > 0 ? "wrong" : "correct" });
            if (plan && wrongN > 0) {
              const [f] = await db.upsertFindings([
                {
                  businessId,
                  scanRunId: run.id,
                  factKey: p.category as FactKey,
                  subject: p.probes[0]!.split(":")[1] ?? null,
                  engine,
                  wrongValue: plan.value,
                  correctValue: plan.correct,
                  frequency: wrongN,
                  sampleCount: n,
                  sourceUrl: plan.value === "Gentse Warenwinkel" ? null : "https://broodwiki.example/speltbrood",
                  sourceType: plan.value === "Gentse Warenwinkel" ? "none" : "third_party",
                  evidenceBefore: evidence.get(planKey)?.before ?? stored[0]!.id,
                  criterium: p.criterium as CriteriumId,
                },
              ]);
              seen.set(planKey, f!.id);
              evidence.set(planKey, { before: evidence.get(planKey)?.before ?? stored[0]!.id, after: null });
            } else if (plan && seen.has(planKey) && wrongN === 0) {
              evidence.set(planKey, { before: evidence.get(planKey)?.before ?? null, after: stored[0]!.id });
            }
          }
        }
        const engineStips: EngineStip[] = LINE_ENGINES.map((engine) => {
          const mine = cells.filter((c) => c.engine === engine);
          const bad = mine.some((c) => c.verdict === "wrong" && c.kind === "about");
          const red = pk === "speltbrood|NL" && mi === 0 && engine === "chatgpt";
          return { engine, stip: red ? "rood" : bad ? "oranje" : "groen", usage: ENGINE_NL_USAGE[engine], counts: engineCounts(engine) };
        });
        const stip = overallStip(engineStips);
        const questions = prompts.filter((p) => p.kind !== "recommendation");
        const correctQ = questions.filter((p) => cells.filter((c) => c.promptId === p.id).every((c) => c.verdict === "correct")).length;
        const summary: RunSummary = { v: 1, stip, answered: questions.length, correct: correctQ, snapshot: { scanRunId: run.id, kind: "monthly", checkedAt: at, engines: LINE_ENGINES, stip, engineStips, cells }, recommend: structuredClone(rec) };
        await saveRunSummary(db, run.id, summary);
      }
    }
  }
  // Dating, status and fixes of the three findings (MemDb hands out its own rows, as in seedDemo).
  const all = await db.listFindings(businessId, undefined, { productLineId: lineIds.get("speltbrood")! });
  const kerst = await db.listFindings(businessId, undefined, { productLineId: lineIds.get("kerststol")! });
  const rows = new Map([...all, ...kerst].map((f) => [f.id, f]));
  const held = rows.get(seen.get("speltbrood|NL|chatgpt|spec:Gewicht")!)!;
  held.firstSeenAt = monthAt(2);
  await db.updateFindingStatus(held.id, "fixing");
  await db.insertFix({ findingId: held.id, action: "email", target: "redactie@broodwiki.example", scheduledAt: monthAt(0), recheckAt: new Date(Date.now() + 30 * 86_400_000).toISOString(), evidence: { sourceType: "third_party", verdict: "wrong", wrong: "500 g", correct: "800 g", path: "email" } });
  const fixed = rows.get(seen.get("kerststol|NL|perplexity|spec:Gewicht")!)!;
  fixed.firstSeenAt = monthAt(2);
  const after = evidence.get("kerststol|NL|perplexity|spec:Gewicht")?.after ?? null;
  await db.markFindingResolved(fixed.id, after);
  fixed.resolvedAt = monthAt(1);
  await db.insertFix({ findingId: fixed.id, action: "email", target: "info@broodwiki.example", scheduledAt: monthAt(2), sentAt: monthAt(2), resolvedAt: monthAt(1), evidence: { sourceType: "third_party", verdict: "wrong", wrong: "750 g", correct: "1 kg", path: "email" } });
  const open = rows.get(seen.get("speltbrood|BE|google_ai|outlet:BE")!)!;
  open.firstSeenAt = monthAt(1);
}

/** The owner's value a correct answer repeats. */
function valueFor(p: PlannedPrompt, v: ProductLineData): string {
  if (p.category === "spec") return v.specs.find((s) => s.label === p.spec)?.value ?? "";
  if (p.category === "certificate") return "yes";
  if (p.category === "outlet") return v.outlets.find((o) => p.probes[0]!.endsWith(`:${o.market}`))?.name ?? "";
  return PRESENT_VALUE;
}

// ---------------------------------------------------------------------------
// Online: a fictional provider without a shop front (feature 001). Every name here is made up.
// ---------------------------------------------------------------------------

export const DEMO_ONLINE_DOMAIN = "vloedlijn-audio.example";
const onlineBase = { ...base, businessId: "demo-online", scanRunId: DEMO_IDS.online, sampleCount: 5 };

const demoOnlineFindings: Finding[] = [
  // One of fifteen answers calls the business another kind of business: criterium 11, orange.
  { ...onlineBase, id: "o-1", factKey: "identity", subject: "kind", engine: "perplexity", wrongValue: "other", correctValue: "same", frequency: 1, sourceUrl: null, sourceType: "none", evidenceKind: "about", criterium: 11 },
];

export function demoOnlineReport(): ScanReport {
  const findings = demoOnlineFindings;
  const answers = 30;
  return {
    profile: { mode: "online", offer: "achtergrondmuziek voor hotels en horeca", audience: "hotels en horeca", category: "aanbieder van achtergrondmuziek", source: "auto" },
    business: { id: "demo-online", slug: "vloedlijn-audio-rotterdam", name: "Vloedlijn Audio", place: "Rotterdam" },
    scanRunId: DEMO_IDS.online,
    kind: "free",
    checkedAt,
    totalAnswers: 11,
    wrongAnswers: 1,
    notFoundAnswers: 0,
    visibility: "found",
    engines: [
      { engine: "chatgpt", correct: 5, wrong: 0, notFound: 0, skipped: false },
      { engine: "google_ai", correct: 1, wrong: 0, notFound: 0, skipped: false },
      { engine: "perplexity", correct: 4, wrong: 1, notFound: 0, skipped: false },
    ],
    findings,
    correct: [
      ...Array.from({ length: 5 }, () => ({ prompt: "Wat doet Vloedlijn Audio?", engine: "chatgpt" as Engine, value: "hetzelfde soort bedrijf", raw: "same", factKey: "identity" as const, subject: "kind" })),
      { prompt: "Wat doet Vloedlijn Audio?", engine: "google_ai" as Engine, value: "hetzelfde soort bedrijf", raw: "same", factKey: "identity" as const, subject: "kind" },
      ...Array.from({ length: 4 }, () => ({ prompt: "Wat doet Vloedlijn Audio?", engine: "perplexity" as Engine, value: "hetzelfde soort bedrijf", raw: "same", factKey: "identity" as const, subject: "kind" })),
    ],
    stip: "oranje",
    engineStips: [
      { engine: "chatgpt", stip: "groen", usage: 0.83, counts: true },
      { engine: "google_ai", stip: "groen", usage: 0.6, counts: true },
      { engine: "perplexity", stip: "oranje", usage: 0.15, counts: true },
    ],
    findingsBySeverity: groupBySeverity(findings),
    instable: [],
    criteriaNotFound: [],
    asked: [
      { factKey: "identity", subject: "kind", engine: "chatgpt", kind: "about", samples: 5, checked: true },
      { factKey: "identity", subject: "kind", engine: "google_ai", kind: "about", samples: 1, checked: true },
      { factKey: "identity", subject: "kind", engine: "perplexity", kind: "about", samples: 5, checked: true },
    ],
    recommendations: [
      {
        promptId: "demo-online-1",
        prompt: "Welke aanbieder van achtergrondmuziek is goed voor hotels en horeca?",
        intent: "specialty",
        family: "rec_category",
        quotes: [
          { text: "Vloedlijn Audio levert achtergrondmuziek voor hotels en horeca, met speellijsten per tijdstip van de dag.", engine: "chatgpt" },
          { text: "Vloedlijn Audio is een kleine aanbieder die zich op horeca richt.", engine: "perplexity" },
        ],
        pool: "core",
        probe: null,
        answers: answers / 2,
        named: 4,
        others: [
          { name: "Klankbord Collectief", answers: 11 },
          { name: "Muziekwolk Zakelijk", answers: 9 },
          { name: "Sfeertoon Studio", answers: 6 },
          { name: "Tikkeltoon", answers: 3 },
          { name: "Zachtstem Radio", answers: 2 },
        ],
        sources: [],
      },
      {
        promptId: "demo-online-2",
        prompt: "Wat is een alternatief voor Vloedlijn Audio?",
        intent: "alternative",
        family: "alternative",
        quotes: [],
        pool: "core",
        probe: null,
        answers: answers / 2,
        named: 0,
        others: [
          { name: "Klankbord Collectief", answers: 8 },
          { name: "Muziekwolk Zakelijk", answers: 5 },
        ],
        sources: [],
      },
    ],
  };
}
