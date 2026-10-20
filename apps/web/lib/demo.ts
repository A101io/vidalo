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
import type { CriteriumId, Engine, EngineStip, Finding, ScanReport } from "@vidalo/core/types";
import { ABSENT_LABEL, NOT_FOUND_LABEL } from "@vidalo/core/types";
import { prepareBusiness, runScan, groupBySeverity, createMockEngine } from "@vidalo/core/scanner";
import { ENGINES } from "@vidalo/core/types";
import type { SourceRowData } from "./report";
import type { CopyShape } from "@vidalo/core/copy";

export const DEMO_OWNER_EMAIL = "eigenaar@bakkerijdevries.nl";
export const DEMO_SLUG = "bakkerij-de-vries-haarlem";
export const DEMO_IDS = { red: "voorbeeld", grey: "voorbeeld-grijs" } as const;

const checkedAt = "2026-10-07T12:32:00.000Z";
const base = { businessId: "demo", scanRunId: DEMO_IDS.red, sampleCount: 3, verdict: "wrong" as const, resolvedAt: null, evidenceBefore: null, evidenceAfter: null, status: "open" as const, firstSeenAt: checkedAt };

/** Seven questions: four wrong, one not found, two correct (ResultG board). */
export const demoFindings: Finding[] = [
  { ...base, id: "f-demo-1", factKey: "hours", subject: "6", engine: "chatgpt", wrongValue: "09:00-17:00", correctValue: "closed", frequency: 3, sourceUrl: "https://openingstijden.nl/haarlem/bakkerij-de-vries", sourceType: "directory_form", evidenceKind: "about", criterium: 3 },
  { ...base, id: "f-demo-2", factKey: "phone", subject: null, engine: "copilot", wrongValue: "023 532 00 41", correctValue: "023 535 22 18", frequency: 2, sourceUrl: "https://www.telefoonboek.nl/bedrijven/haarlem/bakkerij-de-vries", sourceType: "third_party", evidenceKind: "about", criterium: 2 },
  { ...base, id: "f-demo-3", factKey: "payment", subject: "pin", engine: "google_ai", wrongValue: "alleen contant", correctValue: "yes", frequency: 3, sourceUrl: "https://bakkerijdevries.nl/praktisch", sourceType: "owned_website", evidenceKind: "about", criterium: 10 },
  { ...base, id: "f-demo-4", factKey: "existence", subject: null, engine: "chatgpt", wrongValue: "permanently_closed", correctValue: "open", frequency: 1, sourceUrl: "https://www.haarlemsdagblad.nl/heemstede/bakkerij-de-vries-sluit", sourceType: "other_entity", evidenceKind: "about", criterium: 11 },
  { ...base, id: "f-demo-5", factKey: "service", subject: "glutenvrij brood", engine: "google_ai", verdict: "not_found", wrongValue: NOT_FOUND_LABEL, correctValue: "ja, op bestelling", frequency: 3, sourceUrl: null, sourceType: "none", evidenceKind: "about", criterium: 6 },
];

export const demoEngineStips: EngineStip[] = [
  { engine: "chatgpt", stip: "rood", usage: 0.83, counts: true },
  { engine: "google_ai", stip: "oranje", usage: 0.6, counts: true },
  { engine: "copilot", stip: "rood", usage: 0.15, counts: true },
];

export const demoCorrect: ScanReport["correct"] = [
  { prompt: "Is Bakkerij De Vries in Haarlem op zondag open?", engine: "google_ai", value: "zondag gesloten", raw: "closed", factKey: "hours", subject: "6" },
  { prompt: "Is Bakkerij De Vries in Haarlem op zondag open?", engine: "copilot", value: "zondag gesloten", raw: "closed", factKey: "hours", subject: "6" },
  { prompt: "Wat is het telefoonnummer van Bakkerij De Vries in Haarlem?", engine: "chatgpt", value: "023 535 22 18", factKey: "phone", subject: null },
  { prompt: "Wat is het telefoonnummer van Bakkerij De Vries in Haarlem?", engine: "google_ai", value: "023 535 22 18", factKey: "phone", subject: null },
  { prompt: "Kan ik pinnen bij Bakkerij De Vries in Haarlem?", engine: "chatgpt", value: "ja", raw: "yes", factKey: "payment", subject: "pin" },
  { prompt: "Kan ik pinnen bij Bakkerij De Vries in Haarlem?", engine: "copilot", value: "ja", raw: "yes", factKey: "payment", subject: "pin" },
  { prompt: "Bestaat Bakkerij De Vries in Haarlem nog?", engine: "google_ai", value: "open", raw: "open", factKey: "existence", subject: null },
  { prompt: "Bestaat Bakkerij De Vries in Haarlem nog?", engine: "copilot", value: "open", raw: "open", factKey: "existence", subject: null },
  { prompt: "Wat is het adres van Bakkerij De Vries in Haarlem?", engine: "chatgpt", value: "Grote Houtstraat 112", factKey: "address", subject: null },
  { prompt: "Wat is het adres van Bakkerij De Vries in Haarlem?", engine: "google_ai", value: "Grote Houtstraat 112", factKey: "address", subject: null },
  { prompt: "Wat is het adres van Bakkerij De Vries in Haarlem?", engine: "copilot", value: "Grote Houtstraat 112", factKey: "address", subject: null },
  { prompt: "Kan ik bij Bakkerij De Vries in Haarlem taarten bestellen?", engine: "chatgpt", value: "ja", raw: "yes", factKey: "service", subject: "taarten op bestelling" },
  { prompt: "Kan ik bij Bakkerij De Vries in Haarlem taarten bestellen?", engine: "google_ai", value: "ja", raw: "yes", factKey: "service", subject: "taarten op bestelling" },
  { prompt: "Kan ik bij Bakkerij De Vries in Haarlem taarten bestellen?", engine: "copilot", value: "ja", raw: "yes", factKey: "service", subject: "taarten op bestelling" },
];

export function demoReport(): ScanReport {
  const findings = demoFindings;
  return {
    business: { id: "demo", slug: DEMO_SLUG, name: "Bakkerij De Vries", place: "Haarlem" },
    scanRunId: DEMO_IDS.red,
    kind: "free",
    checkedAt,
    totalAnswers: 7 * 3 * 3,
    wrongAnswers: 9,
    notFoundAnswers: 3,
    visibility: "found",
    engines: [
      { engine: "chatgpt", correct: 2, wrong: 4, notFound: 1, skipped: false },
      { engine: "google_ai", correct: 5, wrong: 1, notFound: 1, skipped: false },
      { engine: "copilot", correct: 4, wrong: 2, notFound: 1, skipped: false },
    ],
    findings,
    correct: demoCorrect,
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
  nf("g-2", "phone", null, "copilot", 2, "023 528 10 10"),
  { ...greyBase, id: "g-3", factKey: "identity", subject: "Polyvale in Polen", engine: "google_ai", wrongValue: "een bedrijf in Polen", correctValue: "een ander bedrijf", frequency: 2, sourceType: "other_entity", criterium: 11 },
  nf("g-4", "area", "Heemstede", "chatgpt", 4, "ja"),
  nf("g-5", "urgency", null, "google_ai", 5, "ja"),
  nf("g-6", "credential", "warmtepompen", "copilot", 12, "ja"),
  nf("g-8", "phone", null, "chatgpt", 2, "023 528 10 10"),
  nf("g-9", "area", "Heemstede", "copilot", 4, "ja"),
  nf("g-10", "urgency", null, "copilot", 5, "ja"),
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
      { engine: "copilot", correct: 0, wrong: 0, notFound: 6, skipped: false },
    ],
    findings,
    correct: [],
    stip: "grijs",
    engineStips: [
      { engine: "chatgpt", stip: "grijs", usage: 0.83, counts: true },
      { engine: "google_ai", stip: "grijs", usage: 0.6, counts: true },
      { engine: "copilot", stip: "grijs", usage: 0.15, counts: true },
    ],
    findingsBySeverity: groupBySeverity(findings),
    instable: [],
    criteriaNotFound: ([2, 4, 5, 12] as CriteriumId[]).flatMap((criterium) => (["chatgpt", "google_ai", "copilot"] as Engine[]).map((engine) => ({ criterium, engine, frequency: 3, sampleCount: 3 }))),
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
    const clients = (engines ?? ["chatgpt", "google_ai", "copilot"]).map((e) => createMockEngine(e, { wrongPairRate: h.wrongPairRate }));
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
}
