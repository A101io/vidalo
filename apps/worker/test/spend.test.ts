import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "@vidalo/core/db";
import { setDb } from "@vidalo/core/shared";
import { spendBlock, spreadOverNextDay } from "../src/jobs/spend";
import { handlerFor } from "../src/jobs/index";
import type { Job } from "@vidalo/core/db";

// Review R-11: paid scans and rechecks stop for the day above the ceiling and
// move to the next day; free checks have their own cap and are not counted.
// Review CMP-05 / SEC-05: the baseline and the monthly check wait one day at
// most; moved jobs are spread over the next day.
describe("daily ceiling on paid AI spend", () => {
  let db: MemDb;
  const NOW = new Date("2026-11-06T15:00:00Z");
  const NEXT_DAY = (iso: string | null) => iso !== null && iso >= "2026-11-07T00:00:00.000Z" && iso < "2026-11-08T00:00:00.000Z";
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    process.env.VIDALO_DAILY_AI_CAP_CENTS = "1000";
  });
  afterEach(() => {
    delete process.env.VIDALO_DAILY_AI_CAP_CENTS;
  });

  async function spent(kind: "free" | "monthly", cents: number) {
    const b = await db.upsertBusiness({ name: `B ${Math.random()}`, place: "Haarlem" });
    const run = await db.createScanRun({ businessId: b.id, kind, engines: ["chatgpt"], samplesPerPrompt: 1, status: "done" });
    await db.updateScanRun(run.id, { costCents: cents });
    return b;
  }

  it("lets jobs run under the ceiling, and never counts free checks", async () => {
    const b = await spent("monthly", 999);
    await spent("free", 5000);
    expect(await spendBlock("scan", { businessId: b.id, kind: "ondemand" }, NOW)).toBeNull();
  });

  it("moves a paid scan and a recheck into the next day once the ceiling is reached; a free check still runs", async () => {
    const b = await spent("monthly", 1000);
    expect(NEXT_DAY(await spendBlock("scan", { businessId: b.id, kind: "monthly" }, NOW))).toBe(true);
    expect(NEXT_DAY(await spendBlock("recheck", { fixId: "f1", findingId: "x" }, NOW))).toBe(true);
    expect(await spendBlock("scan", { businessId: b.id, kind: "free" }, NOW)).toBeNull();
    const queued = [...db.jobs.values()].map((j) => [j.kind, String(j.runAt).slice(0, 10)]);
    // Only the scan is queued again; a recheck returns through the cron (enqueueDueRechecks).
    expect(queued).toEqual([["scan", "2026-11-07"]]);
    expect((await db.listEvents(b.id)).some((e) => e.type === "job.deferred")).toBe(true);
  });

  it("defers a baseline or monthly check once, then runs it above the ceiling", async () => {
    const b = await spent("monthly", 5000);
    for (const kind of ["baseline", "monthly"]) {
      expect(await spendBlock("scan", { businessId: b.id, kind }, NOW)).not.toBeNull();
      const again = [...db.jobs.values()].find((j) => j.payload.kind === kind)!;
      expect(again.payload.deferredOnce).toBe(true);
      expect(await spendBlock("scan", again.payload, NOW)).toBeNull();
    }
  });

  it("keeps on-demand checks and rechecks capped, however often they were moved", async () => {
    const b = await spent("monthly", 5000);
    expect(await spendBlock("scan", { businessId: b.id, kind: "ondemand", deferredOnce: true }, NOW)).not.toBeNull();
    expect(await spendBlock("recheck", { fixId: "f1", findingId: "x", deferredOnce: true }, NOW)).not.toBeNull();
    const ondemand = [...db.jobs.values()].find((j) => j.payload.kind === "ondemand")!;
    expect(ondemand.payload.deferredOnce).toBe(true);
  });

  it("spreads moved jobs over the next day instead of midnight", () => {
    const today = new Date("2026-11-06T00:00:00Z");
    const times = Array.from({ length: 50 }, (_, i) => spreadOverNextDay(today, `b${i}monthly`).toISOString());
    for (const t of times) expect(NEXT_DAY(t)).toBe(true);
    expect(new Set(times.map((t) => t.slice(11, 13))).size).toBeGreaterThan(10);
    expect(spreadOverNextDay(today, "same")).toEqual(spreadOverNextDay(today, "same"));
  });

  it("is checked by the worker before a paid scan runs", async () => {
    await spent("monthly", 5000);
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status: "active", plan: "monitor", ownerVerifiedAt: new Date().toISOString() });
    const payload = { businessId: b.id, kind: "ondemand" };
    const res = await handlerFor("scan")!(payload, { id: 1, kind: "scan", payload } as unknown as Job);
    expect(res).toMatchObject({ skipped: "daily_ai_cap" });
    expect((await db.listScanRuns(b.id, 10)).length).toBe(0);
  });
});
