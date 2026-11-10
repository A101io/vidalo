import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "@vidalo/core/db";
import { setDb } from "@vidalo/core/shared";
import { handlerFor } from "../src/jobs/index";
import { paidOnlyBlock } from "../src/jobs/paid";
import type { Job } from "@vidalo/core/db";

// A business nobody has paid for must never get anything published or sent in
// its name, whoever claimed it. Status alone decides.
describe("paid-only jobs", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
  });

  const job = (kind: string, payload: Record<string, unknown>) => ({ id: 1, kind, payload }) as unknown as Job;

  async function business(status: "scanned" | "trial" | "active" | "paused" | "churned", verified = true) {
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status, ownerVerifiedAt: verified ? new Date().toISOString() : null });
    const run = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1 });
    const [finding] = await db.upsertFindings([{ businessId: b.id, scanRunId: run.id, factKey: "phone", subject: null, engine: "chatgpt", wrongValue: "1", correctValue: "2", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: null }]);
    const fix = await db.insertFix({ findingId: finding!.id, action: "republish", target: "facts_page" });
    return { b, run, fix };
  }

  it("fails closed when the business cannot be found", async () => {
    expect(await handlerFor("publish")!({ businessId: "nope" }, job("publish", { businessId: "nope" }))).toEqual({ skipped: "no_business" });
  });

  for (const status of ["scanned", "paused", "churned"] as const) {
    it(`skips publish, sync, setup, fixes and recheck for a ${status} business`, async () => {
      const { b, run, fix } = await business(status);
      const cases: [string, Record<string, unknown>][] = [
        ["publish", { businessId: b.id }],
        ["sync", { businessId: b.id }],
        ["setup", { businessId: b.id }],
        ["fixes", { scanRunId: run.id }],
        ["recheck", { fixId: fix.id }],
      ];
      for (const [kind, payload] of cases) {
        const out = await handlerFor(kind)!(payload, job(kind, payload));
        expect(out, kind).toEqual({ skipped: `not_paying:${status}` });
      }
      const skipped = (await db.listEvents(b.id, 50)).filter((e) => e.type === "job.skipped");
      expect(skipped).toHaveLength(cases.length);
    });
  }

  it("skips them for a paying business whose owner has not proven ownership", async () => {
    const { b } = await business("active", false);
    expect(await handlerFor("publish")!({ businessId: b.id }, job("publish", { businessId: b.id }))).toEqual({ skipped: "owner_not_verified" });
    expect(await handlerFor("setup")!({ businessId: b.id }, job("setup", { businessId: b.id }))).toEqual({ skipped: "owner_not_verified" });
  });

  it("runs them for a paying business with a verified owner", async () => {
    const { b } = await business("trial");
    // Past the guard, the real publish step runs and wants facts this fixture never gave it.
    await expect(handlerFor("publish")!({ businessId: b.id }, job("publish", { businessId: b.id }))).rejects.toThrow(/has no facts yet/);
  });
});

describe("Controleer nu (on-demand scan)", () => {
  it("is skipped unless the business pays for the monthly plan; a free or monthly scan is not touched", async () => {
    const db = new MemDb();
    setDb(db);
    const verified = new Date().toISOString();
    const scanOnly = await db.upsertBusiness({ name: "Eenmalig", place: "Haarlem", status: "trial", plan: "setup", ownerVerifiedAt: verified });
    const unpaid = await db.upsertBusiness({ name: "Niet betaald", place: "Haarlem", status: "scanned", plan: "none", ownerVerifiedAt: verified });
    const monthly = await db.upsertBusiness({ name: "Maandelijks", place: "Haarlem", status: "active", plan: "monitor", ownerVerifiedAt: verified });
    expect(await paidOnlyBlock("scan", { businessId: scanOnly.id, kind: "ondemand" })).toBe("ondemand_not_monthly");
    expect(await paidOnlyBlock("scan", { businessId: unpaid.id, kind: "ondemand" })).toBe("not_paying:scanned");
    // Control: the monthly customer may, and other scan kinds never pass this guard.
    expect(await paidOnlyBlock("scan", { businessId: monthly.id, kind: "ondemand" })).toBeNull();
    expect(await paidOnlyBlock("scan", { businessId: unpaid.id, kind: "free" })).toBeNull();
  });

  it("runs one on-demand scan per 7 days, counted from the scans that ran (a double click queues two jobs)", async () => {
    const db = new MemDb();
    setDb(db);
    const b = await db.upsertBusiness({ name: "Maandelijks", place: "Haarlem", status: "active", plan: "monitor", ownerVerifiedAt: new Date().toISOString() });
    expect(await paidOnlyBlock("scan", { businessId: b.id, kind: "ondemand" })).toBeNull();
    await db.createScanRun({ businessId: b.id, kind: "ondemand", engines: ["chatgpt"], samplesPerPrompt: 1, status: "running" });
    expect(await paidOnlyBlock("scan", { businessId: b.id, kind: "ondemand" })).toBe("ondemand_too_soon");
    // Control: rechecks and monthly scans are not on-demand checks and do not count.
    const other = await db.upsertBusiness({ name: "Ander", place: "Haarlem", status: "active", plan: "monitor", ownerVerifiedAt: new Date().toISOString() });
    await db.createScanRun({ businessId: other.id, kind: "recheck", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done" });
    await db.createScanRun({ businessId: other.id, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done" });
    expect(await paidOnlyBlock("scan", { businessId: other.id, kind: "ondemand" })).toBeNull();
  });
});

describe("an owner's pause", () => {
  it("skips paid jobs until the pause ends, then lets them run", async () => {
    const db = new MemDb();
    setDb(db);
    const until = new Date(Date.now() + 86_400_000).toISOString();
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status: "active", plan: "monitor", ownerVerifiedAt: new Date().toISOString(), pauseUntil: until });
    const job = { id: 1, kind: "sync", payload: { businessId: b.id } } as unknown as Job;
    expect(await handlerFor("sync")!({ businessId: b.id }, job)).toEqual({ skipped: "paused_by_owner" });
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, pauseUntil: new Date(Date.now() - 1000).toISOString() });
    expect(await paidOnlyBlock("sync", { businessId: b.id })).toBeNull();
  });
});
