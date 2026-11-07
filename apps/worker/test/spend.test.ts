import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "@vidalo/core/db";
import { setDb } from "@vidalo/core/shared";
import { spendBlock } from "../src/jobs/spend";

// Review R-11: paid scans and rechecks stop for the day above the ceiling and
// move to the next day; free checks have their own cap and are not counted.
describe("daily ceiling on paid AI spend", () => {
  let db: MemDb;
  const NOW = new Date("2026-11-06T15:00:00Z");
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

  it("moves a paid scan and a recheck to the next day once the ceiling is reached; a free check still runs", async () => {
    const b = await spent("monthly", 1000);
    expect(await spendBlock("scan", { businessId: b.id, kind: "monthly" }, NOW)).toBe("2026-11-07T00:00:00.000Z");
    expect(await spendBlock("recheck", { fixId: "f1", findingId: "x" }, NOW)).toBe("2026-11-07T00:00:00.000Z");
    expect(await spendBlock("scan", { businessId: b.id, kind: "free" }, NOW)).toBeNull();
    const queued = [...db.jobs.values()].map((j) => [j.kind, String(j.runAt).slice(0, 10)]);
    // Only the scan is queued again; a recheck returns through the cron (enqueueDueRechecks).
    expect(queued).toEqual([["scan", "2026-11-07"]]);
    expect((await db.listEvents(b.id)).some((e) => e.type === "job.deferred")).toBe(true);
  });
});
