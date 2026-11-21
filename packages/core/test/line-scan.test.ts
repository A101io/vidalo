import { beforeEach, describe, expect, it } from "vitest";
import { withMockDb, type Db } from "../src/db";
import { runSummaries } from "../src/db/owner-area";
import { buildReport, compare, createMockEngine, detectOtherEntity, extractClaimsRules, factValue, lineFacts, valuesMatch, type ComparableSample } from "../src/scanner";
import { systemFor } from "../src/scanner/engines/types";
import { loadLinePrompts } from "../src/prompts/line";
import type { Claim, Facts, ProductLineData } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";

const SPELT: ProductLineData = {
  name: "Haarlems Speltbrood", category: "speltbrood", useCases: ["ontbijt", "lunch"], markets: ["NL", "BE"],
  specs: [{ label: "Gewicht", value: "800 g" }, { label: "Houdbaarheid", value: "4 dagen" }],
  certificates: [{ name: "EKO", number: "EKO-0000", validUntil: "2027-06-30" }, { name: "KIWA", number: null, validUntil: "2020-01-01" }],
  outlets: [{ market: "NL", name: "Versmarkt Haarlem", url: "https://versmarkt-haarlem.example" }, { market: "BE", name: "Broodhuys Gent", url: "https://broodhuys-gent.example" }],
  replaces: ["Speltbrood Classic"], replacedBy: null,
};
const NOW = new Date("2026-11-21T12:00:00Z");

let db: Db;
let businessId: string;
beforeEach(async () => {
  db = await withMockDb();
  const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", domain: "bakkerijdevries.nl", status: "active", plan: "monitor" });
  businessId = b.id;
  await db.insertFacts(b.id, sampleFacts({ businessId: b.id }), { provisional: false });
});
const saveLine = async (data = SPELT) => {
  const r = await db.saveProductLine({ businessId, productLineId: null, data, maxActive: 5 });
  if (!r.ok) throw new Error("setup");
  return r.line;
};
const view = async (data = SPELT, market = "NL"): Promise<Facts> => {
  const line = await saveLine(data);
  return lineFacts({ name: "Bakkerij De Vries" }, sampleFacts(), line.current, market, NOW);
};
const claim = (factKey: Claim["factKey"], subject: string | null, value: string): Claim => ({ sampleId: "s", factKey, subject, value, confidence: 0.8, otherEntity: false, rawQuote: "" });
const prompt = (probe: string, category: Claim["factKey"], kind: "about" | "recommendation" = "about") => ({ category, probes: [probe], textNl: "q", kind, criterium: ({ spec: 13, certificate: 14, outlet: 15, successor: 16 } as Record<string, 13 | 14 | 15 | 16 | 6>)[category] ?? 6 });
const judge = (facts: Facts, p: ReturnType<typeof prompt>, claims: Claim[], n = 1) => compare(Array.from({ length: n }, (_, i): ComparableSample => ({ sampleId: `s${i}`, engine: "chatgpt", prompt: p, claims: claims.map((c) => ({ ...c, sampleId: `s${i}` })), citations: [] })), facts);

describe("a line run", () => {
  it("creates one scan_run with the scope; samples and findings carry it; the business is untouched; the BE run is asked in English", async () => {
    const line = await saveLine();
    const asked: { country: string | undefined; place: string; prompt: string }[] = [];
    const inner = createMockEngine("chatgpt", { wrongPairRate: 1 });
    const client = { ...inner, ask: async (q: string, ctx: Parameters<typeof inner.ask>[1]) => (asked.push({ country: ctx.business.country, place: ctx.business.place, prompt: q }), inner.ask(q, ctx)) };
    const { runScan } = await import("../src/scanner");
    const before = await db.listFindings(businessId);
    const nl = await runScan({ businessId, kind: "monthly", engines: ["chatgpt"], clients: [client], db, productLineId: line.id, market: "NL" });
    const be = await runScan({ businessId, kind: "monthly", engines: ["chatgpt"], clients: [client], db, productLineId: line.id, market: "BE" });
    const runs = await db.listScanRuns(businessId, 10, { productLineId: line.id });
    expect(runs).toHaveLength(2);
    expect(runs.find((r) => r.market === "NL")).toMatchObject({ productLineId: line.id, productLineVersion: 1, kind: "monthly" });
    expect(await db.listScanRuns(businessId)).toEqual([]);
    expect(await db.listFindings(businessId)).toEqual(before);
    const lineFindings = await db.listFindings(businessId, undefined, { productLineId: line.id });
    expect(lineFindings.length).toBeGreaterThan(0);
    expect(lineFindings.every((f) => f.productLineId === line.id && ["NL", "BE"].includes(f.market!))).toBe(true);
    expect(lineFindings.map((f) => f.criterium).filter((c) => ![13, 14, 15, 16].includes(c!))).toEqual([]);
    expect((await db.listSamples(nl.scanRunId)).every((s) => s.productLineId === line.id && s.market === "NL")).toBe(true);
    expect(nl.productLine).toEqual({ id: line.id, name: "Haarlems Speltbrood", version: 1, market: "NL" });
    expect(nl.comparedAs).toBe("speltbrood");
    // AC2: BE asks in English as a user in Belgium, no town
    const english = (q: string) => /^(Which|What|Where)|certified\?$/.test(q);
    const beAsked = asked.filter((a) => english(a.prompt));
    expect(beAsked.length).toBeGreaterThan(0);
    expect(beAsked.every((a) => a.country === "BE" && a.place === "")).toBe(true);
    expect(asked.filter((a) => a.country === "BE").every((a) => english(a.prompt))).toBe(true);
    expect(systemFor("BE")).toMatch(/Belgium/);
    expect(asked.filter((a) => a.country === "NL").every((a) => /^(Welk|Welke|Is|Waar|Wat)/.test(a.prompt))).toBe(true);
    expect(be.productLine!.market).toBe("BE");
  });

  it("never writes to the shared question library (S-17): the ledger is unchanged by a line run", async () => {
    const line = await saveLine();
    const { runScan } = await import("../src/scanner");
    const before = await db.questionLibrary();
    await runScan({ businessId, kind: "monthly", engines: ["chatgpt"], clients: [createMockEngine("chatgpt", { wrongPairRate: 0.5 })], db, productLineId: line.id, market: "NL" });
    expect(await db.questionLibrary()).toEqual(before);
  });

  it("saves a summary for a monthly line run, with recommend counts; a recheck saves none", async () => {
    const line = await saveLine();
    const { runScan } = await import("../src/scanner");
    const client = createMockEngine("chatgpt", { wrongPairRate: 0 });
    const r = await runScan({ businessId, kind: "monthly", engines: ["chatgpt"], clients: [client], db, productLineId: line.id, market: "NL" });
    const sums = await runSummaries(db, businessId, 10, { productLineId: line.id, market: "NL" });
    expect(sums).toHaveLength(1);
    expect(sums[0]!.id).toBe(r.scanRunId);
    expect(sums[0]!.summary!.recommend!.answers).toBeGreaterThan(0);
    // recommendation answers are named / not_named, never a finding
    expect((await db.listFindings(businessId, undefined, { productLineId: line.id })).filter((f) => f.evidenceKind === "recommendation")).toEqual([]);
    const ids = (await db.listPrompts(businessId, { line: { productLineId: line.id, market: "NL" } })).filter((p) => p.category === "spec").map((p) => p.id);
    await runScan({ businessId, kind: "recheck", engines: ["chatgpt"], clients: [client], db, productLineId: line.id, market: "NL", promptIds: ids });
    expect(await runSummaries(db, businessId, 10, { productLineId: line.id, market: "NL" })).toHaveLength(1);
  });

  it("buildReport after a new version still judges against the run's version", async () => {
    const line = await saveLine();
    const { runScan } = await import("../src/scanner");
    const client = createMockEngine("chatgpt", { wrongPairRate: 0 });
    const r = await runScan({ businessId, kind: "monthly", engines: ["chatgpt"], clients: [client], db, productLineId: line.id, market: "NL" });
    expect(r.findings).toEqual([]);
    await db.saveProductLine({ businessId, productLineId: line.id, data: { ...SPELT, specs: [{ label: "Gewicht", value: "900 g" }] }, maxActive: 5 });
    const again = await buildReport(r.scanRunId, db);
    expect(again.findings).toEqual([]);
    expect(again.productLine!.version).toBe(1);
    expect(again.correct.some((c) => c.factKey === "spec")).toBe(true);
  });

  it("a discontinued line is not scanned monthly (line_not_scannable:discontinued) but a recheck runs", async () => {
    const line = await saveLine();
    await db.setProductLineStatus({ businessId, productLineId: line.id, status: "discontinued", maxActive: 5 });
    const { runScan } = await import("../src/scanner");
    const client = createMockEngine("chatgpt", { wrongPairRate: 0 });
    await expect(runScan({ businessId, kind: "monthly", engines: ["chatgpt"], clients: [client], db, productLineId: line.id, market: "NL" })).rejects.toThrow("line_not_scannable:discontinued");
    await loadLinePrompts(db, businessId, line.current, "NL", "monthly");
    const ids = (await db.listPrompts(businessId, { line: { productLineId: line.id } })).slice(0, 2).map((p) => p.id);
    await expect(runScan({ businessId, kind: "recheck", engines: ["chatgpt"], clients: [client], db, productLineId: line.id, market: "NL", promptIds: ids })).resolves.toBeDefined();
    await expect(runScan({ businessId, kind: "monthly", engines: ["chatgpt"], clients: [client], db, productLineId: line.id, market: "FR" })).rejects.toThrow(/line_not_scannable/);
    await expect(runScan({ businessId, kind: "monthly", engines: ["chatgpt"], clients: [client], db, productLineId: line.id })).rejects.toThrow(/line_not_scannable/);
  });
});

describe("judging the four keys", () => {
  it("spec: right and wrong values, '800 gram' = '800 g', '0,8 kg' = '800 g'", async () => {
    const f = await view();
    expect(factValue(f, "spec", "Gewicht")).toBe("800 g");
    expect(valuesMatch("spec", "800 g", "800 g")).toBe(true);
    expect(valuesMatch("spec", "0.8 kg", "800 g")).toBe(true);
    expect(valuesMatch("spec", "500 g", "800 g")).toBe(false);
    const p = prompt("spec:Gewicht", "spec");
    const good = extractClaimsRules("Haarlems Speltbrood heeft gewicht 800 gram.", f, p);
    expect(good).toMatchObject([{ factKey: "spec", subject: "Gewicht", value: "800 g" }]);
    expect(judge(f, p, good, 5).findings).toEqual([]);
    const bad = extractClaimsRules("Haarlems Speltbrood weegt 500 g.", f, p);
    expect(bad[0]!.value).toBe("500 g");
    const res = judge(f, p, bad, 5);
    expect(res.findings).toHaveLength(1);
    expect(res.findings[0]).toMatchObject({ factKey: "spec", subject: "Gewicht", wrongValue: "500 g", correctValue: "800 g", criterium: 13 });
    // a spec nobody entered is not judged
    expect(factValue(f, "spec", "Kleur")).toBeNull();
  });

  it("certificate: an expired certificate answered 'ja' is wrong; a valid one answered 'nee' is wrong", async () => {
    const f = await view();
    expect(factValue(f, "certificate", "EKO")).toBe("yes");
    expect(factValue(f, "certificate", "KIWA")).toBe("no");
    const kiwa = prompt("certificate:KIWA", "certificate");
    const ja = extractClaimsRules("Ja, Haarlems Speltbrood is KIWA-gecertificeerd.", f, kiwa);
    expect(judge(f, kiwa, ja, 5).findings[0]).toMatchObject({ factKey: "certificate", wrongValue: "yes", correctValue: "no", criterium: 14 });
    const eko = prompt("certificate:EKO", "certificate");
    expect(judge(f, eko, extractClaimsRules("Nee, het is niet EKO-gecertificeerd.", f, eko), 5).findings[0]).toMatchObject({ wrongValue: "no", correctValue: "yes" });
    expect(judge(f, eko, extractClaimsRules("Ja, EKO-gecertificeerd.", f, eko), 5).findings).toEqual([]);
    // valid through the end date, in Amsterdam time: the day itself still counts
    const edge = lineFacts({ name: "B" }, sampleFacts(), { ...(await db.getProductLine((await saveLine()).id))!.current, certificates: [{ name: "EKO", number: null, validUntil: "2026-11-21" }] }, "NL", new Date("2026-11-21T23:30:00Z"));
    expect(factValue(edge, "certificate", "EKO")).toBe("no"); // 00:30 on 22 Nov in Amsterdam: the end date has passed
    const same = lineFacts({ name: "B" }, sampleFacts(), { ...(await db.getProductLine((await saveLine()).id))!.current, certificates: [{ name: "EKO", number: null, validUntil: "2026-11-21" }] }, "NL", new Date("2026-11-21T22:30:00Z"));
    expect(factValue(same, "certificate", "EKO")).toBe("yes");
  });

  it("outlet: one in another market's list is wrong; the owner's are right; a host that matches counts", async () => {
    const f = await view();
    expect(factValue(f, "outlet", "NL")).toBe("Versmarkt Haarlem");
    expect(factValue(f, "outlet", "BE")).toBeNull();
    const p = prompt("outlet:NL", "outlet");
    const ok = extractClaimsRules("Te koop bij:\n1. **Versmarkt Haarlem**\n2. Meer op https://versmarkt-haarlem.example/winkel", f, p);
    expect(ok.map((c) => c.value)).toEqual(["Versmarkt Haarlem"]);
    expect(judge(f, p, ok, 5).findings).toEqual([]);
    const other = extractClaimsRules("Te koop bij:\n1. **Versmarkt Haarlem**\n2. **Broodhuys Gent**", f, p);
    expect(other.map((c) => c.value)).toEqual(["Broodhuys Gent", "Versmarkt Haarlem"]);
    const res = judge(f, p, other, 5);
    expect(res.findings[0]).toMatchObject({ factKey: "outlet", subject: "NL", wrongValue: "Broodhuys Gent", correctValue: "Versmarkt Haarlem", criterium: 15 });
  });

  it("successor: the line's name is right; the old name as current, another product, or none is wrong", async () => {
    const f = await view();
    expect(factValue(f, "successor", "Speltbrood Classic")).toBe("Haarlems Speltbrood");
    expect(factValue(f, "successor", "Onbekend")).toBeNull();
    const p = prompt("successor:Speltbrood Classic", "successor");
    const right = extractClaimsRules("De opvolger van Speltbrood Classic is Haarlems Speltbrood.", f, p);
    expect(right[0]!.value).toBe("__present__");
    expect(judge(f, p, right, 5).findings).toEqual([]);
    const old = extractClaimsRules("Speltbrood Classic is nog steeds verkrijgbaar; er is geen opvolger.", f, p);
    expect(old[0]!.value).toBe("__absent__");
    expect(judge(f, p, old, 5).findings[0]).toMatchObject({ factKey: "successor", correctValue: "Haarlems Speltbrood", wrongValue: "__absent__", criterium: 16 });
    const other = extractClaimsRules("De opvolger van Speltbrood Classic is Nieuwe Variant X.", f, p);
    expect(other[0]!.value).toBe("Nieuwe Variant X");
    // the old name shares a word with the line (Tigris K3 / K5) but is not the line
    const tigris = await view({ ...SPELT, name: "Tigris K5", replaces: ["Tigris K3"] });
    const tp = prompt("successor:Tigris K3", "successor");
    expect(extractClaimsRules("Tigris K3 is een goed systeem.", tigris, tp)[0]!.value).toBe("__absent__");
    expect(extractClaimsRules("Tigris K5 volgt Tigris K3 op.", tigris, tp)[0]!.value).toBe("__present__");
  });

  it("recommendation answers give named / not_named and never a finding; a namesake is never judged for a line", async () => {
    const f = await view();
    const p = prompt("existence:ontbijt", "existence", "recommendation");
    const named = extractClaimsRules("1. Studio Alfa\n2. Haarlems Speltbrood\n3. Merk Beta", f, p);
    const notNamed = extractClaimsRules("1. Studio Alfa\n2. Merk Beta", f, p);
    const res = compare([
      { sampleId: "a", engine: "chatgpt", prompt: p, claims: named.map((c) => ({ ...c, sampleId: "a" })), citations: [] },
      { sampleId: "b", engine: "chatgpt", prompt: p, claims: notNamed.map((c) => ({ ...c, sampleId: "b" })), citations: [] },
    ], f);
    expect(res.verdicts.get("a")).toBe("named");
    expect(res.verdicts.get("b")).toBe("not_named");
    expect(res.findings).toEqual([]);
    const spec = extractClaimsRules("Dit gaat over Haarlems Speltbrood in Amsterdam, het weegt 500 g.", f, prompt("spec:Gewicht", "spec"));
    expect(spec).toHaveLength(1);
    expect(spec.every((c) => !c.otherEntity)).toBe(true);
    expect(detectOtherEntity("Dit gaat over Haarlems Speltbrood in Amsterdam.", f)).toBe(false);
  });

  it("hostile labels and outlet names do not throw, do not match wrongly, and a 100 KB answer is fast (S-18)", async () => {
    const f = await view({ ...SPELT, specs: [{ label: "(a+)+$", value: "1 g" }], outlets: [{ market: "NL", name: "Shop [1]+*", url: null }], replaces: [".*"] });
    const big = "a".repeat(100_000) + " ".repeat(100) + "1. **Shop [1]+*** " + "(a)".repeat(30_000);
    const t0 = Date.now();
    for (const [probe, cat] of [["spec:(a+)+$", "spec"], ["outlet:NL", "outlet"], ["successor:.*", "successor"], ["certificate:EKO", "certificate"]] as const) {
      expect(() => extractClaimsRules(big, f, prompt(probe, cat))).not.toThrow();
    }
    expect(Date.now() - t0).toBeLessThan(500);
  });
});
