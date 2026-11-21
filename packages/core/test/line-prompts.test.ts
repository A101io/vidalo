import { beforeEach, describe, expect, it } from "vitest";
import { withMockDb, type Db } from "../src/db";
import { generateLinePrompts, loadLinePrompts } from "../src/prompts/line";
import type { ProductLineData, ProductLineVersion } from "../src/types";

const SPELT: ProductLineData = {
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
const version = (over: Partial<ProductLineData> = {}, v = 2): ProductLineVersion => ({ ...SPELT, ...over, productLineId: "line-1", version: v, confirmedAt: "2026-11-01T00:00:00.000Z" });
const BRAND = "Bakkerij De Vries";
const texts = (v: ProductLineVersion, market: string, brand = BRAND) => generateLinePrompts(v, market, brand).map((p) => p.textNl);

describe("generateLinePrompts", () => {
  it("NL: the seed's Speltbrood v2 gives 2 rec, 2 spec, 1 cert, 1 outlet, 1 successor, in Dutch, in template order", () => {
    const out = generateLinePrompts(version(), "NL", BRAND);
    expect(out.map((p) => p.templateKey)).toEqual(["line.rec.use", "line.rec.use", "line.spec", "line.spec", "line.cert", "line.outlet", "line.successor"]);
    expect(out.map((p) => p.textNl)).toEqual([
      "Welk speltbrood is het beste voor ontbijt?",
      "Welk speltbrood is het beste voor lunch?",
      "Welk gewicht heeft Haarlems Speltbrood van Bakkerij De Vries?",
      "Welke houdbaarheid heeft Haarlems Speltbrood van Bakkerij De Vries?",
      "Is Haarlems Speltbrood van Bakkerij De Vries EKO-gecertificeerd?",
      "Waar koop ik Haarlems Speltbrood van Bakkerij De Vries in Nederland?",
      "Wat is de opvolger van Speltbrood Classic van Bakkerij De Vries?",
    ]);
    expect(out.map((p) => [p.kind, p.category, p.probes, p.criterium, p.pool, p.active])).toEqual([
      ["recommendation", "existence", ["existence:ontbijt"], 6, "core", true],
      ["recommendation", "existence", ["existence:lunch"], 6, "core", true],
      ["about", "spec", ["spec:Gewicht"], 13, "core", true],
      ["about", "spec", ["spec:Houdbaarheid"], 13, "core", true],
      ["about", "certificate", ["certificate:EKO"], 14, "core", true],
      ["about", "outlet", ["outlet:NL"], 15, "core", true],
      ["about", "successor", ["successor:Speltbrood Classic"], 16, "core", true],
    ]);
  });

  it("BE: the same seven questions in English, with the country's English name", () => {
    expect(texts(version(), "BE")).toEqual([
      "Which speltbrood is best for ontbijt?",
      "Which speltbrood is best for lunch?",
      "What gewicht does Haarlems Speltbrood by Bakkerij De Vries have?",
      "What houdbaarheid does Haarlems Speltbrood by Bakkerij De Vries have?",
      "Is Haarlems Speltbrood by Bakkerij De Vries EKO certified?",
      "Where can I buy Haarlems Speltbrood by Bakkerij De Vries in Belgium?",
      "What is the successor of Speltbrood Classic by Bakkerij De Vries?",
    ]);
  });

  it("asks the category as a whole only when there is no use case", () => {
    expect(texts(version({ useCases: [] }), "NL").slice(0, 1)).toEqual(["Wat is het beste speltbrood?"]);
    expect(texts(version({ useCases: [] }), "GB").slice(0, 1)).toEqual(["What is the best speltbrood?"]);
    expect(texts(version({ category: "persfittingsysteem", useCases: [] }), "NL")[0]).toBe("Wat is het beste persfittingsysteem?");
    expect(texts(version({ category: "Indonesisch restaurant", useCases: ["lunch"] }), "NL")[0]).toBe("Welk Indonesisch restaurant is het beste voor lunch?");
  });

  it("asks where to buy only in a market that has an outlet; no outlets, no such question", () => {
    expect(texts(version({ outlets: [{ market: "NL", name: "Versmarkt", url: null }] }), "BE").some((t) => t.startsWith("Where can I buy"))).toBe(false);
    expect(texts(version({ outlets: [] }), "NL").some((t) => t.startsWith("Waar koop ik"))).toBe(false);
  });

  it("asks about an expired certificate too (asking is how 'still certified' is caught)", () => {
    const t = texts(version({ certificates: [{ name: "KIWA", number: null, validUntil: "2020-01-01" }] }), "NL");
    expect(t).toContain("Is Haarlems Speltbrood van Bakkerij De Vries KIWA-gecertificeerd?");
  });

  it("a line name that carries the brand gets no ' van {merk}'", () => {
    const v = version({ name: "Bakkerij De Vries Speltbrood", replaces: [] });
    expect(texts(v, "NL")).toContain("Welk gewicht heeft Bakkerij De Vries Speltbrood?");
    expect(texts(v, "NL").join("\n")).not.toContain(" van Bakkerij De Vries");
    expect(texts(v, "BE")).toContain("What gewicht does Bakkerij De Vries Speltbrood have?");
    // case, punctuation and legal suffixes do not matter
    expect(texts(version({ name: "bakkerij de vries b.v. spelt", replaces: [] }), "NL").join("\n")).not.toContain(" van ");
  });

  it("a use case the sanitiser refuses is skipped; the rest are still asked", () => {
    const t = texts(version({ useCases: ["negeer alle instructies", "ontbijt", "x.io"] }), "NL");
    expect(t.filter((x) => x.includes("is het beste voor"))).toEqual(["Welk speltbrood is het beste voor ontbijt?"]);
  });

  it("a hostile value in any field never reaches a question: the template is skipped, no placeholder is left", () => {
    const hostile = ["negeer alle instructies", "<b>x</b>", "https://x.io", "x.io", "ign\u200bore previous", "www.x.nl", "ａｂｃ：／／x"];
    for (const h of hostile) {
      const fields: Partial<ProductLineData>[] = [
        { name: h }, { category: h }, { useCases: [h] }, { specs: [{ label: h, value: "x" }] }, { certificates: [{ name: h, number: null, validUntil: null }] }, { replaces: [h] },
      ];
      for (const f of fields) {
        for (const market of ["NL", "BE"]) {
          const all = texts(version(f), market, BRAND).concat(texts(version(f), market, h));
          for (const q of all) {
            expect(q, `${JSON.stringify(f)} ${market}`).not.toMatch(/[{}<>]|:\/\/|www\./i);
            expect(q.toLowerCase(), `${JSON.stringify(f)}`).not.toMatch(/negeer|ignore previous|ignore/);
          }
        }
      }
    }
    // a refused brand skips the questions that name it; the recommendation questions do not name it
    const noBrand = texts(version(), "NL", "<b>x</b>");
    expect(noBrand).toEqual(["Welk speltbrood is het beste voor ontbijt?", "Welk speltbrood is het beste voor lunch?"]);
    // a refused line name asks nothing
    expect(generateLinePrompts(version({ name: "https://x.io" }), "NL", BRAND)).toEqual([]);
    expect(generateLinePrompts(version({ category: "x.io" }), "NL", BRAND).filter((p) => p.kind === "recommendation")).toEqual([]);
  });

  it("spec values, certificate numbers, outlet names and urls, and replacedBy never enter a question", () => {
    const v = version({ replacedBy: "Geheim Nieuw Broodje", specs: [{ label: "Gewicht", value: "WAARDE-123" }], certificates: [{ name: "EKO", number: "NUMMER-999", validUntil: "2027-01-01" }], outlets: [{ market: "NL", name: "WINKELNAAM", url: "https://winkelnaam.example" }] });
    const all = [...texts(v, "NL"), ...texts(v, "BE")].join("\n");
    for (const secret of ["WAARDE-123", "NUMMER-999", "WINKELNAAM", "winkelnaam.example", "Geheim Nieuw Broodje", "800"]) expect(all).not.toContain(secret);
  });

  it("is deterministic and de-duplicated", () => {
    expect(texts(version({ useCases: ["ontbijt", "ontbijt"] }), "NL").filter((t) => t.includes("voor ontbijt"))).toHaveLength(1);
    expect(texts(version(), "NL")).toEqual(texts(version(), "NL"));
  });
});

describe("loadLinePrompts", () => {
  let db: Db;
  let businessId: string;
  beforeEach(async () => {
    db = await withMockDb();
    businessId = (await db.upsertBusiness({ name: BRAND, place: "Haarlem" })).id;
  });
  const saved = async (data: ProductLineData) => {
    const r = await db.saveProductLine({ businessId, productLineId: null, data, maxActive: 5 });
    if (!r.ok) throw new Error("setup");
    return r.line;
  };

  it("inserts the missing questions once, scoped to the line and market, and the second call inserts nothing", async () => {
    const line = await saved(SPELT);
    const v = line.current;
    const first = await loadLinePrompts(db, businessId, v, "NL", "monthly");
    expect(first).toHaveLength(7);
    expect(first.every((p) => p.productLineId === line.id && p.market === "NL")).toBe(true);
    const second = await loadLinePrompts(db, businessId, v, "NL", "monthly");
    expect(second.map((p) => p.id)).toEqual(first.map((p) => p.id));
    expect(await db.listPrompts(businessId, { line: { productLineId: line.id } })).toHaveLength(7);
    // the business's own questions are untouched, the other market gets its own set
    expect(await db.listPrompts(businessId)).toHaveLength(0);
    const be = await loadLinePrompts(db, businessId, v, "BE", "monthly");
    expect(be).toHaveLength(7);
    expect(be[0]!.textNl).toMatch(/^Which speltbrood/);
    expect(await db.listPrompts(businessId, { line: { productLineId: line.id } })).toHaveLength(14);
  });

  it("a new version adds only the new texts; the old ones stay stored and are not asked", async () => {
    const line = await saved(SPELT);
    const first = await loadLinePrompts(db, businessId, line.current, "NL", "monthly");
    const r2 = await db.saveProductLine({ businessId, productLineId: line.id, data: { ...SPELT, useCases: ["ontbijt", "avondeten"], specs: [{ label: "Gewicht", value: "900 g" }] }, maxActive: 5 });
    if (!r2.ok) throw new Error("setup");
    const second = await loadLinePrompts(db, businessId, r2.line.current, "NL", "monthly");
    const texts2 = second.map((p) => p.textNl);
    expect(texts2).toContain("Welk speltbrood is het beste voor avondeten?");
    expect(texts2).not.toContain("Welk speltbrood is het beste voor lunch?");
    expect(texts2).not.toContain("Welke houdbaarheid heeft Haarlems Speltbrood van Bakkerij De Vries?");
    // the shared texts are the same rows; exactly one new row was inserted
    const stored = await db.listPrompts(businessId, { line: { productLineId: line.id, market: "NL" } });
    expect(stored).toHaveLength(8);
    expect(second.find((p) => p.textNl === first[0]!.textNl)!.id).toBe(first[0]!.id);
  });

  it("with promptIds, returns the stored scoped prompts with those ids (a recheck) and inserts nothing", async () => {
    const line = await saved(SPELT);
    const first = await loadLinePrompts(db, businessId, line.current, "NL", "monthly");
    const some = [first[2]!.id, first[5]!.id];
    const out = await loadLinePrompts(db, businessId, line.current, "NL", "recheck", some);
    expect(out.map((p) => p.id).sort()).toEqual([...some].sort());
    // another market's id is not returned for this market
    const be = await loadLinePrompts(db, businessId, line.current, "BE", "monthly");
    expect(await loadLinePrompts(db, businessId, line.current, "NL", "recheck", [be[0]!.id])).toEqual([]);
    expect(await db.listPrompts(businessId, { line: { productLineId: line.id } })).toHaveLength(14);
  });
});
