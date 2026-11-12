import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { withMockDb, createDb, type Db } from "../src/db";

/**
 * Feature 002, lane A: the account tables and methods (migrations 0018, 0019). Every case runs
 * on MemDb and, when TEST_DATABASE_URL carries supabase/migrations (pnpm verify:pg), on PgDb.
 * Every case has a control that must stay untouched.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "auth_session, auth_throttle, question_use, google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";

let pg: Db | undefined;
let raw: ReturnType<typeof postgres> | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      raw ??= postgres(PG_URL, { max: 1, onnotice: () => {} });
      await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
      pg ??= createDb(PG_URL);
      return pg;
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
  await raw?.end();
});

const MIN = 60_000;

describe.each(backends)("%s: sign-ins (0018)", (_n, makeDb) => {
  let db: Db;
  const user = randomUUID();
  const other = randomUUID();
  beforeEach(async () => {
    db = await makeDb();
  });

  it("records once per session id; a second record never reopens or moves it", async () => {
    const sid = randomUUID();
    const t0 = new Date("2026-11-01T10:00:00.000Z");
    await db.recordSignIn({ sessionId: sid, userId: user, browser: "safari", os: "ios", at: t0 });
    await db.recordSignIn({ sessionId: sid, userId: user, browser: "chrome", os: "macos", at: new Date(t0.getTime() + 5 * MIN) });
    let rows = await db.listSignIns(user, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: sid, browser: "safari", os: "ios", signedInAt: t0.toISOString(), endedAt: null });
    expect(await db.endSignIns(user, "signed_out", { sessionId: sid })).toBe(1);
    await db.recordSignIn({ sessionId: sid, userId: user, browser: "safari", os: "ios", at: new Date() });
    rows = await db.listSignIns(user, 10);
    expect(rows[0]!.endedReason).toBe("signed_out");
    expect(rows[0]!.signedInAt).toBe(t0.toISOString());
    // Control: a new id is open.
    const fresh = randomUUID();
    await db.recordSignIn({ sessionId: fresh, userId: user, browser: "chrome", os: "macos", at: new Date() });
    expect((await db.getSignIn(fresh))!.endedAt).toBeNull();
  });

  it("ending one session leaves the other open; ending all ends all; another user is untouched", async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const now = new Date();
    await db.recordSignIn({ sessionId: a, userId: user, browser: "chrome", os: "macos", at: now });
    await db.recordSignIn({ sessionId: b, userId: user, browser: "firefox", os: "windows", at: now });
    await db.recordSignIn({ sessionId: c, userId: other, browser: "edge", os: "windows", at: now });
    expect(await db.endSignIns(user, "signed_out", { sessionId: a })).toBe(1);
    expect((await db.getSignIn(a))!.endedReason).toBe("signed_out");
    expect((await db.getSignIn(b))!.endedAt).toBeNull();
    expect(await db.endSignIns(user, "signed_out_everywhere")).toBe(1);
    expect((await db.getSignIn(b))!.endedReason).toBe("signed_out_everywhere");
    expect((await db.getSignIn(a))!.endedReason).toBe("signed_out");
    expect((await db.getSignIn(c))!.endedAt).toBeNull();
  });

  it("lists newest first, at most the limit; keeps the 10 newest ended rows and every open one", async () => {
    const base = Date.parse("2026-10-01T08:00:00.000Z");
    const ids: string[] = [];
    for (let i = 0; i < 13; i++) {
      const id = randomUUID();
      ids.push(id);
      await db.recordSignIn({ sessionId: id, userId: user, browser: "chrome", os: "macos", at: new Date(base + i * 60 * MIN) });
      // All but the first two end: those two stay open however old they are.
      if (i >= 2) await db.endSignIns(user, "signed_out", { sessionId: id });
    }
    const control = randomUUID();
    await db.recordSignIn({ sessionId: control, userId: other, browser: "safari", os: "macos", at: new Date(base) });
    await db.endSignIns(other, "signed_out");
    // One more sign-in triggers the prune.
    await db.recordSignIn({ sessionId: randomUUID(), userId: user, browser: "chrome", os: "macos", at: new Date(base + 20 * 60 * MIN) });
    const all = await db.listSignIns(user, 50);
    expect(all.map((r) => r.signedInAt)).toEqual([...all.map((r) => r.signedInAt)].sort().reverse());
    expect(await db.getSignIn(ids[0]!)).not.toBeNull();
    expect(await db.getSignIn(ids[1]!)).not.toBeNull();
    // 14 rows, 10 newest kept + the two open old ones; ended rows beyond the 10 newest are gone.
    expect(all).toHaveLength(12);
    expect(await db.getSignIn(ids[2]!)).toBeNull();
    expect(await db.getSignIn(ids[3]!)).toBeNull();
    expect(await db.listSignIns(user, 10)).toHaveLength(10);
    expect(await db.getSignIn(control)).not.toBeNull();
  });

  it("touches only when an hour has passed, and never an ended sign-in", async () => {
    const sid = randomUUID();
    const t0 = new Date("2026-11-10T10:00:00.000Z");
    await db.recordSignIn({ sessionId: sid, userId: user, browser: "chrome", os: "macos", at: t0 });
    await db.touchSignIn(sid, new Date(t0.getTime() + 30 * MIN));
    expect((await db.getSignIn(sid))!.lastSeenAt).toBe(t0.toISOString());
    const later = new Date(t0.getTime() + 61 * MIN);
    await db.touchSignIn(sid, later);
    expect((await db.getSignIn(sid))!.lastSeenAt).toBe(later.toISOString());
    expect((await db.getSignIn(sid))!.signedInAt).toBe(t0.toISOString());
    await db.endSignIns(user, "idle", { sessionId: sid });
    await db.touchSignIn(sid, new Date(t0.getTime() + 300 * MIN));
    expect((await db.getSignIn(sid))!.lastSeenAt).toBe(later.toISOString());
  });

  it("deleteSignIns removes one user's rows only", async () => {
    const [a, c] = [randomUUID(), randomUUID()];
    await db.recordSignIn({ sessionId: a, userId: user, browser: "chrome", os: "macos", at: new Date() });
    await db.recordSignIn({ sessionId: c, userId: other, browser: "chrome", os: "macos", at: new Date() });
    await db.deleteSignIns(user);
    expect(await db.listSignIns(user, 10)).toHaveLength(0);
    expect(await db.getSignIn(c)).not.toBeNull();
  });

  it("an unknown or malformed id is simply not found", async () => {
    expect(await db.getSignIn(randomUUID())).toBeNull();
    expect(await db.getSignIn("not-a-uuid")).toBeNull();
    expect(await db.endSignIns(user, "signed_out", { sessionId: "x'; drop table auth_session;--" })).toBe(0);
  });
});

describe.each(backends)("%s: sign-in link limit (0018)", (_n, makeDb) => {
  let db: Db;
  beforeEach(async () => {
    db = await makeDb();
  });
  const hour = () => new Date(Date.now() - 3_600_000);

  it("counts per key, this request included; another key is its own count", async () => {
    const [addr, ip, other] = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
    let counts: number[] = [];
    for (let i = 0; i < 6; i++) counts = await db.throttleAuth([addr, ip], hour());
    expect(counts).toEqual([6, 6]);
    expect(await db.throttleAuth([other, ip], hour())).toEqual([1, 7]);
  });

  it("after the window the address is under again (fake clock: the window starts 61 minutes later)", async () => {
    const addr = "d".repeat(64);
    for (let i = 0; i < 6; i++) await db.throttleAuth([addr], hour());
    const later = new Date(Date.now() + 61 * 60_000 - 3_600_000);
    expect(await db.throttleAuth([addr], later)).toEqual([1]);
  });

  it("prunes only rows older than the cut-off", async () => {
    const addr = "e".repeat(64);
    await db.throttleAuth([addr], hour());
    expect(await db.pruneAuthThrottle(new Date(Date.now() - 24 * 3_600_000))).toBe(0);
    expect(await db.pruneAuthThrottle(new Date(Date.now() + 1000))).toBeGreaterThanOrEqual(1);
    expect(await db.throttleAuth([addr], hour())).toEqual([1]);
  });
});

describe.each(backends)("%s: deletion and retention (0019)", (_n, makeDb) => {
  let db: Db;
  beforeEach(async () => {
    db = await makeDb();
  });
  const DAY = 86_400_000;
  const days = (n: number) => new Date(Date.now() + n * DAY);
  const biz = (name: string, over: Record<string, unknown> = {}) => db.upsertBusiness({ name: `${name} ${randomUUID().slice(0, 6)}`, place: "Haarlem", ...over });

  it("no_subscription refuses a running Monthly and deletes a Scan owner; the control survives", async () => {
    const monthly = await biz("Monthly", { plan: "monitor", status: "active" });
    const scan = await biz("Scan", { plan: "setup", status: "trial" });
    const control = await biz("Control", { plan: "setup", status: "trial" });
    await db.enqueueJob("publish", { businessId: scan.id });
    await db.enqueueJob("publish", { businessId: control.id });
    expect(await db.purgeBusiness(monthly.id, "no_subscription", new Date())).toBe(false);
    expect(await db.getBusiness(monthly.id)).not.toBeNull();
    expect(await db.purgeBusiness(scan.id, "no_subscription", new Date())).toBe(true);
    expect(await db.getBusiness(scan.id)).toBeNull();
    expect(await db.purgeBusiness(scan.id, "no_subscription", new Date())).toBe(false);
    expect(await db.getBusiness(control.id)).not.toBeNull();
    // Unrun jobs of the purged business are gone, the control's stay.
    const claimed: string[] = [];
    for (let j = await db.claimJob(["publish"]); j; j = await db.claimJob(["publish"])) claimed.push(String(j.payload.businessId));
    expect(claimed).toEqual([control.id]);
  });

  it("churn sets churnedAt and a date 120 days on; due refuses before it, deletes after, once", async () => {
    const b = await biz("Churn", { plan: "monitor", status: "active" });
    const control = await biz("Active control", { plan: "monitor", status: "active" });
    const churned = await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, status: "churned" });
    expect(churned.churnedAt).not.toBeNull();
    expect(churned.deleteReason).toBe("retention");
    expect(Math.abs(Date.parse(churned.deleteAt!) - (Date.parse(churned.churnedAt!) + 120 * DAY))).toBeLessThan(5000);
    expect(await db.purgeBusiness(b.id, "due", days(119))).toBe(false);
    expect((await db.listDueDeletions(days(119), 50)).map((x) => x.id)).not.toContain(b.id);
    // A retention row is due only 14 days after its reminder (V-COMP-05), and never in the dry run (V-COMP-03).
    expect((await db.listDueDeletions(days(121), 50)).map((x) => x.id)).not.toContain(b.id);
    expect(await db.claimDeletionReminder(b.id, days(106))).toBe(true);
    expect((await db.listDueDeletions(days(119.5), 50)).map((x) => x.id)).not.toContain(b.id);
    expect((await db.listDueDeletions(days(121), 50)).map((x) => x.id)).toContain(b.id);
    expect((await db.listDueDeletions(days(121), 50, { retention: false })).map((x) => x.id)).not.toContain(b.id);
    // An owner's own date comes first, also in the dry run.
    const o = await biz("Owner first", { plan: "monitor", status: "active", cancelAt: days(5).toISOString() });
    await db.setDeletion(o.id, { at: days(5).toISOString(), reason: "owner" });
    await db.upsertBusiness({ id: o.id, slug: o.slug, name: o.name, place: o.place, status: "churned" });
    expect((await db.listDueDeletions(days(121), 50))[0]!.id).toBe(o.id);
    expect((await db.listDueDeletions(days(121), 50, { retention: false })).map((x) => x.id)).toEqual([o.id]);
    expect(await db.purgeBusiness(control.id, "due", days(121))).toBe(false);
    expect(await db.purgeBusiness(b.id, "due", days(121))).toBe(true);
    expect(await db.purgeBusiness(b.id, "due", days(121))).toBe(false);
    expect(await db.getBusiness(control.id)).not.toBeNull();
  });

  it("an owner's earlier date stays at churn; calling it off after churn falls back to churn + 120 days", async () => {
    const b = await biz("Owner date", { plan: "monitor", status: "active" });
    const end = days(20).toISOString();
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, cancelAt: end });
    expect((await db.setDeletion(b.id, { at: end, reason: "owner" })).deleteReason).toBe("owner");
    const churned = await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, status: "churned" });
    expect(churned.deleteAt).toBe(end);
    expect(churned.deleteReason).toBe("owner");
    const off = await db.setDeletion(b.id, null);
    expect(off.deleteReason).toBe("retention");
    expect(Math.abs(Date.parse(off.deleteAt!) - (Date.parse(off.churnedAt!) + 120 * DAY))).toBeLessThan(5000);
  });

  it("undoing the cancel calls the deletion off; a date on a paying business without a cancel is refused", async () => {
    const b = await biz("Undo", { plan: "monitor", status: "active" });
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, cancelAt: days(10).toISOString() });
    await db.setDeletion(b.id, { at: days(10).toISOString(), reason: "owner" });
    const undone = await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, cancelAt: null });
    expect(undone.deleteAt).toBeNull();
    expect(undone.deleteReason).toBeNull();
    await expect(db.setDeletion(b.id, { at: days(10).toISOString(), reason: "owner" })).rejects.toThrow(/business_delete_only_when_ending/);
  });

  it("reminders: only retention dates within 14 days, claimed once; overdue counted", async () => {
    const r = await biz("Retention", { plan: "monitor", status: "active" });
    await db.upsertBusiness({ id: r.id, slug: r.slug, name: r.name, place: r.place, status: "churned" });
    const owner = await biz("Owner", { plan: "monitor", status: "active" });
    await db.upsertBusiness({ id: owner.id, slug: owner.slug, name: owner.name, place: owner.place, cancelAt: days(5).toISOString() });
    await db.setDeletion(owner.id, { at: days(5).toISOString(), reason: "owner" });
    expect((await db.listDeletionReminders(days(100), 50)).map((x) => x.id)).not.toContain(r.id);
    const due = (await db.listDeletionReminders(days(107), 50)).map((x) => x.id);
    expect(due).toContain(r.id);
    expect(due).not.toContain(owner.id);
    expect(await db.claimDeletionReminder(r.id)).toBe(true);
    expect(await db.claimDeletionReminder(r.id)).toBe(false);
    expect((await db.listDeletionReminders(days(107), 50)).map((x) => x.id)).not.toContain(r.id);
    expect(await db.countOverdueDeletions(days(122))).toBeGreaterThanOrEqual(1);
    expect(await db.countOverdueDeletions(new Date())).toBe(0);
  });

  it("Scan retention: a sign-in moves last activity; a later date re-arms the reminder; a Monthly is untouched", async () => {
    const owner = randomUUID();
    const scan = await biz("Scan R", { plan: "setup", status: "trial", ownerUserId: owner });
    const monthly = await biz("Monthly R", { plan: "monitor", status: "trial" });
    expect((await db.getBusiness(scan.id))!.lastActiveAt).not.toBeNull();
    await db.recordSignIn({ sessionId: randomUUID(), userId: owner, browser: "chrome", os: "macos", at: new Date("2027-07-01T10:00:00.000Z") });
    expect((await db.getBusiness(scan.id))!.lastActiveAt).toBe("2027-07-01T10:00:00.000Z");
    await db.setScanRetention(scan.id, "2028-11-01T00:00:00.000Z");
    await db.claimDeletionReminder(scan.id);
    await db.setScanRetention(scan.id, "2029-07-01T10:00:00.000Z");
    const later = (await db.getBusiness(scan.id))!;
    expect(later.deleteReason).toBe("retention");
    expect(later.deletionRemindedAt).toBeNull();
    await db.setScanRetention(monthly.id, "2028-11-01T00:00:00.000Z");
    expect((await db.getBusiness(monthly.id))!.deleteAt).toBeNull();
    expect((await db.listScanRetention(500)).map((x) => x.id)).toContain(scan.id);
    expect((await db.listScanRetention(500)).map((x) => x.id)).not.toContain(monthly.id);
  });
});
