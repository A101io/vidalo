import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "@vidalo/core/db";
import { setDb } from "@vidalo/core/shared";
import { amsterdamParts, amsterdamToUtc, enqueueIndexChecks, enqueueSiteChecks, monthlySlot, ownerSubscriptionChanges } from "../src/cron";

describe("cron time helpers", () => {
  it("converts Amsterdam wall-clock to UTC across DST", () => {
    // CEST (UTC+2) in July, CET (UTC+1) in January
    expect(amsterdamToUtc(2026, 7, 15, 2, 0).toISOString()).toBe("2026-07-15T00:00:00.000Z");
    expect(amsterdamToUtc(2026, 1, 15, 2, 0).toISOString()).toBe("2026-01-15T01:00:00.000Z");
    expect(amsterdamParts(new Date("2026-07-15T00:30:00Z"))).toMatchObject({ y: 2026, m: 7, d: 15, hh: 2, mm: 30 });
  });

  it("spreads monthly scans over 02:00–06:00 local, deterministic per business", () => {
    const now = new Date("2026-10-07T00:00:00Z"); // 02:00 CEST
    const a = monthlySlot({ id: "11111111-aaaa" }, now);
    const b = monthlySlot({ id: "22222222-bbbb" }, now);
    for (const slot of [a, b]) {
      const p = amsterdamParts(slot);
      expect(p.hh).toBeGreaterThanOrEqual(2);
      expect(p.hh).toBeLessThan(6);
      expect(p.d).toBe(7);
    }
    expect(monthlySlot({ id: "11111111-aaaa" }, now).getTime()).toBe(a.getTime());
    // when the window has passed the slot is "now"
    const late = new Date("2026-10-07T12:00:00Z");
    expect(monthlySlot({ id: "11111111-aaaa" }, late).getTime()).toBe(late.getTime());
  });
});

describe("own-website and Google index checks", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
  });

  const jobs = (kind: string) => [...db.jobs.values()].filter((j) => j.kind === kind);

  let seq = 0;
  async function business(opts: { status?: "active" | "scanned"; verified?: boolean; hostVerified?: boolean } = {}) {
    return db.upsertBusiness({
      name: `Bakkerij ${++seq}`,
      place: "Haarlem",
      status: opts.status ?? "active",
      ownerVerifiedAt: opts.verified === false ? null : "2026-10-01T00:00:00.000Z",
      factsHost: "feiten.bakkerijdevries.nl",
      factsHostVerifiedAt: opts.hostVerified === false ? null : "2026-10-01T00:00:00.000Z",
    });
  }

  it("checks the own website of paying, verified owners every 30 days", async () => {
    await business();
    await business({ status: "scanned" });
    await business({ verified: false });
    const now = new Date("2026-10-15T08:00:00Z");
    expect(await enqueueSiteChecks(now)).toBe(1);
    expect(await enqueueSiteChecks(new Date("2026-11-10T08:00:00Z"))).toBe(0);
    expect(jobs("sitecheck")).toHaveLength(1);
  });

  it("checks Google daily until the facts page is indexed, then weekly", async () => {
    const b = await business();
    await business({ hostVerified: false });
    const day = (d: number) => new Date(Date.UTC(2026, 9, d, 8));
    expect(await enqueueIndexChecks(day(15))).toBe(1);
    expect(await enqueueIndexChecks(day(15))).toBe(0);
    // events are stamped with the real clock; age them so "since" works on the fake dates
    for (const e of db.events) e.at = day(15).toISOString();
    expect(await enqueueIndexChecks(day(16))).toBe(1);
    for (const e of db.events) e.at = day(16).toISOString();
    await db.upsertGoogleIndex({ businessId: b.id, host: "feiten.bakkerijdevries.nl", inspection: { at: day(16).toISOString(), verdict: "PASS", coverageState: null, indexingState: null, pageFetchState: null, robotsTxtState: null, lastCrawlTime: null, googleCanonical: null } });
    expect(await enqueueIndexChecks(day(17))).toBe(0);
    expect(await enqueueIndexChecks(day(23))).toBe(1);
  });
});

describe("owner's pause and cancel", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
  });
  const until = "2026-11-25T00:00:00.000Z";
  const owner = (patch: Record<string, unknown>) => db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status: "active", plan: "monitor", ownerEmail: "eigenaar@x.nl", ...patch });

  it("reminds once a week before, then ends the pause with one mail", async () => {
    const b = await owner({ pauseUntil: until });
    expect(await ownerSubscriptionChanges(new Date("2026-11-19T00:00:00Z"))).toEqual({ reminders: 1, resumed: 0, closed: 0 });
    expect(await ownerSubscriptionChanges(new Date("2026-11-20T00:00:00Z"))).toEqual({ reminders: 0, resumed: 0, closed: 0 });
    expect(await ownerSubscriptionChanges(new Date("2026-11-25T01:00:00Z"))).toEqual({ reminders: 0, resumed: 1, closed: 0 });
    expect((await db.getBusiness(b.id))?.pauseUntil).toBeNull();
    const mails = (await db.listEvents(b.id)).filter((e) => e.type.startsWith("mail.")).map((e) => e.type).sort();
    expect(mails).toEqual(["mail.pause_ended", "mail.pause_ending"]);
    expect(await ownerSubscriptionChanges(new Date("2026-11-26T00:00:00Z"))).toEqual({ reminders: 0, resumed: 0, closed: 0 });
  });

  it("closes a cancellation Stripe never closed, two days after its end date", async () => {
    const b = await owner({ cancelAt: "2026-11-12T00:00:00.000Z" });
    expect((await ownerSubscriptionChanges(new Date("2026-11-13T00:00:00Z"))).closed).toBe(0);
    expect((await ownerSubscriptionChanges(new Date("2026-11-14T01:00:00Z"))).closed).toBe(1);
    expect((await db.getBusiness(b.id))?.status).toBe("churned");
  });
});
