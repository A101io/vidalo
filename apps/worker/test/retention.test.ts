import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MemDb, type BusinessRecord, type Job } from "@vidalo/core/db";
import { setBusinessStatus, setDb } from "@vidalo/core/shared";
import { lifecycleTransitions, retention } from "../src/cron";
import { handlerFor } from "../src/jobs/index";

/**
 * Feature 002 AC-6 (A-06): retention runs by itself. Fake clock: every step gets `now` = the start
 * plus n days. A is the subject (churned); B, C and D are controls that must never get a reminder
 * or a purge: B active with a cancel ahead, C active and paused by its owner, D active whose cancel
 * was undone. E is a Vidalo Scan business.
 */
const DAY = 86_400_000;
const T0 = Date.now();
const day = (n: number) => new Date(T0 + n * DAY);

let db: MemDb;
const saved = { purge: process.env.VIDALO_PURGE, mock: process.env.VIDALO_MOCK };

async function runJobs(kinds: string[]): Promise<Job[]> {
  const ran: Job[] = [];
  for (let j = await db.claimJob(kinds); j; j = await db.claimJob(kinds)) {
    await handlerFor(j.kind)!(j.payload, j);
    await db.completeJob(j.id);
    ran.push(j);
  }
  return ran;
}
const unrun = (kind: string) => [...db.jobs.values()].filter((j) => !j.doneAt && j.kind === kind);
const remindersFor = (id: string) => [...db.jobs.values()].filter((j) => j.kind === "email" && j.payload.template === "deletion_reminder" && j.payload.businessId === id);
const purgesFor = (id: string) => [...db.jobs.values()].filter((j) => j.kind === "purge" && j.payload.businessId === id);

async function monthly(name: string, over: Partial<BusinessRecord> = {}) {
  const b = await db.upsertBusiness({ name, place: "Haarlem", plan: "monitor", status: "active", ownerEmail: `${name.toLowerCase()}@example.nl`, ...over });
  await db.upsertChannel({ businessId: b.id, type: "gbp", name: "Google", externalId: null, url: null, meta: { refreshToken: `rt-${name}` } });
  return b;
}

beforeEach(() => {
  db = new MemDb();
  setDb(db);
  process.env.VIDALO_MOCK = "1";
  delete process.env.VIDALO_PURGE;
});
afterEach(() => {
  if (saved.purge === undefined) delete process.env.VIDALO_PURGE;
  else process.env.VIDALO_PURGE = saved.purge;
  process.env.VIDALO_MOCK = saved.mock;
});

describe("retention over 120 days", () => {
  it("churn → Google at once, free check at 90, one reminder at 106, purge job at 120 (dry run until armed); controls untouched", async () => {
    const a = await monthly("A");
    const b = await monthly("B", { cancelAt: day(200).toISOString() });
    const c = await monthly("C", { pauseUntil: day(60).toISOString() });
    const d = await monthly("D", { cancelAt: day(30).toISOString() });
    await db.upsertBusiness({ id: d.id, slug: d.slug, name: d.name, place: d.place, cancelAt: null });
    const controls = [b, c, d];

    // day 0: churn queues google_disconnect; after it runs A has no gbp channel, the controls keep theirs.
    await setBusinessStatus(a.id, "churned");
    expect(unrun("google_disconnect").map((j) => j.payload)).toEqual([{ businessId: a.id, reason: "churn" }]);
    await runJobs(["google_disconnect"]);
    expect((await db.listChannels(a.id)).some((x) => x.type === "gbp")).toBe(false);
    // From here the clock counts from A's churn moment.
    const C = Date.parse((await db.getBusiness(a.id))!.churnedAt!);
    const at = (n: number) => new Date(C + n * DAY);
    for (const x of controls) expect((await db.listChannels(x.id)).some((y) => y.type === "gbp")).toBe(true);

    // Every day: overdue stays 0, the controls never get a reminder or a purge.
    const tick = async (n: number) => {
      const out = await retention(at(n));
      expect(out.overdue, `day ${n}`).toBe(0);
      for (const x of controls) {
        expect(remindersFor(x.id), `reminder for a control on day ${n}`).toHaveLength(0);
        expect(purgesFor(x.id), `purge for a control on day ${n}`).toHaveLength(0);
      }
      return out;
    };
    for (const n of [1, 30, 60, 89]) await tick(n);

    // day 90: the existing free check.
    await lifecycleTransitions(at(90));
    expect(unrun("scan").some((j) => j.payload.businessId === a.id && j.payload.kind === "free")).toBe(true);

    // V-COMP-05: the dry run sends no reminder; the delivery-lead reads would_purge counts instead.
    expect(remindersFor(a.id)).toHaveLength(0);
    // Armed from here on: the reminder and the purge follow the published dates.
    process.env.VIDALO_PURGE = "1";
    await tick(105);
    expect(remindersFor(a.id)).toHaveLength(0);
    await tick(106);
    expect(remindersFor(a.id)).toHaveLength(1);
    await tick(107);
    expect(remindersFor(a.id)).toHaveLength(1);
    await runJobs(["email"]);
    expect(db.events.some((e) => e.type === "mail.deletion_reminder" && e.businessId === a.id)).toBe(true);

    await tick(119);
    expect(purgesFor(a.id)).toHaveLength(0);
    // Unarmed on the date: nothing queued, A stays (V-COMP-03).
    delete process.env.VIDALO_PURGE;
    expect(await tick(120)).toMatchObject({ purgeQueued: 0, dryRun: true });
    expect(purgesFor(a.id)).toHaveLength(0);
    process.env.VIDALO_PURGE = "1";
    const at120 = await tick(120);
    expect(at120).toMatchObject({ purgeQueued: 1, dryRun: false });
    await tick(120);
    expect(purgesFor(a.id)).toHaveLength(1);
    expect(purgesFor(a.id)[0]!.payload).toEqual({ businessId: a.id, guard: "due" });
    // The job's own clock is the real one, so A's date is moved into the past for it.
    db.businesses.get(a.id)!.deleteAt = new Date(Date.now() - 1000).toISOString();
    await runJobs(["purge"]);
    expect(await db.getBusiness(a.id)).toBeNull();
    for (const x of controls) expect(await db.getBusiness(x.id)).not.toBeNull();
  });

  it("an owner deletion on B's cancel date: after Stripe's subscription.deleted, purged on that date without a reminder, even with VIDALO_PURGE unset (F-010)", async () => {
    const end = day(20);
    const b = await monthly("B", { cancelAt: end.toISOString() });
    await db.setDeletion(b.id, { at: end.toISOString(), reason: "owner" });
    expect((await retention(day(10))).purgeQueued).toBe(0);
    await setBusinessStatus(b.id, "churned"); // the webhook on the end date
    expect((await db.getBusiness(b.id))!.deleteReason).toBe("owner");
    for (const n of [6, 10, 19]) await retention(day(n));
    expect(remindersFor(b.id)).toHaveLength(0);
    expect((await retention(day(20))).purgeQueued).toBe(1);
    db.businesses.get(b.id)!.deleteAt = new Date(Date.now() - 1000).toISOString();
    await runJobs(["purge"]);
    expect(await db.getBusiness(b.id)).toBeNull();
  });
});

describe("Vidalo Scan (F-012, F-015)", () => {
  it("deleted 24 months after the last activity; a sign-in at month 20 moves it and re-arms the reminder; purged on the date when armed", async () => {
    const owner = randomUUID();
    const e = await db.upsertBusiness({ name: "E", place: "Haarlem", plan: "setup", status: "trial", ownerUserId: owner, ownerEmail: "e@example.nl" });
    const start = Date.parse((await db.getBusiness(e.id))!.lastActiveAt!);
    await retention(day(1));
    const first = (await db.getBusiness(e.id))!.deleteAt!;
    process.env.VIDALO_PURGE = "1"; // reminders go only when the purge is armed (V-COMP-05)
    const expected = new Date(start);
    expected.setUTCMonth(expected.getUTCMonth() + 24);
    expect(first).toBe(expected.toISOString());
    // A reminder 14 days before the first date would go; a sign-in at month 20 moves it later and re-arms.
    await retention(new Date(Date.parse(first) - 13 * DAY));
    expect(remindersFor(e.id)).toHaveLength(1);
    const month20 = new Date(start);
    month20.setUTCMonth(month20.getUTCMonth() + 20);
    await db.recordSignIn({ sessionId: randomUUID(), userId: owner, browser: "chrome", os: "macos", at: month20 });
    await retention(month20);
    const moved = (await db.getBusiness(e.id))!;
    expect(Date.parse(moved.deleteAt!)).toBeGreaterThan(Date.parse(first));
    expect(moved.deletionRemindedAt).toBeNull();
    await retention(new Date(Date.parse(moved.deleteAt!) - 14 * DAY));
    expect(remindersFor(e.id)).toHaveLength(2);
    // On the date, armed: purged (the reminder went more than 14 days earlier on the real clock).
    expect((await retention(new Date(Date.parse(moved.deleteAt!) + 1000))).purgeQueued).toBe(1);
    db.businesses.get(e.id)!.deleteAt = new Date(Date.now() - 1000).toISOString();
    await runJobs(["purge"]);
    expect(await db.getBusiness(e.id)).toBeNull();
  });

  it("the Google token goes 60 days after the first full check when nothing is open, and stays while a fix or a held change is", async () => {
    const e = await db.upsertBusiness({ name: "E2", place: "Haarlem", plan: "setup", status: "trial", ownerEmail: "e2@example.nl" });
    const ch = await db.upsertChannel({ businessId: e.id, type: "gbp", name: "Google", externalId: null, url: null, meta: { refreshToken: "rt-e2", pendingDiff: { phone: ["1", "2"] } } });
    const run = await db.createScanRun({ businessId: e.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 1 });
    await db.updateScanRun(run.id, { status: "done", finishedAt: new Date(T0).toISOString() });
    const [f] = await db.upsertFindings([{ businessId: e.id, scanRunId: run.id, factKey: "phone", subject: null, engine: "chatgpt", wrongValue: "1", correctValue: "2", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: null }]);
    await db.updateFindingStatus(f!.id, "fixing");
    expect((await retention(day(59))).googleQueued).toBe(0);
    // Day 61: a held Business Profile change keeps it.
    expect((await retention(day(61))).googleQueued).toBe(0);
    await db.upsertChannel({ id: ch.id, businessId: e.id, type: "gbp", name: "Google", externalId: null, url: null, meta: { refreshToken: "rt-e2" } });
    // An open fix keeps it.
    expect((await retention(day(61))).googleQueued).toBe(0);
    await db.updateFindingStatus(f!.id, "resolved");
    expect((await retention(day(61))).googleQueued).toBe(1);
    expect((await retention(day(62))).googleQueued).toBe(0); // one job, not two
    await runJobs(["google_disconnect"]);
    expect((await db.listChannels(e.id)).some((x) => x.type === "gbp")).toBe(false);
    expect((await db.getBusiness(e.id))!.ownerVerifiedAt).toBeNull(); // untouched (it was never set here)
  });
});

describe("sign-in link limit", () => {
  it("pruneAuthThrottle drops rows older than 24 hours only", async () => {
    await db.throttleAuth(["a".repeat(64)], new Date(0));
    db.authThrottle.push({ keyHash: "b".repeat(64), at: new Date(Date.now() - 25 * 3_600_000).toISOString() });
    await retention(new Date());
    expect(db.authThrottle.map((r) => r.keyHash[0])).toEqual(["a"]);
  });
});

describe("log lines", () => {
  it("retention.* carry counts and business ids only, payloads only ids and a word", async () => {
    const a = await monthly("Z");
    await setBusinessStatus(a.id, "churned");
    const lines: string[] = [];
    const orig = console.log;
    console.log = (l: string) => void lines.push(String(l));
    try {
      await retention(day(121));
    } finally {
      console.log = orig;
    }
    for (const l of lines.filter((x) => x.includes('"retention.'))) expect(l).not.toMatch(/@|rt-|token/);
    for (const j of db.jobs.values()) {
      const keys = Object.keys(j.payload).sort().join(",");
      expect(["businessId,guard", "businessId,reason", "businessId,template"]).toContain(keys);
    }
  });
});

describe("V-COMP-03, V-COMP-05: the dry run never starves an owner's deletion and sends no reminder", () => {
  it("25 overdue retention rows with VIDALO_PURGE unset and one owner row: the owner row is queued and deleted, no reminder goes", async () => {
    delete process.env.VIDALO_PURGE;
    for (let i = 0; i < 25; i++) {
      const r = await monthly(`R${i}`);
      await setBusinessStatus(r.id, "churned");
    }
    const end = day(10);
    const owner = await monthly("Owner", { cancelAt: end.toISOString() });
    await db.setDeletion(owner.id, { at: end.toISOString(), reason: "owner" });
    await setBusinessStatus(owner.id, "churned");
    const out = await retention(day(200));
    expect(out.dryRun).toBe(true);
    expect(out.reminded).toBe(0);
    expect([...db.jobs.values()].filter((j) => j.kind === "email" && j.payload.template === "deletion_reminder")).toHaveLength(0);
    expect(purgesFor(owner.id)).toHaveLength(1);
    db.businesses.get(owner.id)!.deleteAt = new Date(Date.now() - 1000).toISOString();
    await runJobs(["purge"]);
    expect(await db.getBusiness(owner.id)).toBeNull();
  });

  it("armed later, a waiting retention row gets its reminder first and is deleted 14 days after it, not in the same tick", async () => {
    const r = await monthly("Late");
    await setBusinessStatus(r.id, "churned");
    await retention(day(200)); // dry run: nothing
    process.env.VIDALO_PURGE = "1";
    const armed = await retention(day(201));
    expect(armed.reminded).toBe(1);
    expect(purgesFor(r.id)).toHaveLength(0);
    expect((await retention(day(214))).purgeQueued).toBe(0);
    expect((await retention(day(215.01))).purgeQueued).toBe(1);
  });
});
