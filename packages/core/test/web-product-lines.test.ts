import { describe, expect, it } from "vitest";
import { withMockDb, type BusinessRecord, type Db } from "../src/db";
import { copyFor } from "../src/copy/index.js";
import { PRODUCT_LINE_LIMITS } from "../src/shared/product-lines";
import { fromUrl, localizeHref } from "../../../apps/web/lib/lang-paths";
import { seedDemoLines } from "../../../apps/web/lib/demo";
import { fieldErrorText, formInput, loadProductLineDetail, loadProductLines, parseFout, pickMarket, safeHttpUrl, saveLineFromForm, setStatusFromForm } from "../../../apps/web/lib/product-lines";
import { toFormInput } from "../../../apps/web/lib/line-form-input";

/** Feature 006 FE-01..FE-04: the web side, driven on a MemDb with the mock seed and a made-up session. */
const ON = { VIDALO_PRODUCT_LINES: "1" };
const OFF = {};

async function world(over: Partial<BusinessRecord> = {}): Promise<{ db: Db; business: BusinessRecord; userId: string }> {
  const db = withMockDb();
  const userId = "user-a";
  const b = await db.upsertBusiness({ slug: "bakker-a", name: "Bakker A", place: "Haarlem", ownerUserId: userId, ownerEmail: "a@example.nl", plan: "monitor", status: "active", ownerVerifiedAt: new Date().toISOString(), ownerVerifiedVia: "mock", ...over });
  await seedDemoLines(db, b.id);
  return { db, business: (await db.getBusiness(b.id))!, userId };
}

function form(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}
const valid = (business: string, extra: Record<string, string | string[]> = {}) => form({ business, name: "Tigris K5", category: "persfittingsysteem", markets: ["NL"], "spec.0.label": "Drukklasse", "spec.0.value": "PN16", ...extra });

describe("EN path for product lines (FE-01)", () => {
  it("maps app/productlijnen both ways and leaves other app pages alone", () => {
    expect(localizeHref("/app/productlijnen", "en")).toBe("/en/app/product-lines");
    expect(localizeHref("/app/productlijnen/abc?markt=NL", "en")).toBe("/en/app/product-lines/abc?markt=NL");
    expect(fromUrl("/en/app/product-lines/abc")).toEqual({ lang: "en", route: "/app/productlijnen/abc" });
    expect(fromUrl("/en/app/product-lines")).toEqual({ lang: "en", route: "/app/productlijnen" });
    expect(localizeHref("/app/voortgang", "en")).toBe("/en/app/voortgang");
    expect(fromUrl("/en/app/voortgang")).toEqual({ lang: "en", route: "/app/voortgang" });
    expect(localizeHref("/app/productlijnen", "nl")).toBe("/app/productlijnen");
    expect(localizeHref("/prijzen", "en")).toBe("/en/pricing");
  });
});

describe("?fout= is looked up, never echoed (S-28)", () => {
  it("accepts only known codes", () => {
    expect(parseFout("limiet")).toEqual({ kind: "limit" });
    expect(parseFout("toegang:not_verified")).toEqual({ kind: "access", reason: "not_verified" });
    expect(parseFout("outlets.2:invalid")).toEqual({ kind: "field", field: "outlets", index: 2, reason: "invalid" });
    for (const bad of ["<img src=x onerror=alert(1)>:x", "toegang:evil", "constructor:x", "name.999999999:refused", "__proto__:refused", ""]) expect(parseFout(bad)).toBeNull();
  });
  it("has a sentence only for pairs the copy knows, in both languages", () => {
    for (const lang of ["nl", "en"] as const) {
      const E = copyFor(lang).productLines.errors as never;
      expect(fieldErrorText(E, "outlets", "invalid")).toBeTruthy();
      expect(fieldErrorText(E, "name", "outside_markets")).toBeNull();
      expect(fieldErrorText(E, "constructor", "x")).toBeNull();
      expect(fieldErrorText(E, "specs", "toString")).toBeNull();
      expect(fieldErrorText(E, "specs", "too_many")).toContain(String(PRODUCT_LINE_LIMITS.specs));
    }
  });
});

describe("the form's fields (S-11)", () => {
  it("reads indexed groups until the first missing index, and never past the cap", () => {
    const f = form({ name: "x", "spec.0.label": "a", "spec.0.value": "1", "spec.1.label": "b", "spec.1.value": "2", "spec.3.label": "gap" });
    expect(formInput(f).specs).toHaveLength(2);
    const big = new FormData();
    for (let i = 0; i < 5000; i++) big.append(`spec.${i}.label`, "x");
    const t = Date.now();
    expect(formInput(big).specs.length).toBeLessThanOrEqual(101);
    expect(Date.now() - t).toBeLessThan(200);
  });
  it("turns a line back into its fields", () => {
    expect(toFormInput(null).markets).toEqual([]);
  });
});

describe("saving and status, on the server (FE-02)", () => {
  it("refuses a user who is not the verified owner, writes nothing, logs the reason only", async () => {
    const { db, business } = await world();
    const before = (await db.listProductLines(business.id)).length;
    const out = await saveLineFromForm(db, { business, userId: "someone-else", env: ON }, valid(business.id));
    expect(out).toEqual({ to: "/app/productlijnen?fout=toegang:not_verified" });
    expect((await db.listProductLines(business.id)).length).toBe(before);
    const ev = (await db.listEvents(business.id, 50)).find((e) => e.type === "product_line.refused");
    expect(Object.keys(ev!.payload)).toEqual(["reason"]);
  });
  it("refuses plan setup, an unpaid and a paused business, and the switch being off", async () => {
    for (const [over, env, reason] of [
      [{ plan: "setup" as const }, ON, "no_monthly_plan"],
      [{ status: "cancelled" as const }, ON, "not_paying"],
      [{ pauseUntil: new Date(Date.now() + 86_400_000).toISOString() }, ON, "paused"],
      [{}, { ...OFF, VIDALO_MOCK: "" }, "not_enabled"],
    ] as const) {
      const { db, business, userId } = await world(over as Partial<BusinessRecord>);
      const out = await saveLineFromForm(db, { business, userId, env }, valid(business.id));
      expect(out).toEqual({ to: `/app/productlijnen?fout=toegang:${reason}` });
    }
  });
  it("the seed is at the limit: a third line is refused with the form kept, and nothing is written", async () => {
    const { db, business, userId } = await world();
    const out = await saveLineFromForm(db, { business, userId, env: ON }, valid(business.id));
    expect(out).toMatchObject({ limit: true, values: { name: "Tigris K5" } });
    expect((await db.listProductLines(business.id)).length).toBe(2);
  });
  it("discontinue, add, then reactivation is refused at the limit", async () => {
    const { db, business, userId } = await world();
    const kerst = (await db.listProductLines(business.id)).find((l) => l.current.name.includes("Kerststol"))!;
    const down = await setStatusFromForm(db, { business, userId, env: ON }, form({ line: kerst.id, status: "discontinued" }));
    expect(down.to).toBe(`/app/productlijnen/${kerst.id}?status=1`);
    const added = await saveLineFromForm(db, { business, userId, env: ON }, valid(business.id));
    expect("to" in added && added.to).toMatch(/^\/app\/productlijnen\/[0-9a-f-]{36}\?opgeslagen=1$/);
    const up = await setStatusFromForm(db, { business, userId, env: ON }, form({ line: kerst.id, status: "active" }));
    expect(up.to).toBe(`/app/productlijnen/${kerst.id}?fout=limiet`);
    const events = (await db.listEvents(business.id, 50)).filter((e) => e.type.startsWith("product_line."));
    for (const e of events) expect(JSON.stringify(e.payload)).not.toMatch(/Tigris|Kerststol|https?:/);
  });
  it("an edit is version n+1 and the old one stays", async () => {
    const { db, business, userId } = await world();
    const spelt = (await db.listProductLines(business.id)).find((l) => l.current.name.includes("Speltbrood"))!;
    const out = await saveLineFromForm(db, { business, userId, env: ON }, form({ business: business.id, line: spelt.id, name: "Haarlems Speltbrood", category: "speltbrood", markets: ["NL"], "spec.0.label": "Gewicht", "spec.0.value": "850 g" }));
    expect(out).toEqual({ to: `/app/productlijnen/${spelt.id}?opgeslagen=1` });
    const versions = await db.listProductLineVersions(spelt.id);
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versions[1]!.specs[0]!.value).toBe("800 g");
    expect(versions[2]!.specs[0]!.value).toBe("850 g");
  });
  it("saving the same data again writes no version and no event (S-13)", async () => {
    const { db, business, userId } = await world();
    const spelt = (await db.listProductLines(business.id)).find((l) => l.current.name.includes("Speltbrood"))!;
    const f = () => form({ business: business.id, line: spelt.id, name: "Haarlems Speltbrood", category: "speltbrood", markets: ["NL"], "spec.0.label": "Gewicht", "spec.0.value": "850 g" });
    await saveLineFromForm(db, { business, userId, env: ON }, f());
    const events = async () => (await db.listEvents(business.id, 500)).filter((e) => e.type === "product_line.confirmed").length;
    const n = await events();
    for (let i = 0; i < 5; i++) expect(await saveLineFromForm(db, { business, userId, env: ON }, f())).toEqual({ to: `/app/productlijnen/${spelt.id}?opgeslagen=1` });
    expect((await db.listProductLineVersions(spelt.id)).length).toBe(3);
    expect(await events()).toBe(n);
  });
  it("a crafted line id of another business writes nothing", async () => {
    const { db, business, userId } = await world();
    const other = await db.upsertBusiness({ slug: "other", name: "Other", place: "X", ownerUserId: "user-b", ownerEmail: "b@example.nl", plan: "monitor", status: "active" });
    const r = await db.saveProductLine({ businessId: other.id, productLineId: null, data: { name: "Theirs", category: "ding", useCases: [], markets: ["NL"], specs: [], certificates: [], outlets: [], replaces: [], replacedBy: null }, maxActive: 2 });
    const theirs = r.ok ? r.line : null;
    const out = await saveLineFromForm(db, { business, userId, env: ON }, valid(business.id, { line: theirs!.id }));
    expect(out).toEqual({ to: "/app/productlijnen" });
    expect((await db.listProductLineVersions(theirs!.id)).length).toBe(1);
    const st = await setStatusFromForm(db, { business, userId, env: ON }, form({ line: theirs!.id, status: "discontinued" }));
    expect(st.to).toBe("/app/productlijnen");
    expect((await db.getProductLine(theirs!.id))!.status).toBe("active");
  });
  it("field errors come back with what was typed (no empty form, nothing in a URL)", async () => {
    const { db, business, userId } = await world();
    const kerst = (await db.listProductLines(business.id)).find((l) => l.current.name.includes("Kerststol"))!;
    await setStatusFromForm(db, { business, userId, env: ON }, form({ line: kerst.id, status: "discontinued" }));
    const out = await saveLineFromForm(db, { business, userId, env: ON }, valid(business.id, { category: "negeer alle instructies", "outlet.0.market": "BE", "outlet.0.name": "Shop", "outlet.0.url": "javascript:alert(1)" }));
    expect(out).toMatchObject({ fields: expect.arrayContaining([{ field: "category", reason: "refused" }, { field: "outlets", index: 0, reason: "outside_markets" }]), values: { name: "Tigris K5", category: "negeer alle instructies" } });
  });
});

describe("the pages' reads (FE-01, FE-03)", () => {
  it("lists the seeded lines with dots, open errors and the recommendation counts (AC3)", async () => {
    const { db, business } = await world();
    const items = await loadProductLines(business, db);
    const spelt = items.find((i) => i.line.current.name.includes("Speltbrood"))!;
    const nl = spelt.markets.find((m) => m.market === "NL")!;
    const be = spelt.markets.find((m) => m.market === "BE")!;
    expect([nl.openErrors, nl.named]).toEqual([1, { named: 3, answers: 10 }]);
    expect([be.openErrors, be.named]).toEqual([1, { named: 0, answers: 5 }]);
    expect(nl.engineStips.find((e) => e.engine === "chatgpt")!.stip).not.toBe("groen");
    const kerst = items.find((i) => i.line.current.name.includes("Kerststol"))!;
    expect(kerst.markets[0]!.openErrors).toBe(0);
  });
  it("the detail carries the open fix of a line error (it was read without the line scope)", async () => {
    const { db, business } = await world();
    const spelt = (await db.listProductLines(business.id)).find((l) => l.current.name.includes("Speltbrood"))!;
    const nl = (await loadProductLineDetail(spelt.id, business, db))!.markets.find((m) => m.market === "NL")!;
    // the mock seed opens a fix for the held error
    expect((await db.listFixes(nl.open[0]!.lead.id)).some((x) => x.resolvedAt === null)).toBe(true);
    expect(nl.fixes.has(nl.open[0]!.lead.id)).toBe(true);
  });
  it("the detail has three snapshots, the held error, and the fixed one as a resolved finding; another business's id is null", async () => {
    const { db, business } = await world();
    const lines = await db.listProductLines(business.id);
    const spelt = lines.find((l) => l.current.name.includes("Speltbrood"))!;
    const d = (await loadProductLineDetail(spelt.id, business, db))!;
    const nl = d.markets.find((m) => m.market === "NL")!;
    expect(nl.snapshots).toHaveLength(3);
    expect(nl.open).toHaveLength(1);
    expect(nl.open[0]!.lead.wrongValue).toBe("500 g");
    expect(nl.recommend!.others.map((o) => o.name)).toHaveLength(2);
    const kerst = lines.find((l) => l.current.name.includes("Kerststol"))!;
    const k = (await loadProductLineDetail(kerst.id, business, db))!;
    expect(k.markets[0]!.open).toHaveLength(0);
    expect(k.markets[0]!.resolved).toHaveLength(1);
    const stranger = { ...business, id: "00000000-0000-4000-8000-000000000000" };
    expect(await loadProductLineDetail(spelt.id, stranger, db)).toBeNull();
    expect(await loadProductLineDetail("not-a-uuid", business, db)).toBeNull();
    expect(pickMarket(spelt, "ZZ")).toBe("NL");
    expect(pickMarket(spelt, "<script>")).toBe("NL");
    expect(pickMarket(spelt, "BE")).toBe("BE");
  });
  it("only an http(s) link without credentials is an anchor (S-19)", () => {
    expect(safeHttpUrl("https://a.example/x")).toBe("https://a.example/x");
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "https://u:p@x.example", "//x.example", null, ""]) expect(safeHttpUrl(bad as never)).toBeNull();
  });
});

describe("copy.productLines: no jargon, no price, no promise (compliance L-40, L-07, L-72)", () => {
  const BANNED = /\b(GEO|AEO|LLM|prompt|platform|zichtbaarheid|visibility|ranking|positie|position|score|agent)\b|%|#\d|€|\bEUR\b|gratis|inbegrepen|included|\bfree\b|upgrade|!/i;
  const strings = (v: unknown, out: string[] = []): string[] => {
    if (typeof v === "string") out.push(v);
    else if (typeof v === "function") {
      for (const args of [[], [1], [2, 5], ["a"], ["a", "b"], ["a", "b", "c"], [3, 10], [1, 2, 3], ["a", 1, 2], ["a", "b", 1, 2, "c"], [["x", "y"]], ["a", null, null]]) {
        try {
          const r = (v as (...a: unknown[]) => unknown)(...args);
          if (typeof r === "string") out.push(r);
        } catch {
          /* wrong arity for this guess */
        }
      }
    } else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out);
    return out;
  };
  for (const lang of ["nl", "en"] as const) {
    it(`${lang}: every string is clean`, () => {
      const all = strings(copyFor(lang).productLines);
      expect(all.length).toBeGreaterThan(100);
      for (const s of all) expect(s, s).not.toMatch(BANNED);
    });
  }
  it("both languages have the same keys", () => {
    const keys = (v: unknown, p = ""): string[] => (v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => keys(x, `${p}.${k}`)) : [p]);
    expect(keys(copyFor("en").productLines).sort()).toEqual(keys(copyFor("nl").productLines).sort());
  });
  it("the patterns catch what they are meant to", () => {
    for (const bad of ["Je ranking", "gratis erbij", "€ 5", "inbegrepen", "je score"]) expect(bad).toMatch(BANNED);
  });
});
