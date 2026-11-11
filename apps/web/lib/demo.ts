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
    // The fix round the worker runs after a check: one fix per open finding, with its evidence, the owner mail,
    // the republished facts page and a sync of every channel. The Google sync then holds its change for the owner.
    const latest = [...runDates.entries()].sort((a, b) => a[1].localeCompare(b[1])).pop()?.[0];
    if (latest) await openFixesForScan(latest);
  }
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
