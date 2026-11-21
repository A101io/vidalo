import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared";
import { createMockEngine, runScan } from "../src/scanner";
import { monthlyReportEmail, type LineMailSection, type MonthlyReportData } from "../src/reporter/templates";
import { sendMonthlyReport } from "../src/reporter";
import { mailPath, productLineUrl } from "../src/reporter/links";
import { copy } from "../src/copy";
import { en } from "../src/copy/en";
import type { Finding, ProductLineData } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";

const links = { dashboardUrl: "https://vidalo.ai/app", factsPageUrl: "https://vidalo.ai/feiten/x" };
const base: MonthlyReportData = {
  business: { name: "Bakkerij De Vries", place: "Haarlem" }, month: "november 2026", checkedAt: "2026-11-07T04:00:00.000Z", totalAnswers: 30, wrongAnswers: 0,
  resolved: 0, inProgress: 0, unfixable: 0, proofCards: [], openFindings: [], links, engines: ["chatgpt"], stip: "groen",
};
const finding = (over: Partial<Finding> = {}): Finding => ({
  id: "f1", businessId: "b", scanRunId: "r", factKey: "spec", subject: "Gewicht", engine: "chatgpt", verdict: "wrong", wrongValue: "500 g", correctValue: "800 g", frequency: 4, sampleCount: 5,
  sourceUrl: null, sourceType: "none", status: "open", firstSeenAt: "2026-10-01T00:00:00.000Z", resolvedAt: null, evidenceBefore: null, evidenceAfter: null, evidenceKind: "about", criterium: 13, productLineId: "l1", market: "NL", ...over,
});
const section = (over: Partial<LineMailSection> = {}): LineMailSection => ({
  name: "Haarlems Speltbrood", detailUrl: "https://vidalo.ai/app/productlijnen/l1",
  markets: [
    { market: "NL", marketName: "Nederland", checked: true, stip: "groen", openErrors: 0, named: { named: 3, answers: 10 } },
    { market: "BE", marketName: "België", checked: true, stip: "oranje", openErrors: 2, named: { named: 0, answers: 5 } },
  ],
  openFindings: [{ finding: finding(), nextStep: "volgende stap", since: "2026-10-01T00:00:00.000Z" }],
  ...over,
});
const all = (m: { subject: string; text: string; html: string }) => `${m.subject}\n${m.text}\n${m.html.replace(/<[^>]*>/g, " ")}`;
const BANNED = /score|ranking|positie|plek \d|€|gratis|inbegrepen|%|GEO|AEO|LLM|prompt|zichtbaarheid|platform|position|free|included/i;

describe("monthly mail: product line sections", () => {
  it("a business without lines renders exactly the mail it always did (snapshot), also with an empty list", () => {
    const today = monthlyReportEmail(base);
    expect(monthlyReportEmail({ ...base, lines: [] })).toEqual(today);
    expect(today.text).not.toMatch(/Productlijn|Product line/);
    expect(today).toMatchSnapshot();
    const en1 = monthlyReportEmail({ ...base, lang: "en" });
    expect(monthlyReportEmail({ ...base, lang: "en", lines: [] })).toEqual(en1);
    expect(en1).toMatchSnapshot();
  });

  it("renders a section per line, after the business blocks and before the button, in Dutch", () => {
    const m = monthlyReportEmail({ ...base, lines: [section(), section({ name: "Kerststol", markets: [{ market: "NL", marketName: "Nederland", checked: false, stip: null, openErrors: 0, named: null }], openFindings: [] })] });
    expect(m.text).toContain("Productlijn: Haarlems Speltbrood");
    expect(m.text).toContain("Nederland: groen. Geen fouten open. Genoemd als aanrader: 3 van 10 keer.");
    expect(m.text).toContain("België: oranje. 2 fouten open. Genoemd als aanrader: 0 van 5 keer.");
    expect(m.text).toContain("Nederland: nog niet gecontroleerd.");
    expect(m.text).toContain("https://vidalo.ai/app/productlijnen/l1");
    expect(m.text.indexOf("Productlijn: Haarlems Speltbrood")).toBeLessThan(m.text.indexOf(copy.mails.monthly.cta));
    expect(all(m)).not.toMatch(BANNED);
  });

  it("renders in English for an English owner", () => {
    const m = monthlyReportEmail({ ...base, lang: "en", lines: [section({ detailUrl: "https://vidalo.ai/en/app/product-lines/l1", markets: [section().markets[0]!, { ...section().markets[1]!, checked: false, stip: null, named: null }] })] });
    expect(m.text).toContain("Product line: Haarlems Speltbrood");
    expect(m.text).toContain("Named as a recommendation: 3 of 10 times.");
    expect(m.text).toContain("België: not checked yet.");
    expect(m.text).toContain("No errors open.");
    expect(all(m)).not.toMatch(BANNED);
  });

  it("an outlet finding is 'not in your list', never 'wrong' (CMP-602)", () => {
    const outlet = finding({ factKey: "outlet", subject: null as unknown as string, wrongValue: "Gentse Warenwinkel", correctValue: "Broodhuys Gent", market: "BE" });
    for (const lang of ["nl", "en"] as const) {
      const m = monthlyReportEmail({ ...base, lang, lines: [section({ openFindings: [{ finding: outlet, nextStep: "x", since: "2026-10-01T00:00:00.000Z" }] })] });
      expect(m.text).toContain("Gentse Warenwinkel");
      expect(m.text).not.toMatch(/Klopt niet|Het is:|Not right|It is:/i);
      expect(m.text).not.toContain("Broodhuys Gent");
      expect(m.text).toContain((lang === "nl" ? copy : en).productLines.detail.outletNote);
    }
  });

  it("names the AI systems the line checks asked, and the last check of a market not checked this month (CMP-603, CMP-604)", () => {
    const mk = (over: object) => section({ markets: [{ market: "NL", marketName: "Nederland", checked: true, stip: "groen", openErrors: 0, named: null, engines: ["chatgpt", "google_ai", "perplexity"], ...over } as LineMailSection["markets"][number]] });
    expect(monthlyReportEmail({ ...base, lines: [mk({})] }).text).toContain("Gevraagd aan ChatGPT, Google AI en Perplexity.");
    expect(monthlyReportEmail({ ...base, lang: "en", lines: [mk({})] }).text).toContain("Asked to ChatGPT, Google AI and Perplexity.");
    const earlier = monthlyReportEmail({ ...base, lines: [mk({ checked: false, stip: null, engines: [], lastChecked: "10 oktober" })] }).text;
    expect(earlier).toContain("Nederland: deze maand niet gecontroleerd. Laatste controle: 10 oktober.");
    expect(earlier).not.toContain("nog niet gecontroleerd");
  });

  it("shows three finding cards at most and counts the rest", () => {
    const open = [1, 2, 3, 4, 5].map((i) => ({ finding: finding({ id: `f${i}`, subject: `Spec ${i}` }), nextStep: "x", since: "2026-10-01T00:00:00.000Z" }));
    const m = monthlyReportEmail({ ...base, lines: [section({ openFindings: open })] });
    expect(m.text).toContain("En nog 2 open bij deze productlijn.");
    expect((m.text.match(/500 g/g) ?? []).length).toBeLessThanOrEqual(3);
  });

  it("escapes the line's name and what AI named (S-31); the subject stays the business's", () => {
    const hostile = monthlyReportEmail({ ...base, lines: [section({ name: `Brood & "Co" <b>x</b>`, openFindings: [{ finding: finding({ wrongValue: "<script>x</script>" }), nextStep: "x", since: "2026-10-01T00:00:00.000Z" }] })] });
    expect(hostile.html).not.toContain("<script>");
    expect(hostile.html).not.toContain("<b>x</b>");
    expect(hostile.html).toContain("&amp;");
    expect(hostile.subject).toBe(monthlyReportEmail(base).subject);
  });

  it("has the line wording in both languages, in the same shape, without price or position words", () => {
    for (const L of [copy.mails.monthly.lines, en.mails.monthly.lines]) {
      const words = [L.title("X"), L.market("Y", "groen", 2, { named: 1, answers: 2 }), L.market("Y", "groen", 0, null), L.market("Y", "groen", 1, null), L.notChecked("Y"), L.more(2), L.cta].join(" ");
      expect(words).not.toMatch(BANNED);
    }
    expect(Object.keys(en.mails.monthly.lines)).toEqual(Object.keys(copy.mails.monthly.lines));
  });

  it("the link is the origin and the line id; English owners get /en/app/product-lines", () => {
    expect(mailPath("/app/productlijnen/abc", "en")).toBe("/en/app/product-lines/abc");
    expect(mailPath("/app/productlijnen/abc", "nl")).toBe("/app/productlijnen/abc");
    expect(mailPath("/app/gegevens", "en")).toBe("/en/app/gegevens");
    expect(productLineUrl({ language: "en" }, "abc")).toMatch(/\/en\/app\/product-lines\/abc$/);
    expect(productLineUrl({ language: "nl" }, "a b")).toMatch(/\/app\/productlijnen\/a%20b$/);
  });
});

describe("sendMonthlyReport builds the sections from the month's line runs", () => {
  let db: MemDb;
  let outDir: string;
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    db = new MemDb();
    setDb(db);
    outDir = await mkdtemp(path.join(tmpdir(), "vidalo-line-mail-"));
    process.env.VIDALO_OUT_DIR = outDir;
    process.env.UNSUBSCRIBE_SECRET ??= "test-secret";
    process.env.VIDALO_MOCK = "1";
  });
  afterEach(() => vi.useRealTimers());

  const SPELT: ProductLineData = { name: "Haarlems Speltbrood", category: "speltbrood", useCases: ["ontbijt"], markets: ["NL", "BE"], specs: [{ label: "Gewicht", value: "800 g" }], certificates: [], outlets: [], replaces: [], replacedBy: null };
  async function setup(language: "nl" | "en") {
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status: "active", plan: "monitor", ownerEmail: "eigenaar@example.nl", language });
    await db.insertFacts(b.id, sampleFacts({ businessId: b.id }), { provisional: false });
    const r = await db.saveProductLine({ businessId: b.id, productLineId: null, data: SPELT, maxActive: 5 });
    if (!r.ok) throw new Error("setup");
    return { b, line: r.line };
  }
  const eml = async (res: { file?: string } | null) => (await readFile(res!.file!, "utf8")).replace(/=\r?\n/g, "");

  it("Dutch: the NL run is there, the BE run is missing: 'nog niet gecontroleerd'; the line's findings are in, the business's counts are not changed by them", async () => {
    const { b, line } = await setup("nl");
    await runScan({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], clients: [createMockEngine("chatgpt", { wrongPairRate: 1 })], db, productLineId: line.id, market: "NL" });
    const withLine = await sendMonthlyReport(b.id, { monthLabel: "november 2026" });
    const text = await eml(withLine);
    expect(text).toContain("Productlijn: Haarlems Speltbrood");
    expect(text).toMatch(/Nederland: (rood|oranje|groen|grijs)\./);
    expect(text).toContain("België: nog niet gecontroleerd.");
    expect(text).toContain(`/app/productlijnen/${line.id}`);
    expect(text).not.toMatch(/Welke gewicht|500 g.*500 g.*500 g.*500 g/);
    // the business line of the mail does not know the line: no line finding in its counts
    expect(db.events.find((e) => e.type === "email.report")?.payload).toMatchObject({ open: 0 });
  });

  it("a market checked in an earlier month says when, and the checked market names the AI systems asked (CMP-603, CMP-604)", async () => {
    const { b, line } = await setup("nl");
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    await runScan({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], clients: [createMockEngine("chatgpt", { wrongPairRate: 0 })], db, productLineId: line.id, market: "BE" });
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    await runScan({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], clients: [createMockEngine("chatgpt", { wrongPairRate: 0 })], db, productLineId: line.id, market: "NL" });
    const text = await eml(await sendMonthlyReport(b.id, { monthLabel: "november 2026" }));
    expect(text).toContain("België: deze maand niet gecontroleerd. Laatste controle: 10 oktober.");
    expect(text).not.toContain("nog niet gecontroleerd");
    expect(text).toContain("Gevraagd aan ChatGPT.");
  });

  it("English: the sections are English and the link is the English path; a business without lines gets no section", async () => {
    const { b, line } = await setup("en");
    await runScan({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], clients: [createMockEngine("chatgpt", { wrongPairRate: 0 })], db, productLineId: line.id, market: "BE" });
    const text = await eml(await sendMonthlyReport(b.id, { monthLabel: "November 2026" }));
    expect(text).toContain("Product line: Haarlems Speltbrood");
    expect(text).toContain("Belgium:");
    expect(text).toContain("Netherlands: not checked yet.");
    expect(text).toContain(`/en/app/product-lines/${line.id}`);
    const plain = await db.upsertBusiness({ name: "Zonder Lijnen", place: "Utrecht", status: "active", plan: "monitor", ownerEmail: "x@example.nl" });
    await db.insertFacts(plain.id, sampleFacts({ businessId: plain.id }), { provisional: false });
    expect(await eml(await sendMonthlyReport(plain.id, { monthLabel: "november 2026" }))).not.toMatch(/Productlijn|Product line/);
  });

  it("a discontinued line is not in the mail", async () => {
    const { b, line } = await setup("nl");
    await db.setProductLineStatus({ businessId: b.id, productLineId: line.id, status: "discontinued", maxActive: 5 });
    expect(await eml(await sendMonthlyReport(b.id, { monthLabel: "november 2026" }))).not.toContain("Productlijn");
  });
});
