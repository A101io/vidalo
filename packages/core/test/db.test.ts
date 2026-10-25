import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withMockDb, isMockMode, createDb, type Db } from "../src/db";
import { sampleFacts } from "./scanner-fixtures";
import { exportMyData } from "../src/shared/my-data";

/**
 * Every scenario below runs against MemDb and, when TEST_DATABASE_URL points
 * at a database carrying supabase/migrations, against PgDb too. The two must
 * behave identically; MemDb alone proves nothing about the SQL.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";

let pg: Db | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      const raw = postgres(PG_URL, { max: 1, onnotice: () => {} });
      await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
      await raw.end();
      pg ??= createDb(PG_URL);
      return pg;
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
});

describe("db selection", () => {
  it("is MemDb in mock mode", () => {
    expect(isMockMode()).toBe(true);
  });
});

describe.each(backends)("%s", (_name, makeDb) => {
  let db: Db;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("stores mail preferences per business; absent keys are on, other updates leave them alone", async () => {
    const b = await db.upsertBusiness({ name: "Kapsalon Mooi", place: "Leiden" });
    expect(b.mailPrefs).toEqual({});
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, mailPrefs: { report: false, followup: false, bogus: true } as never });
    expect((await db.getBusiness(b.id))?.mailPrefs).toEqual({ report: false, followup: false });
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, status: "trial" });
    expect((await db.getBusiness(b.slug))?.mailPrefs).toEqual({ report: false, followup: false });
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, mailPrefs: { report: true } });
    expect((await db.getBusiness(b.id))?.mailPrefs).toEqual({ report: true });
  });

  it("stores business, facts, prompts, scan runs, samples, claims and findings", async () => {
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", domain: "bakkerijdevries.nl" });
    expect(b.slug).toBe("bakkerij-de-vries-haarlem");
    expect(await db.getBusiness(b.slug)).toMatchObject({ id: b.id, domain: "bakkerijdevries.nl" });
    // Upsert by slug merges partial updates.
    const b2 = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status: "trial", anniversaryDay: 12 });
    expect(b2.id).toBe(b.id);
    expect(b2.domain).toBe("bakkerijdevries.nl");
    expect(b2.status).toBe("trial");

    const f1 = await db.insertFacts(b.id, sampleFacts(), { provisional: true });
    const f2 = await db.insertFacts(b.id, { ...sampleFacts(), phone: "023-5300000" }, { provisional: false, verifiedAt: new Date().toISOString() });
    expect(f1.version).toBe(1);
    expect(f2.version).toBe(2);
    expect((await db.latestFacts(b.id))?.phone).toBe("023-5300000");

    const prompts = await db.insertPrompts(b.id, [{ category: "phone", textNl: "Wat is het telefoonnummer?", probes: ["phone"], active: true }]);
    expect(await db.listPrompts(b.id)).toHaveLength(1);

    const run = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 3, status: "running" });
    const [s] = await db.insertSamples([{ scanRunId: run.id, promptId: prompts[0]!.id, engine: "chatgpt", answerText: "023-5399999", citations: ["https://openingstijden.nl/x"], costCents: 1 }]);
    await db.insertClaims([{ sampleId: s!.id, factKey: "phone", subject: null, value: "+31235399999", confidence: 0.9, otherEntity: false, rawQuote: "023-5399999" }]);
    expect(await db.listSamples(run.id)).toHaveLength(1);
    expect(await db.listClaims([s!.id])).toHaveLength(1);

    const [finding] = await db.upsertFindings([
      { businessId: b.id, scanRunId: run.id, factKey: "phone", subject: null, engine: "chatgpt", wrongValue: "+31235399999", correctValue: "+31235300000", frequency: 1, sampleCount: 3, sourceUrl: "https://openingstijden.nl/x", sourceType: "directory_form", evidenceBefore: s!.id },
    ]);
    expect(finding!.status).toBe("open");
    // Second upsert with the same key updates frequency instead of inserting.
    const [again] = await db.upsertFindings([{ ...finding!, frequency: 2, sourceUrl: null, sourceType: "none" }]);
    expect(again!.id).toBe(finding!.id);
    expect(again!.frequency).toBe(2);
    expect(again!.sourceUrl).toBe("https://openingstijden.nl/x"); // kept
    expect(await db.listFindings(b.id, "open")).toHaveLength(1);

    const resolved = await db.markFindingResolved(finding!.id, s!.id);
    expect(resolved.status).toBe("resolved");
    expect(resolved.evidenceAfter).toBe(s!.id);
    expect(await db.listFindings(b.id, "open")).toHaveLength(0);

    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, stripeCustomerId: "cus_123" });
    expect((await db.getBusinessByStripeCustomer("cus_123"))?.id).toBe(b.id);
    expect(await db.getBusinessByStripeCustomer("cus_other")).toBeNull();

    const updated = await db.updateScanRun(run.id, { status: "done", costCents: 12, finishedAt: new Date().toISOString() });
    expect(updated.costCents).toBe(12);
    expect(await db.businessesDueForMonthlyScan(12)).toHaveLength(1);
    expect(await db.businessesDueForMonthlyScan(13)).toHaveLength(0);
  });

  it("my data: export holds everything of one business, delete removes it and nothing else", async () => {
    async function fill(name: string) {
      const b = await db.upsertBusiness({ name, place: "Haarlem" });
      await db.insertFacts(b.id, sampleFacts(), { provisional: true });
      await db.insertFacts(b.id, { ...sampleFacts(), phone: "023-5300000" }, { provisional: false });
      const [p] = await db.insertPrompts(b.id, [{ category: "phone", textNl: "Wat is het telefoonnummer?", probes: ["phone"], active: true }]);
      const run = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1, status: "running" });
      const [s] = await db.insertSamples([{ scanRunId: run.id, promptId: p!.id, engine: "chatgpt", answerText: "023-5399999", citations: [], costCents: 1 }]);
      await db.insertClaims([{ sampleId: s!.id, factKey: "phone", subject: null, value: "+31235399999", confidence: 0.9, otherEntity: false, rawQuote: "023-5399999" }]);
      const [f] = await db.upsertFindings([{ businessId: b.id, scanRunId: run.id, factKey: "phone", subject: null, engine: "chatgpt", wrongValue: "+31235399999", correctValue: "+31235300000", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: s!.id }]);
      await db.insertFix({ findingId: f!.id, action: "email", target: "info@x.nl" });
      await db.upsertChannel({ businessId: b.id, type: "gbp", name: "Google Bedrijfsprofiel", externalId: null, url: null });
      await db.logEvent(b.id, "scan.requested", {});
      await db.enqueueJob("scan", { businessId: b.id });
      return { b, run, sample: s!, finding: f! };
    }
    const mine = await fill("Bakkerij De Vries");
    const other = await fill("Slagerij Jansen");

    const data = await exportMyData(db, mine.b.id);
    expect(data?.business.id).toBe(mine.b.id);
    expect(data?.facts.map((f) => f.version)).toEqual([1, 2]);
    expect(data?.scans).toHaveLength(1);
    expect(data?.scans[0]?.samples).toHaveLength(1);
    expect(data?.scans[0]?.claims).toHaveLength(1);
    expect(data?.findings).toHaveLength(1);
    expect(data?.fixes).toHaveLength(1);
    expect(data?.channels).toHaveLength(1);
    expect(data?.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(data)).not.toContain(other.b.id);

    await db.deleteBusiness(mine.b.id);
    expect(await db.getBusiness(mine.b.id)).toBeNull();
    expect(await exportMyData(db, mine.b.id)).toBeNull();
    expect(await db.listFacts(mine.b.id)).toEqual([]);
    expect(await db.listSamples(mine.run.id)).toEqual([]);
    expect(await db.listClaims([mine.sample.id])).toEqual([]);
    expect(await db.listFixes(mine.finding.id)).toEqual([]);
    expect(await db.listEvents(mine.b.id)).toEqual([]);
    const job = await db.claimJob(["scan"]);
    expect(job?.payload.businessId).toBe(other.b.id);
    expect(await db.claimJob(["scan"])).toBeNull();
    // Control: the other business keeps everything.
    expect((await exportMyData(db, other.b.id))?.fixes).toHaveLength(1);
  });

  it("cancel and pause dates round-trip; a paused business skips the monthly check", async () => {
    const day = new Date().getDate();
    const end = "2026-11-12T10:00:00.000Z";
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status: "active", anniversaryDay: day, cancelAt: end });
    expect((await db.getBusiness(b.id))?.cancelAt).toBe(end);
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, cancelAt: null, pauseUntil: new Date(Date.now() + 86_400_000).toISOString() });
    expect((await db.getBusiness(b.id))?.cancelAt).toBeNull();
    expect(await db.businessesDueForMonthlyScan(day)).toHaveLength(0);
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, pauseUntil: null });
    expect(await db.businessesDueForMonthlyScan(day)).toHaveLength(1);
  });

  it("job queue: claim, complete, fail with backoff", async () => {
    await db.enqueueJob("scan", { businessId: "x" });
    const later = await db.enqueueJob("report", {}, new Date(Date.now() + 60_000));
    const job = await db.claimJob();
    expect(job?.kind).toBe("scan");
    expect(job?.lockedAt).not.toBeNull();
    expect(await db.claimJob()).toBeNull(); // locked; the other one is not due yet
    const failed = await db.failJob(job!.id, "boom");
    expect(failed.lockedAt).toBeNull();
    expect(new Date(failed.runAt).getTime()).toBeGreaterThan(Date.now());
    expect(failed.doneAt).toBeNull();
    await db.completeJob(later.id);
    expect(await db.claimJob(["report"])).toBeNull();
  });

  it("coming-soon list: one row per address, the first consent stays on record", async () => {
    const first = await db.joinWaitlist({ email: "eigenaar@bakkerij.nl", language: "nl", source: "coming_soon", consentText: "Ja, mail me." });
    expect(first.created).toBe(true);
    const again = await db.joinWaitlist({ email: "eigenaar@bakkerij.nl", language: "en", source: "coming_soon", consentText: "Yes, email me." });
    expect(again.created).toBe(false);
    await db.joinWaitlist({ email: "owner@shop.com", language: "en", source: "coming_soon", consentText: "Yes, email me." });
    expect(await db.countWaitlist()).toBe(2);
    expect(await db.listWaitlist()).toEqual([
      { email: "eigenaar@bakkerij.nl", language: "nl" },
      { email: "owner@shop.com", language: "en" },
    ]);
  });

  it("fixes, channels and events", async () => {
    const b = await db.upsertBusiness({ name: "X", place: "Y" });
    const ch = await db.upsertChannel({ businessId: b.id, type: "gbp", name: "Google Bedrijfsprofiel", externalId: null, url: null });
    const ch2 = await db.upsertChannel({ businessId: b.id, type: "gbp", name: "Google Bedrijfsprofiel", externalId: "abc", url: null, status: "synced" });
    expect(ch2.id).toBe(ch.id);
    expect((await db.listChannels(b.id))[0]).toMatchObject({ externalId: "abc", status: "synced" });

    const run = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1 });
    const [finding] = await db.upsertFindings([
      { businessId: b.id, scanRunId: run.id, factKey: "phone", subject: null, engine: "chatgpt", wrongValue: "1", correctValue: "2", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: null },
    ]);
    const fix = await db.insertFix({ findingId: finding!.id, action: "email", target: "info@x.nl", recheckAt: new Date(Date.now() - 1000).toISOString() });
    expect(await db.listDueRechecks()).toHaveLength(1);
    await db.updateFix(fix.id, { resolvedAt: new Date().toISOString() });
    expect(await db.listDueRechecks()).toHaveLength(0);

    await db.logEvent(b.id, "test", { a: 1 });
    expect((await db.listEvents(b.id))[0]?.type).toBe("test");

    const hourAgo = new Date(Date.now() - 3_600_000);
    await db.logEvent(b.id, "scan.requested", {});
    await db.logEvent(null, "scan.requested", {});
    expect(await db.countEventsSince("scan.requested", hourAgo)).toBe(2);
    expect(await db.countEventsSince("scan.requested", new Date(Date.now() + 60_000))).toBe(0);
    expect(await db.countEventsSince("nothing", hourAgo)).toBe(0);
  });

  it("google index state: insert, merge, clear", async () => {
    const b = await db.upsertBusiness({ name: "X", place: "Y" });
    expect(await db.getGoogleIndex(b.id)).toBeNull();
    const first = await db.upsertGoogleIndex({ businessId: b.id, host: "feiten.x.nl", token: "T1", lastAttemptAt: "2026-10-15T08:00:00.000Z" });
    expect(first).toMatchObject({ businessId: b.id, host: "feiten.x.nl", token: "T1", verifiedAt: null, inspection: null, lastAttemptAt: "2026-10-15T08:00:00.000Z" });
    const inspection = { at: "2026-10-16T08:00:00.000Z", verdict: "PASS", coverageState: "Submitted and indexed", indexingState: null, pageFetchState: "SUCCESSFUL", robotsTxtState: null, lastCrawlTime: null, googleCanonical: "https://feiten.x.nl/" };
    await db.upsertGoogleIndex({ businessId: b.id, host: "feiten.x.nl", verifiedAt: "2026-10-15T08:01:00.000Z", inspection, lastError: "add: boom" });
    const merged = await db.getGoogleIndex(b.id);
    expect(merged).toMatchObject({ token: "T1", verifiedAt: "2026-10-15T08:01:00.000Z", inspection, lastError: "add: boom" });
    await db.upsertGoogleIndex({ businessId: b.id, host: "feiten.x.nl", lastError: null, inspection: null });
    expect(await db.getGoogleIndex(b.id)).toMatchObject({ token: "T1", lastError: null, inspection: null });
  });

  it("keeps sector, prompt kind/criterium and separates recommendation findings from about findings", async () => {
    const b = await db.upsertBusiness({ name: "Loodgieter Bos", place: "Zwolle", sector: "loodgieters-installateurs" });
    expect((await db.getBusiness(b.id))?.sector).toBe("loodgieters-installateurs");
    const [p] = await db.insertPrompts(b.id, [{ category: "service", textNl: "Wie installeert warmtepompen in Zwolle?", probes: ["service:warmtepompen"], active: true, kind: "recommendation", criterium: 6 }]);
    expect(p).toMatchObject({ kind: "recommendation", criterium: 6, intent: null, pool: "core", season: null });
    const [banked] = await db.insertPrompts(b.id, [{ category: "service", textNl: "Verwarming doet het niet, wie helpt in Zwolle?", probes: ["service:warmtepompen"], active: true, kind: "recommendation", criterium: 6, intent: "specialty", pool: "bank", season: "winter" }]);
    expect(banked).toMatchObject({ intent: "specialty", pool: "bank", season: "winter" });
    await db.setPromptPool(banked!.id, "core");
    expect((await db.listPrompts(b.id)).find((x) => x.id === banked!.id)?.pool).toBe("core");
    const run = await db.createScanRun({ businessId: b.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 3 });
    const base = { businessId: b.id, scanRunId: run.id, factKey: "service" as const, subject: "warmtepompen", engine: "chatgpt" as const, correctValue: "yes", frequency: 2, sampleCount: 3, sourceUrl: null, sourceType: "none" as const, evidenceBefore: null };
    const [about] = await db.upsertFindings([{ ...base, wrongValue: "no", criterium: 6 }]);
    const [rec] = await db.upsertFindings([{ ...base, wrongValue: "niet genoemd", evidenceKind: "recommendation", criterium: 6 }]);
    expect(rec!.id).not.toBe(about!.id);
    expect(about!.evidenceKind).toBe("about");
    expect(rec!.evidenceKind).toBe("recommendation");
    expect(rec!.criterium).toBe(6);
    const [again] = await db.upsertFindings([{ ...base, wrongValue: "niet genoemd", evidenceKind: "recommendation", frequency: 3 }]);
    expect(again!.id).toBe(rec!.id);
    expect(again!.frequency).toBe(3);
    expect(again!.criterium).toBe(6);
    expect(await db.listFindings(b.id, "open")).toHaveLength(2);
  });
});
