import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withMockDb, createDb, type Db, type EventRow } from "../src/db";
import { AFTER_LAST_CHECK_DAYS, endedCustomerDue, purgeExpired } from "../src/shared/retention";
import type { SupportLogRow } from "../src/support/kit-support";

/**
 * The retention purge on MemDb and, with TEST_DATABASE_URL (pnpm verify:pg),
 * on PgDb. Rows are stamped with the real clock; the purge is run at a later
 * `now`, so "13 months later" is a date passed in, not a row edited.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist, support_autoreply_log";

const DAY = 86_400_000;
const T0 = new Date();
const days = (n: number) => new Date(T0.getTime() + n * DAY);
const months = (n: number, extraDays = 0) => {
  const d = new Date(T0);
  d.setUTCMonth(d.getUTCMonth() + n);
  return new Date(d.getTime() + extraDays * DAY);
};

/** Backdate the support log rows of one sender (the only stamp the purge cannot be moved past by `now`). */
type Backdate = (fromEmail: string, at: Date) => Promise<void>;

let pg: Db | undefined;
let raw: ReturnType<typeof postgres> | undefined;
const backends: [string, () => Promise<{ db: Db; backdate: Backdate }>][] = [
  [
    "MemDb",
    async () => {
      const db = withMockDb();
      return { db, backdate: async (from, at) => void db.supportLog.filter((r) => r.from_email === from).forEach((r) => (r.createdAt = at.toISOString())) };
    },
  ],
];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      raw ??= postgres(PG_URL, { max: 1, onnotice: () => {} });
      await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
      pg ??= createDb(PG_URL);
      const r = raw;
      return { db: pg, backdate: async (from, at) => void (await r`update support_autoreply_log set created_at = ${at} where from_email = ${from}`) };
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
  await raw?.end();
});

const supportRow = (from: string, id: string): SupportLogRow => ({
  provider_message_id: id,
  provider_thread_id: null,
  from_email: from,
  subject: "Vraag",
  body_excerpt: "Hoi",
  action: "replied",
  reason: "faq",
  topic: null,
  language: "nl",
  platform_related: true,
  flagged_for_human: false,
  reply_subject: null,
  reply_body: null,
  guard_violations: [],
  matched: null,
  model_calls: 0,
});

describe.each(backends)("retention purge, %s", (_name, make) => {
  let db: Db;
  let backdate: Backdate;
  beforeEach(async () => {
    ({ db, backdate } = await make());
  });

  /** A business with one check: a prompt, a run, a sample with a claim, a finding with a fix, an event. */
  async function checked(name: string, opts: { status?: "scanned" | "trial" | "active" | "churned"; ownerUserId?: string } = {}) {
    const b = await db.upsertBusiness({ name, place: "Haarlem", status: opts.status ?? "scanned", ownerEmail: "eigenaar@example.nl", ownerUserId: opts.ownerUserId ?? null });
    const [p] = await db.insertPrompts(b.id, [{ category: "phone", textNl: "Wat is het telefoonnummer?", probes: ["phone"], active: true }]);
    const run = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done" });
    const [s] = await db.insertSamples([{ scanRunId: run.id, promptId: p!.id, engine: "chatgpt", answerText: "023-5399999", citations: [], costCents: 0 }]);
    await db.insertClaims([{ sampleId: s!.id, factKey: "phone", subject: null, value: "+31235399999", confidence: 0.9, otherEntity: false, rawQuote: "023-5399999" }]);
    const [f] = await db.upsertFindings([{ businessId: b.id, scanRunId: run.id, factKey: "phone", subject: null, engine: "chatgpt", wrongValue: "+31235399999", correctValue: "+31235300000", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: s!.id }]);
    await db.insertFix({ findingId: f!.id, action: "email", target: "info@x.nl" });
    await db.logEvent(b.id, "report.emailed", {});
    return { b, prompt: p!, run, sample: s!, finding: f! };
  }

  it("deletes a free check 12 months after it, not a day before (cutoff control)", async () => {
    const { b, run, sample, finding } = await checked("Bakkerij De Vries");
    expect(await purgeExpired(db, months(12, -1))).toMatchObject({ freeChecks: 0, freeBusinesses: 0 });
    expect(await db.getBusiness(b.id)).not.toBeNull();
    expect(await db.listSamples(run.id)).toHaveLength(1);

    expect(await purgeExpired(db, months(12, 1))).toMatchObject({ freeChecks: 1, freeBusinesses: 1 });
    expect(await db.getBusiness(b.id)).toBeNull();
    expect(await db.getScanRun(run.id)).toBeNull();
    expect(await db.listSamples(run.id)).toEqual([]);
    expect(await db.listClaims([sample.id])).toEqual([]);
    expect(await db.getFinding(finding.id)).toBeNull();
    expect(await db.listFixes(finding.id)).toEqual([]);
    expect(await db.listEvents(b.id)).toEqual([]);
  });

  it("deletes only the old check when a later one exists; a finding seen again keeps its row and loses the old evidence", async () => {
    const { b, prompt, run: old, sample: oldSample, finding } = await checked("Kapsalon Mooi");
    // The old check was 13 months ago; a new one today saw the same wrong number.
    await db.updateScanRun(old.id, { startedAt: months(-13).toISOString(), finishedAt: months(-13).toISOString() });
    const recent = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1, status: "done" });
    const [s2] = await db.insertSamples([{ scanRunId: recent.id, promptId: prompt.id, engine: "chatgpt", answerText: "023-5399999", citations: [], costCents: 0 }]);
    const [moved] = await db.upsertFindings([{ businessId: b.id, scanRunId: recent.id, factKey: "phone", subject: null, engine: "chatgpt", wrongValue: "+31235399999", correctValue: "+31235300000", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: oldSample.id }]);
    expect(moved!.id).toBe(finding.id);
    // A finding only the old run saw goes with it.
    const [onlyOld] = await db.upsertFindings([{ businessId: b.id, scanRunId: old.id, factKey: "hours", subject: null, engine: "chatgpt", wrongValue: "ma 9-17", correctValue: "ma 8-18", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: oldSample.id }]);

    expect(await purgeExpired(db, T0)).toMatchObject({ freeChecks: 1, freeBusinesses: 0 });
    expect(await db.getScanRun(old.id)).toBeNull();
    expect(await db.listSamples(old.id)).toEqual([]);
    expect(await db.getFinding(onlyOld!.id)).toBeNull();
    expect(await db.getFinding(finding.id)).toMatchObject({ scanRunId: recent.id, evidenceBefore: null });
    // Control: the recent check is untouched.
    expect(await db.getBusiness(b.id)).not.toBeNull();
    expect((await db.listSamples(recent.id)).map((s) => s.id)).toEqual([s2!.id]);
  });

  it("keeps the business of an owner with an account, without its old checks and events", async () => {
    const { b, run } = await checked("Slagerij Jansen", { ownerUserId: "8a1c6a5e-1111-4222-8333-944455556666" });
    expect(await purgeExpired(db, months(13))).toMatchObject({ freeChecks: 1, freeBusinesses: 0, freeEvents: 1 });
    expect(await db.getBusiness(b.id)).not.toBeNull();
    expect(await db.getScanRun(run.id)).toBeNull();
    expect(await db.listEvents(b.id)).toEqual([]);
  });

  it("never touches a paying customer", async () => {
    const trial = await checked("Bloemist Roos", { status: "trial" });
    const active = await checked("Garage Pit", { status: "active" });
    expect(await purgeExpired(db, months(60))).toMatchObject({ freeChecks: 0, freeBusinesses: 0, endedCustomers: 0 });
    for (const x of [trial, active]) {
      expect(await db.getBusiness(x.b.id)).not.toBeNull();
      expect(await db.listSamples(x.run.id)).toHaveLength(1);
    }
  });

  it("deletes an ended customer only after the free check that follows the 90 days", async () => {
    const { b } = await checked("Fietsen Bakker", { status: "churned" });
    await db.logEvent(b.id, "business.status", { status: "churned", from: "active" });
    // Long after the end, but the free check has not happened: keep.
    expect(await purgeExpired(db, days(400))).toMatchObject({ endedCustomers: 0 });
    expect(await db.getBusiness(b.id)).not.toBeNull();

    await db.logEvent(b.id, "scan.enqueued", { kind: "free", reason: "reengagement" });
    expect(await purgeExpired(db, days(AFTER_LAST_CHECK_DAYS - 1))).toMatchObject({ endedCustomers: 0 });
    expect(await db.getBusiness(b.id)).not.toBeNull();
    expect(await purgeExpired(db, days(AFTER_LAST_CHECK_DAYS + 1))).toMatchObject({ endedCustomers: 1 });
    expect(await db.getBusiness(b.id)).toBeNull();
  });

  it("drops the hashed addresses of earlier days and keeps today's", async () => {
    await db.logEvent(null, "scan.ip.0123456789abcdef01234567", {});
    await db.logEvent(null, "scan.refused", { reason: "ip_cap" });
    expect(await purgeExpired(db, T0)).toMatchObject({ ipEvents: 0 });
    expect(await db.countEventsSince("scan.ip.0123456789abcdef01234567", new Date(0))).toBe(1);
    expect(await purgeExpired(db, days(1))).toMatchObject({ ipEvents: 1 });
    expect(await db.countEventsSince("scan.ip.0123456789abcdef01234567", new Date(0))).toBe(0);
    expect(await db.countEventsSince("scan.refused", new Date(0))).toBe(1);
  });

  it("deletes a support sender's log 2 years after their last message, not while they still write", async () => {
    await db.recordSupportAutoreply(supportRow("oud@example.nl", "m1"));
    await db.recordSupportAutoreply(supportRow("terug@example.nl", "m2"));
    await backdate("oud@example.nl", months(-25));
    await backdate("terug@example.nl", months(-25));
    await db.recordSupportAutoreply(supportRow("terug@example.nl", "m3")); // wrote again today
    expect(await purgeExpired(db, T0)).toMatchObject({ supportRows: 1 });
    const left = await db.supportAutoreplyCounters("terug@example.nl", null);
    expect(left.decisionsForSenderToday).toBe(1);
    // Control: the sender who wrote today keeps the old row too, until 2 years after today.
    expect(await purgeExpired(db, months(24, -1))).toMatchObject({ supportRows: 0 });
    expect(await purgeExpired(db, months(24, 1))).toMatchObject({ supportRows: 2 });
  });

  it("dry run counts and deletes nothing", async () => {
    const { b, run } = await checked("Bakkerij Klein");
    await db.logEvent(null, "scan.ip.aaaaaaaaaaaaaaaaaaaaaaaa", {});
    expect(await purgeExpired(db, months(13), { dryRun: true })).toMatchObject({ dryRun: true, freeChecks: 1, freeBusinesses: 1, ipEvents: 1 });
    expect(await db.getBusiness(b.id)).not.toBeNull();
    expect(await db.listSamples(run.id)).toHaveLength(1);
    expect(await db.countEventsSince("scan.ip.aaaaaaaaaaaaaaaaaaaaaaaa", new Date(0))).toBe(1);
  });
});

describe("endedCustomerDue", () => {
  const ev = (type: string, payload: Record<string, unknown>, at: Date): EventRow => ({ id: 0, businessId: "b", type, payload, at: at.toISOString() });
  it("counts only a free check after the latest end", () => {
    const evs = [
      ev("business.status", { status: "churned" }, days(-400)),
      ev("scan.enqueued", { reason: "reengagement" }, days(-300)),
      ev("business.status", { status: "trial" }, days(-200)),
      ev("business.status", { status: "churned" }, days(-100)),
    ];
    expect(endedCustomerDue(evs, T0)).toBe(false);
    expect(endedCustomerDue([...evs, ev("scan.enqueued", { reason: "reengagement" }, days(-29))], T0)).toBe(true);
    expect(endedCustomerDue([ev("scan.enqueued", { reason: "reengagement" }, days(-29))], T0)).toBe(false);
  });
});
