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
