/**
 * BE-05 (feature 001): the question library. The usable rule, the ledger written after a scan, proven and
 * retired templates, and the file Julian reads. Thresholds count DIFFERENT businesses (security S-23).
 *
 * The ledger cases run on MemDb and, when TEST_DATABASE_URL carries supabase/migrations, on PgDb.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { createDb, withMockDb, type Db } from "../src/db";
import type { LibraryRow } from "../src/db/types";
import { libraryMarkdown } from "../src/cli/library";
import { PROVEN_MIN_BUSINESSES, RETIRE_MIN_BUSINESSES, isUsable, libraryCategory, libraryStatus, pickTemplates, templateKeyOf, templateTextOf, useRows } from "../src/prompts/library";
import { onlineQuestions } from "../src/prompts";
import { loadPrompts, runScan } from "../src/scanner";
import type { EngineClient } from "../src/scanner/engines/types";
import type { BusinessProfile, Claim, Facts, Prompt, QuestionFamily } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";

const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "question_use, google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";
const NOW = new Date("2026-03-15T12:00:00.000Z");
const CATEGORY = "aanbieder van achtergrondmuziek";

let pg: Db | undefined;
let raw: ReturnType<typeof postgres> | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      raw ??= postgres(PG_URL, { max: 1, onnotice: () => {} });
      await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
      pg ??= createDb(PG_URL);
      return pg;
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
  await raw?.end();
});

const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  mode: "online", offer: "achtergrondmuziek voor winkels", audience: "winkeliers", category: CATEGORY, competitors: [], website: null,
  confidence: "high", basis: ["website"], source: "auto", grounded: true, decidedAt: "2026-11-11T08:00:00.000Z", ...over,
});

const onlineFacts = (name: string, p: Partial<BusinessProfile> = {}, over: Partial<Facts> = {}): Facts =>
  sampleFacts({ name, place: "Utrecht", address: null, postcode: null, phone: null, hours: [], servicesYes: [], servicesNo: [], prices: [], policies: [], paymentMethods: [], profile: profile(p), ...over });

/** The owner's profile is set, so runScan uses it as it is (no understanding step, no network). */
async function addBusiness(db: Db, facts: Facts) {
  const b = await db.upsertBusiness({ name: facts.name, place: facts.place });
  await db.insertFacts(b.id, { ...facts, businessId: b.id }, { provisional: false, verifiedAt: "2026-11-11T08:00:00.000Z" });
  if (facts.profile) await db.setOwnerProfile(b.id, { ...facts.profile, source: "owner" });
  return b;
}

const LIST = "1. Mood Media\n2. Soundtrack Your Brand";
const NOTHING = "Daar heb ik geen informatie over.";

/** An engine that names businesses for the templates `usable` says so, and knows nothing otherwise. */
const client = (usable: (key: string) => boolean): EngineClient => ({
  engine: "chatgpt",
  available: () => true,
  ask: async (_text, ctx) => {
    const key = ctx.prompt?.templateKey ?? "";
    if (ctx.prompt?.kind === "recommendation") return { answerText: usable(key) ? LIST : NOTHING, citations: [], costCents: 0 };
    return { answerText: "Ja, dat bedrijf bestaat en is actief.", citations: [], costCents: 0 };
  },
});

/** One full online scan of a new business: its own questions, asked 2 times each. */
async function scanOnline(db: Db, name: string, usable: (key: string) => boolean, p: Partial<BusinessProfile> = {}, kind: "baseline" | "free" = "baseline") {
  const facts = onlineFacts(name, p);
  const b = await addBusiness(db, facts);
  const chosen = await loadPrompts(db, b.id, facts, kind, null, undefined, NOW, facts.profile);
  await runScan({ businessId: b.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 2, firstSamples: 2, clients: [client(usable)], db, promptIds: chosen.map((x) => x.id) });
  return { business: b, facts, chosen };
}

const recKeys = (ps: Pick<Prompt, "templateKey">[]) => ps.map((p) => p.templateKey).filter((k): k is string => !!k && k.startsWith("online.rec.")).sort();
const libRow = async (db: Db, key: string, category = CATEGORY) => (await db.questionLibrary({ category, mode: "online" })).find((r) => r.templateKey === key);

// ---------------------------------------------------------------------------------------------
describe("libraryStatus: thresholds count different businesses", () => {
  const row = (asked: number, usable: number, businesses: number) => ({ asked, usable, businesses });
  it("is proven at 5 businesses and a share of at least 6 in 10", () => {
    expect(libraryStatus(row(10, 6, 5))).toBe("proven");
    expect(libraryStatus(row(10, 5, 5))).toBe("trial");
    expect(libraryStatus(row(1000, 1000, PROVEN_MIN_BUSINESSES - 1))).toBe("trial");
  });
  it("is retired at 10 businesses and a share below 3 in 10, not before", () => {
    expect(libraryStatus(row(100, 29, 10))).toBe("retired");
    expect(libraryStatus(row(100, 30, 10))).toBe("trial");
    expect(libraryStatus(row(1000, 0, RETIRE_MIN_BUSINESSES - 1))).toBe("trial");
  });
  it("a high number of answers from one business moves nothing", () => {
    expect(libraryStatus(row(500, 0, 1))).toBe("trial");
    expect(libraryStatus(row(500, 500, 1))).toBe("trial");
  });
  it("nothing asked is a trial", () => expect(libraryStatus(row(0, 0, 0))).toBe("trial"));
  it("a fixed question, and anything asked of a shop or a visit business, is never retired", () => {
    expect(libraryStatus({ asked: 100, usable: 0, businesses: 40, mode: "online", family: "what" })).toBe("trial");
    expect(libraryStatus({ asked: 100, usable: 0, businesses: 40, mode: "door", family: "rec_town" })).toBe("trial");
    expect(libraryStatus({ asked: 100, usable: 0, businesses: 40, mode: "online", family: "alternative" })).toBe("retired");
    expect(libraryStatus({ asked: 100, usable: 0, businesses: 40, mode: "online", family: "rec_category" })).toBe("retired");
  });
});

describe("isUsable", () => {
  const rec = { category: "existence" as const, probes: ["existence:beste"], textNl: "Welke x is het beste?", kind: "recommendation" as const };
  const about = { category: "phone" as const, probes: ["phone"], textNl: "Wat is het telefoonnummer?", kind: "about" as const };
  const claim = (factKey: Claim["factKey"], value: string): Claim => ({ sampleId: "s", factKey, value, subject: null, confidence: 0.9, otherEntity: false, rawQuote: "" });
  it("a recommendation answer is usable when it names the business or any business", () => {
    expect(isUsable({ prompt: rec, verdict: "named", answerText: NOTHING, claims: [] })).toBe(true);
    expect(isUsable({ prompt: rec, verdict: "not_named", answerText: LIST, claims: [] })).toBe(true);
    expect(isUsable({ prompt: rec, verdict: "not_named", answerText: NOTHING, claims: [] })).toBe(false);
  });
  it("an about answer is usable when judged, or when it carried a value that could not be checked", () => {
    for (const v of ["correct", "wrong", "other_entity", "not_found"] as const) expect(isUsable({ prompt: about, verdict: v, answerText: "x", claims: [] })).toBe(true);
    expect(isUsable({ prompt: about, verdict: "unknown", answerText: "x", claims: [claim("phone", "+31235312345")] })).toBe(true);
    expect(isUsable({ prompt: about, verdict: "unknown", answerText: "x", claims: [claim("hours", "closed")] })).toBe(false);
    expect(isUsable({ prompt: about, verdict: "unknown", answerText: "x", claims: [] })).toBe(false);
    expect(isUsable({ prompt: about, verdict: undefined, answerText: "x", claims: [] })).toBe(false);
  });
});

describe("pickTemplates", () => {
  const built = [
    { key: "a", family: "rec_category" as QuestionFamily }, { key: "b", family: "rec_category" as QuestionFamily },
    { key: "c", family: "rec_category" as QuestionFamily }, { key: "d", family: "rec_category" as QuestionFamily },
  ];
  const lib = (key: string, asked: number, usable: number, businesses: number): LibraryRow => ({ category: "c", mode: "online", templateKey: key, templateNl: key, family: "rec_category", intent: null, asked, usable, businesses });
  it("without rows it is the built-ins in order", () => expect(pickTemplates("rec_category", 2, built, []).map((t) => t.key)).toEqual(["a", "b"]));
  it("takes the best proven when there are enough, ties in built-in order", () => {
    const rows = [lib("b", 10, 9, 5), lib("d", 10, 9, 6), lib("c", 10, 7, 5)];
    expect(pickTemplates("rec_category", 2, built, rows).map((t) => t.key)).toEqual(["b", "d"]);
    expect(pickTemplates("rec_category", 3, built, rows).map((t) => t.key)).toEqual(["b", "d", "c"]);
  });
  it("falls back to the built-ins when fewer than n are proven", () => {
    expect(pickTemplates("rec_category", 2, built, [lib("c", 10, 9, 5)]).map((t) => t.key)).toEqual(["a", "b"]);
  });
  it("never returns a retired template", () => {
    const rows = [lib("a", 100, 5, 10), lib("b", 100, 5, 10)];
    expect(pickTemplates("rec_category", 2, built, rows).map((t) => t.key)).toEqual(["c", "d"]);
    expect(pickTemplates("rec_category", 4, built, rows).map((t) => t.key)).toEqual(["c", "d"]);
  });
  it("a template below 30 % with fewer than 10 businesses is still asked", () => {
    expect(pickTemplates("rec_category", 2, built, [lib("a", 100, 5, 9)]).map((t) => t.key)).toEqual(["a", "b"]);
  });
  it("leaves the fixed families alone", () => {
    const fixed = [{ key: "online.what", family: "what" as QuestionFamily }];
    const rows: LibraryRow[] = [{ ...lib("online.what", 100, 0, 50), family: "what" }];
    expect(pickTemplates("what", 1, fixed, rows)).toEqual(fixed);
  });
});

describe("what the ledger may hold (compliance B2, security S-22)", () => {
  const door = sampleFacts({
    name: "Bakkerij (De) Vries+ Xyzq", place: "Haarlem", phone: "023-5312345", policies: ["uniekebeleidstekst"], servicesYes: ["uniekedienstnaam"], servicesNo: ["uniekeniet"],
    credentials: ["uniekecredential"], prices: [{ label: "uniekeprijsregel", amount: 12 }], sector: "loodgieters-installateurs",
  });
  const SECRETS = ["Xyzq", "Vries", "Haarlem", "uniekebeleidstekst", "uniekedienstnaam", "uniekeniet", "uniekecredential", "uniekeprijsregel", "5312345"];

  it("the door questions do embed owner values (the test is not vacuous)", async () => {
    const db = withMockDb();
    const b = await addBusiness(db, door);
    const asked = await loadPrompts(db, b.id, door, "baseline", "loodgieters-installateurs", undefined, NOW, null);
    const text = asked.map((p) => p.textNl).join("\n");
    for (const s of ["uniekebeleidstekst", "uniekedienstnaam", "uniekecredential", "Xyzq"]) expect(text).toContain(s);
  });

  it.each(["door", "visit"] as const)("%s rows hold the key, a generic label, the family and counts: no name, place or fact value", async (mode) => {
    const db = withMockDb();
    const f = { ...door, profile: profile({ mode, category: null }) };
    const b = await addBusiness(db, f);
    const asked = await loadPrompts(db, b.id, f, "baseline", "loodgieters-installateurs", undefined, NOW, f.profile);
    const samples = asked.map((p, i) => ({ id: `s${i}`, scanRunId: "r", promptId: p.id, engine: "chatgpt" as const, answerText: "Ja", citations: [], capturedAt: "", costCents: 0 }));
    const rows = useRows({ scanRunId: "r", profile: f.profile, facts: f, prompts: asked, samples, claimsPerSample: samples.map(() => []), verdicts: new Map() });
    expect(rows.length).toBeGreaterThan(3);
    const dump = JSON.stringify(rows);
    for (const s of SECRETS) expect(dump).not.toContain(s);
    expect(rows.every((r) => r.mode === mode && r.category === "onbekend" && r.templateKey.startsWith(`${mode}.`))).toBe(true);
    expect(rows.map((r) => r.templateKey)).toContain(`${mode}.about.existence`);
  });

  it("sums the samples of prompts that share a key into one row", () => {
    const mk = (id: string, text: string): Prompt => ({ id, businessId: "b", category: "policy", textNl: text, probes: ["policy:x"], active: true, kind: "about" });
    const ps = [mk("p1", 'Geldt bij X: "een"?'), mk("p2", 'Geldt bij X: "twee"?')];
    const samples = [0, 1, 2].map((i) => ({ id: `s${i}`, scanRunId: "r", promptId: i < 2 ? "p1" : "p2", engine: "chatgpt" as const, answerText: "Ja", citations: [], capturedAt: "", costCents: 0 }));
    const rows = useRows({ scanRunId: "r", profile: null, facts: door, prompts: ps, samples, claimsPerSample: [[], [], []], verdicts: new Map([["s0", "correct"], ["s1", "wrong"], ["s2", "unknown"]]) });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ templateKey: "door.about.policy", mode: "door", asked: 3, usable: 2, category: "onbekend" });
  });

  it("an online template keeps its slots; the filled question never reaches the ledger", () => {
    const f = onlineFacts("Sonable");
    const qs = onlineQuestions(f.profile!, f, "baseline");
    const trust = qs.find((q) => q.templateKey === "online.rec.trust")!;
    expect(trust.textNl).toContain(CATEGORY);
    expect(templateTextOf(trust, f)).toBe("{Welke} raad je aan?");
    expect(templateKeyOf(trust, "online")).toBe("online.rec.trust");
  });

  it("a category that contains the business's name is not used", () => {
    expect(libraryCategory(profile({ category: "Sonable muziekdienst" }), { name: "Sonable" })).toBe("onbekend");
    expect(libraryCategory(profile(), { name: "Sonable" })).toBe(CATEGORY);
    expect(libraryCategory(profile({ category: "<b>x</b>" }), { name: "Sonable" })).toBe("onbekend");
    expect(libraryCategory(null, { name: "Sonable" })).toBe("onbekend");
  });
});

// ---------------------------------------------------------------------------------------------
describe.each(backends)("%s: the library through scans", (_n, makeDb) => {
  let db: Db;
  beforeEach(async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("VIDALO_MOCK", "1");
    db = await makeDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const trustPriceOnly = (k: string) => k === "online.rec.trust" || k === "online.rec.price";

  it("AC-A7: three scans build the library; proven templates need five different businesses; the next business gets them", async () => {
    for (let i = 1; i <= 3; i++) await scanOnline(db, `Zaak ${i}`, trustPriceOnly);
    const lib = await db.questionLibrary({ category: CATEGORY, mode: "online" });
    expect(lib.find((r) => r.templateKey === "online.rec.trust")).toMatchObject({ asked: 6, usable: 6, businesses: 3, family: "rec_category", mode: "online", templateNl: "{Welke} raad je aan?" });
    expect(lib.find((r) => r.templateKey === "online.rec.audience")).toMatchObject({ asked: 6, usable: 0, businesses: 3 });
    // three businesses are not enough: the fourth still gets the built-in pair
    const four = await scanOnline(db, "Zaak 4", trustPriceOnly, {}, "free");
    expect(recKeys(four.chosen)).toEqual(["online.rec.audience", "online.rec.quality"]);
    expect(libraryStatus((await libRow(db, "online.rec.trust"))!)).toBe("trial");
    await scanOnline(db, "Zaak 5", trustPriceOnly);
    expect(libraryStatus((await libRow(db, "online.rec.trust"))!)).toBe("trial"); // four businesses so far (the free check did not ask trust)
    await scanOnline(db, "Zaak 6", trustPriceOnly);
    expect(libraryStatus((await libRow(db, "online.rec.trust"))!)).toBe("proven");
    expect(libraryStatus((await libRow(db, "online.rec.audience"))!)).toBe("trial");
    const seven = await scanOnline(db, "Zaak 7", trustPriceOnly, {}, "free");
    expect(recKeys(seven.chosen)).toEqual(["online.rec.price", "online.rec.trust"]);
    // a full check still asks every template that is not retired
    const eight = await loadPrompts(db, (await addBusiness(db, onlineFacts("Zaak 8"))).id, onlineFacts("Zaak 8"), "baseline", null, undefined, NOW, profile());
    expect(recKeys(eight)).toHaveLength(4);
  });

  it("a business in another category is not influenced by it", async () => {
    for (let i = 1; i <= 6; i++) await scanOnline(db, `Zaak ${i}`, trustPriceOnly);
    const other = await scanOnline(db, "Zaak 7", trustPriceOnly, { category: "webwinkel in koffie" }, "free");
    expect(recKeys(other.chosen)).toEqual(["online.rec.audience", "online.rec.quality"]);
  });

  it("one visitor running many free checks on one business cannot promote or retire a template", async () => {
    const facts = onlineFacts("Zaak 1");
    const b = await addBusiness(db, facts);
    for (let i = 0; i < 15; i++) {
      const chosen = await loadPrompts(db, b.id, facts, "free", null, undefined, NOW, facts.profile);
      await runScan({ businessId: b.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 3, firstSamples: 3, clients: [client((k) => k === "online.rec.quality")], db, promptIds: chosen.map((x) => x.id) });
    }
    const quality = (await libRow(db, "online.rec.quality"))!;
    const audience = (await libRow(db, "online.rec.audience"))!;
    expect(quality).toMatchObject({ businesses: 1, asked: 45, usable: 45 });
    expect(audience).toMatchObject({ businesses: 1, asked: 45, usable: 0 });
    expect(libraryStatus(quality)).toBe("trial");
    expect(libraryStatus(audience)).toBe("trial");
    expect(await db.countEventsSince("library.retired", new Date(0))).toBe(0);
    const next = await loadPrompts(db, b.id, facts, "free", null, undefined, NOW, facts.profile);
    expect(recKeys(next)).toEqual(["online.rec.audience", "online.rec.quality"]);
  });

  it("retires a template only after 10 different businesses, logs it once, and never asks it again in that category", async () => {
    const notPrice = (k: string) => k !== "online.rec.price";
    for (let i = 1; i <= 9; i++) await scanOnline(db, `Zaak ${i}`, notPrice);
    expect(libraryStatus((await libRow(db, "online.rec.price"))!)).toBe("trial");
    expect(await db.countEventsSince("library.retired", new Date(0))).toBe(0);
    await scanOnline(db, "Zaak 10", notPrice);
    expect(libraryStatus((await libRow(db, "online.rec.price"))!)).toBe("retired");
    expect(await db.countEventsSince("library.retired", new Date(0))).toBe(1);
    // the eleventh business asks only what is left, in the full check and in the free check
    const eleven = await scanOnline(db, "Zaak 11", notPrice);
    expect(recKeys(eleven.chosen)).toEqual(["online.rec.audience", "online.rec.quality", "online.rec.trust"]);
    const twelve = await scanOnline(db, "Zaak 12", notPrice, {}, "free");
    expect(recKeys(twelve.chosen)).not.toContain("online.rec.price");
    expect(await db.countEventsSince("library.retired", new Date(0))).toBe(1);
    // another category still asks it
    const other = await scanOnline(db, "Zaak 13", notPrice, { category: "webwinkel in koffie" });
    expect(recKeys(other.chosen)).toContain("online.rec.price");
  });

  it("the file Julian reads lists the stopped template first, with 'n van m' and no bare percentage or business name", async () => {
    const notPrice = (k: string) => k !== "online.rec.price";
    for (let i = 1; i <= 10; i++) await scanOnline(db, `Zaak ${i}`, notPrice);
    const md = libraryMarkdown(await db.questionLibrary());
    expect(md.indexOf("## Gestopt")).toBeGreaterThan(-1);
    expect(md.indexOf("## Gestopt")).toBeLessThan(md.indexOf(`## ${CATEGORY}`));
    const stopped = md.slice(md.indexOf("## Gestopt"), md.indexOf(`## ${CATEGORY}`));
    expect(stopped).toContain("{Welke} is betaalbaar?");
    expect(stopped).toContain("0 van 20");
    expect(stopped).toContain("gestopt");
    expect(stopped).not.toContain("Wat doet {naam}?"); // a fixed question that gave nothing usable is counted, not stopped
    expect(md).toContain("vaste vraag");
    expect(md).toContain("20 van 20");
    expect(md).toContain("bewezen");
    expect(md).not.toMatch(/\d\s?%/);
    expect(md).not.toMatch(/Zaak \d/);
  });

  it("door and visit scans are recorded under their keys, and their questions are the ones they were asked before", async () => {
    const f = sampleFacts({ profile: profile({ mode: "door", category: null }) });
    const b = await addBusiness(db, f);
    const chosen = await loadPrompts(db, b.id, f, "free", null, undefined, NOW, f.profile);
    await runScan({ businessId: b.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 2, firstSamples: 2, clients: [client(() => true)], db, promptIds: chosen.map((x) => x.id) });
    const rows = await db.questionLibrary({ mode: "door" });
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.map((r) => r.templateKey)).toContain("door.about.existence");
    expect(rows.every((r) => r.category === "onbekend" && r.businesses === 1)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("Vries");
    expect(await db.questionLibrary({ mode: "online" })).toEqual([]);
  });

  it("a failing recordQuestionUse does not fail the scan; the event holds the run id and nothing else", async () => {
    vi.spyOn(db, "recordQuestionUse").mockRejectedValue(new Error("boom: secret text from the database"));
    const facts = onlineFacts("Zaak 1");
    const b = await addBusiness(db, facts);
    const chosen = await loadPrompts(db, b.id, facts, "free", null, undefined, NOW, facts.profile);
    const report = await runScan({ businessId: b.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 2, firstSamples: 2, clients: [client(() => true)], db, promptIds: chosen.map((x) => x.id) });
    expect(report.totalAnswers).toBeGreaterThan(0);
    const failed = (await db.listEvents(b.id, 100)).filter((e) => e.type === "library.record_failed");
    expect(failed).toHaveLength(1);
    expect(Object.keys(failed[0]!.payload)).toEqual(["scanRunId"]);
    expect(JSON.stringify(failed)).not.toContain("secret");
    expect(await db.questionLibrary()).toEqual([]);
  });

  it("a failing library read means the built-in order, not a failed scan", async () => {
    vi.spyOn(db, "questionLibrary").mockRejectedValue(new Error("down"));
    const facts = onlineFacts("Zaak 1");
    const b = await addBusiness(db, facts);
    const chosen = await loadPrompts(db, b.id, facts, "free", null, undefined, NOW, facts.profile);
    expect(recKeys(chosen)).toEqual(["online.rec.audience", "online.rec.quality"]);
  });

  it("a retried recording of the same scan counts once", async () => {
    const { business } = await scanOnline(db, "Zaak 1", () => true);
    const run = (await db.listScanRuns(business.id))[0]!;
    const rows = useRows({ scanRunId: run.id, profile: profile(), facts: onlineFacts("Zaak 1"), prompts: await db.listPrompts(business.id), samples: await db.listSamples(run.id), claimsPerSample: [], verdicts: new Map() });
    await db.recordQuestionUse(rows);
    const trust = (await libRow(db, "online.rec.trust"))!;
    expect(trust).toMatchObject({ asked: 2, businesses: 1 });
  });

  it("deleting a business keeps the counts and leaves no row with its name, offer, audience, policy or service", async () => {
    const f = onlineFacts("Uniekenaam Zzyx", { offer: "uniekeaanbodtekst", audience: "uniekedoelgroep", competitors: ["UniekeConcurrent"] }, { servicesYes: ["uniekedienstnaam"], policies: ["uniekebeleidstekst"] });
    const b = await addBusiness(db, f);
    const chosen = await loadPrompts(db, b.id, f, "baseline", null, undefined, NOW, f.profile);
    await runScan({ businessId: b.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 2, firstSamples: 2, clients: [client(() => true)], db, promptIds: chosen.map((x) => x.id) });
    const door = onlineFacts("Uniekedeur Qqwx", {}, { servicesYes: ["uniekedienstnaam"], policies: ["uniekebeleidstekst"], credentials: ["uniekecredential"] });
    const dDoor = { ...door, profile: profile({ mode: "door", category: null }) };
    const d = await addBusiness(db, dDoor);
    const dChosen = await loadPrompts(db, d.id, dDoor, "baseline", null, undefined, NOW, dDoor.profile);
    await runScan({ businessId: d.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 2, firstSamples: 2, clients: [client(() => true)], db, promptIds: dChosen.map((x) => x.id) });
    const before = await db.questionLibrary();
    expect(before.length).toBeGreaterThan(5);

    await db.deleteBusiness(b.id);
    await db.deleteBusiness(d.id);

    const after = await db.questionLibrary();
    expect(after.map((r) => [r.category, r.mode, r.templateKey, r.asked, r.usable, r.businesses])).toEqual(before.map((r) => [r.category, r.mode, r.templateKey, r.asked, r.usable, r.businesses]));
    const stored = db instanceof Object && "questionUse" in db ? JSON.stringify((db as unknown as { questionUse: unknown }).questionUse) : JSON.stringify(await raw!`select * from question_use`);
    for (const s of ["Uniekenaam", "Zzyx", "Uniekedeur", "Qqwx", "uniekeaanbodtekst", "uniekedoelgroep", "UniekeConcurrent", "uniekedienstnaam", "uniekebeleidstekst", "uniekecredential"]) expect(stored).not.toContain(s);
    // the rows are no longer tied to a scan run
    if ("questionUse" in db) expect((db as unknown as { questionUse: { scanRunId: string | null }[] }).questionUse.every((u) => u.scanRunId === null)).toBe(true);
    else expect((await raw!`select count(*)::int as n from question_use where scan_run_id is not null`)[0]!.n).toBe(0);
  });

  it("the same businesses asked twice count as two businesses, not as many", async () => {
    // 2 businesses x 10 scans each: 20 scans, 2 businesses
    for (const n of ["Zaak 1", "Zaak 2"]) {
      const facts = onlineFacts(n);
      const b = await addBusiness(db, facts);
      for (let i = 0; i < 10; i++) {
        const chosen = await loadPrompts(db, b.id, facts, "baseline", null, undefined, NOW, facts.profile);
        await runScan({ businessId: b.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 2, firstSamples: 2, clients: [client(() => false)], db, promptIds: chosen.map((x) => x.id) });
      }
    }
    const price = (await libRow(db, "online.rec.price"))!;
    expect(price).toMatchObject({ businesses: 2, asked: 40, usable: 0 });
    expect(libraryStatus(price)).toBe("trial");
  });
});
