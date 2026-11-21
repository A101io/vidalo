import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemDb } from "@vidalo/core/db";
import { setDb } from "@vidalo/core/shared";
import type { ProductLineData } from "@vidalo/core/types";
import type { Job } from "@vidalo/core/db";
import { enqueueMonthlyScans } from "../src/cron";
import { handlerFor } from "../src/jobs/index";
import { paidOnlyBlock } from "../src/jobs/paid";
import { LINE_REPORT_MAX_WAITS, LINE_REPORT_WAIT_MINUTES, report } from "../src/jobs/misc";
import { spendBlock } from "../src/jobs/spend";

// Feature 006 BE-05: monthly line runs, who may have them, the report wait, the daily ceiling.
const NOW = new Date("2026-11-07T10:00:00Z"); // 07 Nov in Amsterdam
const data = (name: string, over: Partial<ProductLineData> = {}): ProductLineData => ({
  name, category: "speltbrood", useCases: ["ontbijt"], markets: ["NL", "BE"], specs: [{ label: "Gewicht", value: "800 g" }],
  certificates: [], outlets: [], replaces: [], replacedBy: null, ...over,
});
const job = (kind: string, payload: Record<string, unknown>) => ({ id: 1, kind, payload }) as unknown as Job;

let db: MemDb;
beforeEach(() => {
  db = new MemDb();
  setDb(db);
  process.env.VIDALO_PRODUCT_LINES = "1";
});
afterEach(() => {
  delete process.env.VIDALO_PRODUCT_LINES;
  delete process.env.VIDALO_DAILY_AI_CAP_CENTS;
  vi.useRealTimers();
});

async function business(over: Record<string, unknown> = {}) {
  return db.upsertBusiness({ name: `Bakkerij ${Math.random().toString(36).slice(2, 7)}`, place: "Haarlem", status: "active", plan: "monitor", anniversaryDay: 7, ownerUserId: "u1", ownerEmail: "o@example.com", ownerVerifiedAt: "2026-10-01T00:00:00.000Z", ...over });
}
async function line(businessId: string, name: string, d: Partial<ProductLineData> = {}, maxActive = 10) {
  const r = await db.saveProductLine({ businessId, productLineId: null, data: data(name, d), maxActive });
  if (!r.ok) throw new Error("setup");
  return r.line;
}
const scans = (extra: (p: Record<string, unknown>) => boolean = () => true) => [...db.jobs.values()].filter((j) => j.kind === "scan" && extra(j.payload as Record<string, unknown>));
const stamp = () => { for (const e of db.events) e.at = NOW.toISOString(); };

describe("the monthly cron enqueues line runs", () => {
  it("one business job and one job per (active line, market), nothing for a discontinued line, once per month", async () => {
    const b = await business();
    const a = await line(b.id, "Alfa");
    await line(b.id, "Beta");
    const gone = await line(b.id, "Gamma");
    await db.setProductLineStatus({ businessId: b.id, productLineId: gone.id, status: "discontinued", maxActive: 10 });
    // the limit is 2 active lines: Gamma was active when 3 were saved at maxActive 10 and is now discontinued
    expect(await enqueueMonthlyScans(NOW)).toBe(1);
    const all = scans();
    expect(all).toHaveLength(5);
    const lineJobs = scans((p) => p.productLineId !== undefined);
    expect(lineJobs.map((j) => `${(j.payload as { productLineId: string }).productLineId === a.id ? "Alfa" : "Beta"}|${(j.payload as { market: string }).market}`).sort()).toEqual(["Alfa|BE", "Alfa|NL", "Beta|BE", "Beta|NL"]);
    expect(lineJobs.every((j) => (j.payload as { kind: string; then: string[] }).kind === "monthly" && (j.payload as { then: string[] }).then.join() === "fixes")).toBe(true);
    // two minutes apart, after the business's own
    const at = lineJobs.map((j) => new Date(j.runAt).getTime()).sort((x, y) => x - y);
    expect(at.slice(1).map((t, i) => t - at[i]!)).toEqual([120_000, 120_000, 120_000]);
    expect(at[0]).toBeGreaterThan(new Date(scans((p) => p.productLineId === undefined)[0]!.runAt).getTime());
    // a second pass, or a retried cron, in the same month enqueues nothing
    stamp();
    expect(await enqueueMonthlyScans(NOW)).toBe(0);
    expect(scans()).toHaveLength(5);
    expect(db.events.filter((e) => e.type === "scan.enqueued" && (e.payload as { productLineId?: string }).productLineId).every((e) => Boolean((e.payload as { market?: string }).market))).toBe(true);
  });

  it("an owner flooding other events cannot make the cron enqueue the month again (SEC-V01)", async () => {
    const b = await business();
    await line(b.id, "Alfa");
    expect(await enqueueMonthlyScans(NOW)).toBe(1);
    const before = scans().length;
    stamp();
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < 600; i++) await db.logEvent(b.id, "account.mail_prefs_set", { i });
      stamp();
      expect(await enqueueMonthlyScans(NOW)).toBe(0);
    }
    expect(scans()).toHaveLength(before);
  });

  it("lines discontinued and re-added between ticks do not earn new runs: a monthly budget per business (SEC-V02)", async () => {
    const b = await business();
    await line(b.id, "Alfa");
    await line(b.id, "Beta");
    await enqueueMonthlyScans(NOW);
    stamp();
    for (let pass = 0; pass < 5; pass++) {
      for (const l of await db.listProductLines(b.id)) await db.setProductLineStatus({ businessId: b.id, productLineId: l.id, status: "discontinued", maxActive: 10 });
      await line(b.id, `Nieuw ${pass} a`);
      await line(b.id, `Nieuw ${pass} b`);
      await enqueueMonthlyScans(NOW);
      stamp();
    }
    expect(scans((p) => p.productLineId !== undefined)).toHaveLength(4);
  });

  it("clamps to today's limits: 4 active lines with 5 markets give 2 lines x 2 markets (S-23)", async () => {
    const b = await business();
    for (const n of ["Een", "Twee", "Drie", "Vier"]) await line(b.id, n, { markets: ["NL", "BE", "DE", "FR", "GB"] });
    await enqueueMonthlyScans(NOW);
    const lineJobs = scans((p) => p.productLineId !== undefined);
    expect(lineJobs).toHaveLength(4);
    expect(new Set(lineJobs.map((j) => (j.payload as { productLineId: string }).productLineId)).size).toBe(2);
    stamp();
    await enqueueMonthlyScans(NOW);
    expect(scans((p) => p.productLineId !== undefined)).toHaveLength(4);
  });

  it("a business that may not have lines gets none: Vidalo Scan, paused, unverified, switch off", async () => {
    const setup = await business({ plan: "setup", status: "active" });
    const paused = await business({ pauseUntil: "2099-01-01T00:00:00.000Z" });
    const unverified = await business({ ownerVerifiedAt: null });
    for (const b of [setup, paused, unverified]) await line(b.id, "Alfa");
    await enqueueMonthlyScans(NOW);
    expect(scans((p) => p.productLineId !== undefined)).toEqual([]);
    const off = await business();
    await line(off.id, "Alfa");
    delete process.env.VIDALO_PRODUCT_LINES;
    delete process.env.VIDALO_MOCK;
    await enqueueMonthlyScans(NOW);
    expect(scans((p) => p.productLineId !== undefined && p.businessId === off.id)).toEqual([]);
  });

  it("a line added after the month's business check is still picked up in that month's pass, once", async () => {
    const b = await business();
    await enqueueMonthlyScans(NOW);
    stamp();
    await line(b.id, "Laat");
    expect(await enqueueMonthlyScans(NOW)).toBe(0);
    expect(scans((p) => p.productLineId !== undefined)).toHaveLength(2);
  });
});

describe("a line scan is gated when it runs (S-20)", () => {
  async function setup(over: Record<string, unknown> = {}) {
    const b = await business(over);
    const l = await line(b.id, "Alfa");
    return { b, l, payload: { businessId: b.id, kind: "monthly", productLineId: l.id, market: "NL", then: ["fixes"] } };
  }
  const calls = async (businessId: string) => (await db.listScanRuns(businessId, 50, { productLineId: (await db.listProductLines(businessId))[0]?.id ?? "x" })).length;

  it("lets an allowed line run through", async () => {
    const { payload } = await setup();
    expect(await paidOnlyBlock("scan", payload)).toBeNull();
  });
  for (const [label, over, reason] of [
    ["not paying", { status: "scanned" }, "not_paying:scanned"],
    ["paused", { pauseUntil: "2099-01-01T00:00:00.000Z" }, "paused_by_owner"],
    ["not verified", { ownerVerifiedAt: null }, "owner_not_verified"],
    ["on Vidalo Scan (plan setup)", { plan: "setup" }, "line_no_monthly_plan"],
  ] as const) {
    it(`skips a line scan for a business that is ${label}, and no engine is asked`, async () => {
      const { b, payload } = await setup(over);
      const out = await handlerFor("scan")!(payload, job("scan", payload));
      expect(out).toEqual({ skipped: reason });
      expect(await calls(b.id)).toBe(0);
      expect((await db.listEvents(b.id, 20)).some((e) => e.type === "job.skipped")).toBe(true);
    });
  }
  it("skips a discontinued line (monthly) but allows its recheck; a market no longer in the version; another business's line", async () => {
    const { b, l, payload } = await setup();
    await db.setProductLineStatus({ businessId: b.id, productLineId: l.id, status: "discontinued", maxActive: 10 });
    expect(await paidOnlyBlock("scan", payload)).toBe("line_discontinued");
    // a recheck of a finding of the discontinued line
    const run = await db.createScanRun({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done", productLineId: l.id, productLineVersion: 1, market: "NL" });
    const [f] = await db.upsertFindings([{ businessId: b.id, scanRunId: run.id, factKey: "spec", subject: "Gewicht", engine: "chatgpt", wrongValue: "1", correctValue: "2", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: null }]);
    const fix = await db.insertFix({ findingId: f!.id, action: "none", target: "none" });
    expect(await paidOnlyBlock("recheck", { fixId: fix.id })).toBeNull();
    // the owner drops BE from the line: a BE job is refused
    const l2 = await line(b.id, "Beta");
    await db.saveProductLine({ businessId: b.id, productLineId: l2.id, data: data("Beta", { markets: ["NL"] }), maxActive: 10 });
    expect(await paidOnlyBlock("scan", { businessId: b.id, kind: "monthly", productLineId: l2.id, market: "BE" })).toBe("line_not_a_market");
    // a payload naming another business's line
    const other = await business();
    const lo = await line(other.id, "Eigen van een ander");
    expect(await paidOnlyBlock("scan", { businessId: b.id, kind: "monthly", productLineId: lo.id, market: "NL" })).toBe("line_other_business");
    expect(await paidOnlyBlock("scan", { businessId: b.id, kind: "monthly", productLineId: "00000000-0000-0000-0000-000000000000", market: "NL" })).toBe("line_no_line");
    expect(await paidOnlyBlock("scan", { businessId: b.id, kind: "monthly", productLineId: l.id })).toBe("line_needs_line_and_market");
  });
  it("a recheck of a line finding for a business that stopped paying is skipped", async () => {
    const { b, l } = await setup();
    const run = await db.createScanRun({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done", productLineId: l.id, productLineVersion: 1, market: "NL" });
    const [f] = await db.upsertFindings([{ businessId: b.id, scanRunId: run.id, factKey: "spec", subject: "Gewicht", engine: "chatgpt", wrongValue: "1", correctValue: "2", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: null }]);
    const fix = await db.insertFix({ findingId: f!.id, action: "none", target: "none" });
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, plan: "setup" });
    expect(await paidOnlyBlock("recheck", { fixId: fix.id })).toBe("line_no_monthly_plan");
  });
});

describe("the report waits for the month's line runs (ADR-0010, S-26)", () => {
  const FIXED = new Date("2026-11-15T12:00:00Z");
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED);
  });
  async function withLines() {
    const b = await business();
    const l = await line(b.id, "Alfa", { markets: ["NL", "BE"] });
    const lines = [{ productLineId: l.id, market: "NL" }, { productLineId: l.id, market: "BE" }];
    const run = (market: string, status: "done" | "running" | "failed") => db.createScanRun({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status, productLineId: l.id, productLineVersion: 1, market });
    return { b, l, lines, run };
  }
  const reports = () => [...db.jobs.values()].filter((j) => j.kind === "report");

  it("waits while a line run is missing or running, at most 8 times, then sends", async () => {
    const { b, lines, run } = await withLines();
    await run("NL", "done");
    // BE is missing: wait
    const first = await report({ businessId: b.id, lines }, job("report", {}));
    expect(first).toMatchObject({ waiting: true, waited: 1, missing: 1 });
    expect(reports()).toHaveLength(1);
    expect((reports()[0]!.payload as { waited: number }).waited).toBe(1);
    expect(new Date(reports()[0]!.runAt).getTime() - FIXED.getTime()).toBe(LINE_REPORT_WAIT_MINUTES * 60_000);
    expect(db.events.find((e) => e.type === "report.waiting")!.payload).toEqual({ waited: 1, missing: 1 });
    // running is not done either
    await run("BE", "running");
    expect(await report({ businessId: b.id, lines, waited: 7 }, job("report", {}))).toMatchObject({ waiting: true, waited: 8 });
    // the 9th time it sends what exists
    const sent = await report({ businessId: b.id, lines, waited: LINE_REPORT_MAX_WAITS }, job("report", {}));
    expect(sent).not.toHaveProperty("waiting");
    expect(reports()).toHaveLength(2);
  });

  it("sends at once when every line run is done or failed", async () => {
    const { b, lines, run } = await withLines();
    await run("NL", "done");
    await run("BE", "failed");
    const out = await report({ businessId: b.id, lines }, job("report", {}));
    expect(out).not.toHaveProperty("waiting");
    expect(reports()).toHaveLength(0);
  });

  it("a business without lines is not delayed; a bad 'waited' counts from 0 and is bounded; a run of another month does not count", async () => {
    const { b, lines, l } = await withLines();
    expect(await report({ businessId: b.id }, job("report", {}))).not.toHaveProperty("waiting");
    expect(await report({ businessId: b.id, lines, waited: -100 }, job("report", {}))).toMatchObject({ waiting: true, waited: 1 });
    expect(await report({ businessId: b.id, lines, waited: 999 }, job("report", {}))).not.toHaveProperty("waiting");
    const old = await db.createScanRun({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done", productLineId: l.id, productLineVersion: 1, market: "NL" });
    await db.updateScanRun(old.id, { startedAt: "2026-10-20T10:00:00.000Z" });
    expect(await report({ businessId: b.id, lines: [lines[0]!] }, job("report", {}))).toMatchObject({ waiting: true });
    // a payload cannot widen the list to a line the business no longer may have
    const bogus = [{ productLineId: "00000000-0000-0000-0000-000000000000", market: "NL" }];
    expect(await report({ businessId: b.id, lines: bogus }, job("report", {}))).not.toHaveProperty("waiting");
  });
});

describe("the daily ceiling counts line runs in flight (S-24)", () => {
  it("four running line runs at cost 0 fill a ceiling of three estimates: the fifth job is deferred", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-07T10:00:00Z"));
    process.env.VIDALO_DAILY_AI_CAP_CENTS = "750";
    const b = await business();
    const l = await line(b.id, "Alfa", { markets: ["NL", "BE"] });
    const l2 = await line(b.id, "Beta", { markets: ["NL", "BE"] });
    for (const x of [l, l2]) for (const market of ["NL", "BE"]) await db.createScanRun({ businessId: b.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "running", productLineId: x.id, productLineVersion: 1, market });
    const payload = { businessId: b.id, kind: "monthly", productLineId: l.id, market: "NL" };
    expect(await db.paidScanCentsSince(new Date("2026-11-07T00:00:00Z"))).toBe(1000);
    const at = await spendBlock("scan", payload, new Date("2026-11-07T10:00:00Z"));
    expect(at).not.toBeNull();
    // the deferred job keeps its line and market
    const moved = [...db.jobs.values()].find((j) => j.kind === "scan")!;
    expect(moved.payload).toMatchObject({ productLineId: l.id, market: "NL", deferredOnce: true });
    // the same job again after it was moved once runs
    expect(await spendBlock("scan", { ...payload, deferredOnce: true }, new Date("2026-11-07T10:00:00Z"))).toBeNull();
  });
});
