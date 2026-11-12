import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { MemDb, createDb, type BusinessRecord, type Db } from "../src/db";
import { deletionPlan, purgeAllowed, scanRetentionDate, SCAN_GOOGLE_DAYS, SCAN_RETENTION_MONTHS } from "../src/shared/deletion";

/** Feature 002 AC-5(b), COMP-03: when "Verwijder alles" happens. */
const base = (over: Partial<BusinessRecord>): BusinessRecord =>
  ({ id: "b", slug: "b", name: "B", place: "Haarlem", plan: "none", status: "scanned", cancelAt: null, pauseUntil: null, deleteAt: null, deleteReason: null, ...over }) as BusinessRecord;

describe("deletionPlan", () => {
  it("Julian's decisions are the constants", () => expect([SCAN_RETENTION_MONTHS, SCAN_GOOGLE_DAYS]).toEqual([24, 60]));
  it("Vidalo Scan (setup, trial) → now", () => expect(deletionPlan(base({ plan: "setup", status: "trial" }))).toEqual({ kind: "now" }));
  it("never paid (scanned) → now", () => expect(deletionPlan(base({}))).toEqual({ kind: "now" }));
  it("churned → now", () => expect(deletionPlan(base({ plan: "monitor", status: "churned" }))).toEqual({ kind: "now" }));
  it("running Monthly → at period end, needs a cancel", () => expect(deletionPlan(base({ plan: "monitor", status: "active" }))).toEqual({ kind: "at_period_end", at: null, needsCancel: true }));
  it("cancelled Monthly → at cancelAt", () => expect(deletionPlan(base({ plan: "monitor", status: "active", cancelAt: "2026-12-01T00:00:00.000Z" }))).toEqual({ kind: "at_period_end", at: "2026-12-01T00:00:00.000Z", needsCancel: false }));
  it("paused by the owner or by a failed payment → at period end", () => {
    expect(deletionPlan(base({ plan: "monitor", status: "active", pauseUntil: "2027-01-01T00:00:00.000Z" })).kind).toBe("at_period_end");
    expect(deletionPlan(base({ plan: "monitor", status: "paused" })).kind).toBe("at_period_end");
  });
  it("a Monthly in trial → at period end", () => expect(deletionPlan(base({ plan: "monitor", status: "trial" })).kind).toBe("at_period_end"));
});

describe("purgeAllowed", () => {
  const now = new Date("2026-11-11T12:00:00.000Z");
  it("no_subscription refuses every running Monthly, allows the rest", () => {
    for (const status of ["trial", "active", "paused"] as const) expect(purgeAllowed(base({ plan: "monitor", status }), "no_subscription", now)).toBe(false);
    expect(purgeAllowed(base({ plan: "setup", status: "trial" }), "no_subscription", now)).toBe(true);
    expect(purgeAllowed(base({ plan: "monitor", status: "churned" }), "no_subscription", now)).toBe(true);
  });
  it("due needs a passed date and a status that has ended (or a Scan's retention)", () => {
    expect(purgeAllowed(base({ status: "churned", deleteAt: "2026-11-12T00:00:00.000Z", deleteReason: "retention" }), "due", now)).toBe(false);
    expect(purgeAllowed(base({ status: "churned", deleteAt: "2026-11-10T00:00:00.000Z", deleteReason: "retention" }), "due", now)).toBe(true);
    expect(purgeAllowed(base({ plan: "monitor", status: "active", cancelAt: "2026-11-10T00:00:00.000Z", deleteAt: "2026-11-10T00:00:00.000Z", deleteReason: "owner" }), "due", now)).toBe(false);
    expect(purgeAllowed(base({ plan: "setup", status: "trial", deleteAt: "2026-11-10T00:00:00.000Z", deleteReason: "retention" }), "due", now)).toBe(true);
    expect(purgeAllowed(base({ plan: "monitor", status: "trial", deleteAt: "2026-11-10T00:00:00.000Z", deleteReason: "retention" }), "due", now)).toBe(false);
  });
});

describe("scanRetentionDate", () => {
  it("24 months after the last activity; null switches it off", () => {
    expect(scanRetentionDate("2026-11-11T10:00:00.000Z")).toBe("2028-11-11T10:00:00.000Z");
    expect(scanRetentionDate("2026-11-11T10:00:00.000Z", null)).toBeNull();
  });
});

/** The CHECK on Postgres: a Scan accepts a retention date, a Monthly in trial refuses one. */
const PG_URL = process.env.TEST_DATABASE_URL;
describe.skipIf(!PG_URL)("PgDb: business_delete_only_when_ending", () => {
  let pg: Db | undefined;
  let raw: ReturnType<typeof postgres> | undefined;
  afterAll(async () => {
    await pg?.close();
    await raw?.end();
  });
  it("Scan accepts a retention date; a Monthly in trial refuses one", async () => {
    pg = createDb(PG_URL!);
    raw = postgres(PG_URL!, { max: 1, onnotice: () => {} });
    const scan = await pg.upsertBusiness({ name: `Scan ${Date.now()}`, place: "Haarlem", plan: "setup", status: "trial" });
    await pg.setScanRetention(scan.id, "2028-11-11T10:00:00.000Z");
    expect((await pg.getBusiness(scan.id))!.deleteReason).toBe("retention");
    const monthly = await pg.upsertBusiness({ name: `Monthly ${Date.now()}`, place: "Haarlem", plan: "monitor", status: "trial" });
    await expect(raw`update business set delete_at = now(), delete_reason = 'retention' where id = ${monthly.id}`).rejects.toThrow(/business_delete_only_when_ending/);
  });
});

it("MemDb mirrors that CHECK", async () => {
  const db = new MemDb();
  const monthly = await db.upsertBusiness({ name: "M", place: "Haarlem", plan: "monitor", status: "active" });
  await expect(db.setDeletion(monthly.id, { at: "2026-12-01T00:00:00.000Z", reason: "owner" })).rejects.toThrow(/business_delete_only_when_ending/);
});

/** V-SEC-01: a dated Vidalo Scan that buys Vidalo Monthly loses its retention date; the webhook succeeds. */
describe.each([["MemDb", false], ["PgDb", true]] as const)("%s: Scan → Monthly through the Stripe webhook", (_n, usePg) => {
  const run = usePg && !PG_URL ? it.skip : it;
  for (const plan of ["monitor_addon", "monitor"] as const) {
    run(`a ${plan} checkout on a dated Scan is activated and the date goes`, async () => {
      const { setDb } = await import("../src/shared");
      const { handleStripeEvent } = await import("../src/billing");
      const db: Db = usePg ? createDb(PG_URL!) : new MemDb();
      setDb(db);
      try {
        const b = await db.upsertBusiness({ name: `Scan koopt ${plan} ${Date.now()}`, place: "Haarlem", plan: "setup", status: "trial", stripeCustomerId: "cus_sec01" });
        await db.setScanRetention(b.id, "2028-11-11T10:00:00.000Z");
        expect((await db.getBusiness(b.id))!.deleteReason).toBe("retention");
        const out = await handleStripeEvent({ id: `evt_sec01_${plan}_${Date.now()}`, type: "checkout.session.completed", data: { object: { id: `cs_sec01_${Date.now()}`, payment_status: "paid", customer: "cus_sec01", subscription: "sub_sec01", metadata: { businessId: b.id, plan }, customer_details: { email: "scan@example.nl" } } } });
        expect(out).toBe("activated");
        const after = (await db.getBusiness(b.id))!;
        expect(after.plan).toBe("monitor");
        expect(after.deleteAt).toBeNull();
        expect(after.deleteReason).toBeNull();
      } finally {
        setDb(null);
        if (usePg) await db.close();
      }
    });
  }
});
