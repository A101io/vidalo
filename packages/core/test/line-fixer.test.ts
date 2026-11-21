import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db/mem";
import { setDb } from "../src/shared/db";
import { LINE_KEEP_CHECKING_PATH, LINE_OUTLET_PATH, FIX_PATHS, fixPathFor, fixPathForFinding, isFindabilityFinding, markFixedByOwner, openFixForFinding, runRecheck, correctionRequestEmail } from "../src/fixer";
import { createMockEngine, runScan } from "../src/scanner";
import type { Finding, ProductLineData, SourceType } from "../src/types";
import { correctionFollowUpEmail } from "../src/fixer/email-templates";
import { sampleFacts } from "./scanner-fixtures";

const SPELT: ProductLineData = {
  name: "Haarlems Speltbrood", category: "speltbrood", useCases: ["ontbijt"], markets: ["NL", "BE"],
  specs: [{ label: "Gewicht", value: "800 g" }], certificates: [{ name: "EKO", number: "EKO-0000", validUntil: "2027-06-30" }],
  outlets: [{ market: "NL", name: "Versmarkt Haarlem", url: null }], replaces: ["Speltbrood Classic"], replacedBy: null,
};

describe("line fix paths (ADR-0014, compliance B1)", () => {
  const f = (over: Partial<Finding> = {}) => ({ sourceType: "third_party" as SourceType, verdict: "wrong" as const, evidenceKind: "about" as const, productLineId: "l1", factKey: "spec" as const, ...over });
  it("takes the owner-website and third-party paths, and keeps checking for everything else", () => {
    expect(fixPathForFinding(f({ sourceType: "owned_website" }))).toBe(FIX_PATHS.owned_website);
    for (const st of ["third_party", "directory_api", "directory_form"] as const) expect(fixPathForFinding(f({ sourceType: st }))).toBe(FIX_PATHS.third_party);
    for (const st of ["owned_facts_page", "other_entity", "none"] as const) expect(fixPathForFinding(f({ sourceType: st }))).toBe(LINE_KEEP_CHECKING_PATH);
    expect(fixPathForFinding(f({ verdict: "not_found", sourceType: "third_party" }))).toBe(LINE_KEEP_CHECKING_PATH);
    expect(fixPathForFinding(f({ evidenceKind: "recommendation", sourceType: "none" }))).toBe(LINE_KEEP_CHECKING_PATH);
    // an outlet 'not in your list' never takes the third-party path, whatever the source
    for (const st of ["third_party", "owned_website", "directory_form"] as const) expect(fixPathForFinding(f({ factKey: "outlet", sourceType: st }))).toBe(LINE_OUTLET_PATH);
    expect(LINE_OUTLET_PATH.action).toBe("none");
    expect(LINE_OUTLET_PATH.labelNl).toContain("niet in je lijst");
    expect(fixPathFor("third_party", "wrong", "about", "l1", "spec")).toBe(FIX_PATHS.third_party);
    // a business finding is untouched
    expect(fixPathFor("third_party", "wrong", "about")).toBe(FIX_PATHS.third_party);
    expect(fixPathFor("none", "not_found", "about").action).toBe("republish");
  });
  it("is never a findability finding", () => {
    expect(isFindabilityFinding({ sourceType: "none", verdict: "not_found", productLineId: "l1" })).toBe(false);
    expect(isFindabilityFinding({ sourceType: "none", verdict: "wrong", evidenceKind: "recommendation", productLineId: "l1" })).toBe(false);
    expect(isFindabilityFinding({ sourceType: "none", verdict: "not_found" })).toBe(true);
  });
  it("labels exist in both languages", () => {
    for (const p of [LINE_KEEP_CHECKING_PATH, LINE_OUTLET_PATH]) expect(p.labelNl.length + p.labelEn.length + (p.unfixableNoteNl?.length ?? 0) + (p.unfixableNoteEn?.length ?? 0)).toBeGreaterThan(80);
  });
});

describe("fixes and rechecks of a line finding", () => {
  let db: MemDb;
  let businessId: string;
  let lineId: string;
  beforeEach(async () => {
    db = new MemDb();
    setDb(db);
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", domain: "bakkerijdevries.nl", ownerEmail: "eigenaar@bakkerijdevries.nl", status: "active", plan: "monitor", language: "nl" });
    businessId = b.id;
    await db.insertFacts(b.id, sampleFacts({ businessId: b.id }), { provisional: false });
    const r = await db.saveProductLine({ businessId, productLineId: null, data: SPELT, maxActive: 5 });
    if (!r.ok) throw new Error("setup");
    lineId = r.line.id;
  });
  const lineFinding = async (over: Partial<Parameters<MemDb["upsertFindings"]>[0][number]> = {}) => {
    const run = await db.createScanRun({ businessId, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done", productLineId: lineId, productLineVersion: 1, market: "NL" });
    const [x] = await db.upsertFindings([{ businessId, scanRunId: run.id, factKey: "spec", subject: "Gewicht", engine: "chatgpt", wrongValue: "500 g", correctValue: "800 g", frequency: 4, sampleCount: 5, sourceUrl: "https://broodwiki.example/speltbrood", sourceType: "third_party", evidenceBefore: null, criterium: 13, ...over }]);
    return x!;
  };
  const jobs = (kind: string) => [...db.jobs.values()].filter((j) => j.kind === kind);

  it("a third_party line finding queues a correction mail naming the line; the letter carries the owner's value only", async () => {
    const out = await openFixForFinding(await lineFinding());
    expect(out.action).toBe("email");
    const mail = jobs("email")[0]!.payload as { subject: string; text: string; to: string };
    expect(mail.text).toContain("Het gaat om het product Haarlems Speltbrood van Bakkerij De Vries.");
    expect(mail.text).toContain("500 g");
    expect(mail.text).toContain("800 g");
    expect(out.fix.target).toBe("https://broodwiki.example/speltbrood");
  });

  it("a line letter and its follow-up never cite the facts page (CMP-601)", async () => {
    const f = await lineFinding();
    const ctx = { business: { name: "Bakkerij De Vries", place: "Haarlem", ownerEmail: null }, factsPageUrl: "https://facts.example/bakkerij", line: { name: "Haarlems Speltbrood" } };
    for (const text of [correctionRequestEmail(f, ctx).text, correctionFollowUpEmail(f, ctx, "2026-11-01T00:00:00Z").text]) {
      expect(text).not.toContain("facts.example");
      expect(text).not.toContain("feitenpagina");
      expect(text).toContain("Dit gegeven is door de eigenaar aan ons bevestigd.");
    }
    // a business letter still cites it
    expect(correctionRequestEmail(f, { ...ctx, line: undefined }).text).toContain("https://facts.example/bakkerij");
    expect(correctionFollowUpEmail(f, { ...ctx, line: undefined }, "2026-11-01T00:00:00Z").text).toContain("https://facts.example/bakkerij");
  });

  it("pressing 'I changed it' on an outlet finding queues no recheck (CMP-607)", async () => {
    const f = await lineFinding({ factKey: "outlet", subject: null, wrongValue: "Gentse Warenwinkel", correctValue: "Broodhuys Gent", sourceType: "none", sourceUrl: null });
    await openFixForFinding(f);
    const before = jobs("recheck").length;
    expect(await markFixedByOwner(f)).toBeNull();
    expect(jobs("recheck")).toHaveLength(before);
    // a spec finding of the same line still queues one
    const g = await lineFinding();
    await openFixForFinding(g);
    expect(await markFixedByOwner(g)).not.toBeNull();
    expect(jobs("recheck").length).toBe(before + 1);
  });

  it("owned_website mails the owner, naming the line", async () => {
    const out = await openFixForFinding(await lineFinding({ sourceType: "owned_website", sourceUrl: "https://bakkerijdevries.nl/brood" }));
    expect(out.action).toBe("manual");
    const mail = jobs("email")[0]!.payload as { text: string; kind: string; to: string };
    expect(mail.kind).toBe("owner_instruction");
    expect(mail.to).toBe("eigenaar@bakkerijdevries.nl");
    expect(mail.text).toContain("Dit gaat over je productlijn Haarlems Speltbrood.");
  });

  it("not_found, none, owned_facts_page, recommendation and outlet open the keep-checking path and never publish, sync or mail a third party", async () => {
    const cases: Partial<Finding>[] = [
      { verdict: "not_found", sourceType: "none", sourceUrl: null, wrongValue: "niet gevonden" },
      { sourceType: "none", sourceUrl: null },
      { sourceType: "owned_facts_page", sourceUrl: "https://x-feiten.vidalo.ai" },
      { factKey: "outlet", subject: "NL", wrongValue: "Voorbeeldmarkt Noord", correctValue: "Versmarkt Haarlem", sourceType: "third_party", sourceUrl: "https://broodwiki.example/winkels", criterium: 15 },
      { factKey: "outlet", subject: "NL", wrongValue: "Voorbeeldmarkt Noord", correctValue: "Versmarkt Haarlem", sourceType: "none", sourceUrl: null, criterium: 15, engine: "perplexity" },
    ];
    for (const c of cases) {
      const out = await openFixForFinding(await lineFinding(c as never));
      expect(out.action, JSON.stringify(c)).toBe("none");
      expect(out.fix.target).not.toMatch(/feiten/);
      expect(out.fix.evidence.publish).toBeUndefined();
      expect(out.fix.evidence.sync).toBeUndefined();
      expect(out.fix.evidence.email).toBeUndefined();
    }
    expect(jobs("email")).toEqual([]);
    expect(jobs("operator_task")).toEqual([]);
    expect(await db.listChannels(businessId)).toEqual([]);
    expect([...db.events].some((e) => /publish|sync|facts_page/.test(e.type))).toBe(false);
  });

  it("a certificate letter states the number and the end date; an expired entry is never asserted", async () => {
    const valid = (await db.getProductLine(lineId))!;
    const cert = await lineFinding({ factKey: "certificate", subject: "EKO", wrongValue: "no", correctValue: "yes", criterium: 14 });
    const o = await openFixForFinding(cert);
    const text = (jobs("email")[0]!.payload as { text: string }).text;
    expect(text).toContain("nummer EKO-0000");
    expect(text).toContain("geldig tot 2027-06-30");
    expect(valid.current.certificates[0]!.number).toBe("EKO-0000");
    expect(o.action).toBe("email");
    const expired = correctionRequestEmail({ ...cert, subject: "EKO" } as Finding, { business: { name: "B", place: "H", ownerEmail: null }, factsPageUrl: "u", line: { name: "Lijn", certificate: { number: "X", validUntil: "2020-01-01", valid: false } } });
    expect(expired.text).not.toContain("geldig tot");
    expect(expired.text).not.toContain("nummer X");
  });

  it("a successor letter says the line is the successor of an old name the owner entered", async () => {
    await openFixForFinding(await lineFinding({ factKey: "successor", subject: "Speltbrood Classic", wrongValue: "__absent__", correctValue: "Haarlems Speltbrood", criterium: 16 }));
    expect((jobs("email")[0]!.payload as { text: string }).text).toContain("Haarlems Speltbrood is de opvolger van Speltbrood Classic, een eerder product van Bakkerij De Vries.");
  });

  it("'Ik heb dit aangepast' runs a line recheck for that market and engine and resolves the finding when the answer is right (AC4)", async () => {
    const wrong = createMockEngine("chatgpt", { wrongPairRate: 1 });
    const first = await runScan({ businessId, kind: "monthly", engines: ["chatgpt"], clients: [wrong], db, productLineId: lineId, market: "NL" });
    const f = (await db.listFindings(businessId, "open", { productLineId: lineId })).find((x) => x.factKey === "spec")!;
    expect(f).toBeTruthy();
    expect(first.productLine).toBeTruthy();
    const opened = await openFixForFinding(f);
    expect(["email", "manual", "none"]).toContain(opened.action);
    const marked = await markFixedByOwner(f);
    expect(marked).not.toBeNull();
    expect(jobs("recheck")).toHaveLength(1);
    const right = createMockEngine("chatgpt", { wrongPairRate: 0 });
    const asked: { productLineId?: string; market?: string; engines?: string[]; kind: string }[] = [];
    const out = await runRecheck(opened.fix.id, { runScan: (o) => (asked.push({ productLineId: o.productLineId, market: o.market, engines: o.engines, kind: o.kind }), runScan({ ...o, clients: [right] })) });
    expect(asked).toEqual([{ productLineId: lineId, market: "NL", engines: ["chatgpt"], kind: "recheck" }]);
    expect(out.result).toBe("resolved");
    expect((await db.getFinding(f.id))!.status).toBe("resolved");
    // the recheck is a line run, not a business run
    expect((await db.listScanRuns(businessId)).filter((r) => r.kind === "recheck")).toEqual([]);
    expect((await db.listScanRuns(businessId, 50, { productLineId: lineId })).filter((r) => r.kind === "recheck")).toHaveLength(1);
  });

  it("twenty presses on one line finding make one recheck (S-25)", async () => {
    const f = await lineFinding();
    await openFixForFinding(f);
    const now = new Date("2026-11-21T10:00:00Z");
    await Promise.all(Array.from({ length: 20 }, () => markFixedByOwner(f, now)));
    expect(jobs("recheck")).toHaveLength(1);
    // a day later it can be pressed again
    await markFixedByOwner(f, new Date("2026-11-22T10:00:01Z"));
    expect(jobs("recheck")).toHaveLength(2);
  });
});
