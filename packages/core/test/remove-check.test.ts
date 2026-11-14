import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { removeCheck } from "../src/db/remove-check";
import { REPORT_EMAIL_EVENT } from "../src/shared/free-check";
import type { Db } from "../src/db";

/**
 * Removing a check (13 Nov 2026): only a check the asker requested with their own address, or a check of a business
 * they are a member of. Every case has a control (someone else's check) that must stay whole.
 */
describe("removeCheck", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
  });

  async function check(name: string, asker: string | null, opts: { ownerUserId?: string; ownerEmail?: string; at?: string } = {}) {
    const b = await db.upsertBusiness({ name, place: "Haarlem", status: "scanned", ownerUserId: opts.ownerUserId ?? null, ownerEmail: opts.ownerEmail ?? null });
    const [prompt] = await db.insertPrompts(b.id, [{ category: "basis", textNl: "Wat is het telefoonnummer?", probes: [] }]);
    const run = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1 });
    const at = opts.at ?? new Date().toISOString();
    await db.updateScanRun(run.id, { status: "done", startedAt: at, finishedAt: at });
    const [sample] = await db.insertSamples([{ scanRunId: run.id, promptId: prompt!.id, engine: "chatgpt", answerText: "023-1111111", citations: [], costCents: 0 }]);
    await db.insertClaims([{ sampleId: sample!.id, factKey: "phone", subject: null, value: "023-1111111", confidence: 0.9, otherEntity: false, rawQuote: null }]);
    const [finding] = await db.upsertFindings([{ businessId: b.id, scanRunId: run.id, factKey: "phone", subject: null, engine: "chatgpt", wrongValue: "023-1111111", correctValue: "023-2222222", frequency: 1, sampleCount: 1, sourceUrl: null, sourceType: "none", evidenceBefore: sample!.id }]);
    await db.logEvent(b.id, "scan.started", { scanRunId: run.id });
    if (asker) await db.logEvent(b.id, REPORT_EMAIL_EVENT, { email: asker, lang: "nl", scanRunId: run.id, via: "check" });
    return { b, run, sample: sample!, finding: finding! };
  }
  const left = async (runId: string) => ({
    run: await db.getScanRun(runId),
    samples: (await db.listSamples(runId)).length,
    findings: (await db.listFindingsByScanRun(runId)).length,
    events: db.events.filter((e) => (e.payload as Record<string, unknown>).scanRunId === runId).length,
  });

  it("the asker removes their own check: report, samples, claims, findings and events are gone, and so is the empty business", async () => {
    const mine = await check("Bakkerij Mijn", "ik@example.nl");
    const theirs = await check("Bakkerij Hun", "ander@example.nl");
    const res = await removeCheck(db, { userId: "u-ik", email: "Ik@Example.nl" }, mine.run.id);
    expect(res).toEqual({ ok: true, outcome: "removed", businessRemoved: true });
    expect(await left(mine.run.id)).toEqual({ run: null, samples: 0, findings: 0, events: 0 });
    expect(db.claims.some((c) => c.sampleId === mine.sample.id)).toBe(false);
    expect(await db.getBusiness(mine.b.id)).toBeNull();
    // The control is untouched.
    expect(await left(theirs.run.id)).toMatchObject({ samples: 1, findings: 1, events: 2 });
    expect(await db.getBusiness(theirs.b.id)).not.toBeNull();
  });

  it("another user cannot remove it: same refusal as for a run that does not exist, nothing changes", async () => {
    const mine = await check("Bakkerij Mijn", "ik@example.nl");
    const before = await left(mine.run.id);
    for (const who of [{ userId: "u-x", email: "indringer@example.nl" }, { userId: null, email: "ik@example.com" }]) {
      expect(await removeCheck(db, who, mine.run.id)).toEqual({ ok: false, reason: "not_yours" });
    }
    expect(await removeCheck(db, { userId: "u-x", email: "indringer@example.nl" }, "00000000-0000-0000-0000-000000000000")).toEqual({ ok: false, reason: "not_yours" });
    expect(await left(mine.run.id)).toEqual(before);
    expect(await db.getBusiness(mine.b.id)).not.toBeNull();
  });

  it("a member of another business cannot remove this business's check", async () => {
    const a = await check("Bakkerij A", "a@example.nl", { ownerUserId: "u-a", ownerEmail: "a@example.nl" });
    await check("Bakkerij B", "b@example.nl", { ownerUserId: "u-b", ownerEmail: "b@example.nl" });
    expect(await removeCheck(db, { userId: "u-b", email: "b@example.nl" }, a.run.id)).toEqual({ ok: false, reason: "not_yours" });
    expect((await left(a.run.id)).samples).toBe(1);
  });

  it("when two addresses asked for the same run, one removing only takes their own request away", async () => {
    const c = await check("Bakkerij Samen", "een@example.nl");
    await db.logEvent(c.b.id, REPORT_EMAIL_EVENT, { email: "twee@example.nl", lang: "nl", scanRunId: c.run.id, via: "linked" });
    const res = await removeCheck(db, { userId: null, email: "een@example.nl" }, c.run.id);
    expect(res).toEqual({ ok: true, outcome: "unlinked", businessRemoved: false });
    expect((await left(c.run.id)).samples).toBe(1);
    expect(await removeCheck(db, { userId: null, email: "een@example.nl" }, c.run.id)).toEqual({ ok: false, reason: "not_yours" });
    // The other asker still has it, and can remove it for good.
    expect((await removeCheck(db, { userId: null, email: "twee@example.nl" }, c.run.id)).ok).toBe(true);
    expect((await left(c.run.id)).run).toBeNull();
  });

  it("a requester of a business that has an owner only unlinks: the owner's report stays", async () => {
    const c = await check("Bakkerij Betaald", "vraagt@example.nl", { ownerUserId: "u-eig", ownerEmail: "eigenaar@example.nl" });
    const res = await removeCheck(db, { userId: "u-vraagt", email: "vraagt@example.nl" }, c.run.id);
    expect(res).toEqual({ ok: true, outcome: "unlinked", businessRemoved: false });
    expect(await left(c.run.id)).toMatchObject({ samples: 1, findings: 1 });
    expect(await db.getBusiness(c.b.id)).not.toBeNull();
  });

  it("a legacy request without a run id matches the run that started soon after it", async () => {
    const c = await check("Bakkerij Oud", null);
    await db.logEvent(c.b.id, REPORT_EMAIL_EVENT, { email: "oud@example.nl", lang: "nl" });
    expect((await removeCheck(db, { userId: null, email: "oud@example.nl" }, c.run.id)).ok).toBe(true);
    expect(db.events.filter((e) => e.businessId === c.b.id && e.type === REPORT_EMAIL_EVENT)).toHaveLength(0);
  });

  it("a running check is not removed", async () => {
    const c = await check("Bakkerij Bezig", "bezig@example.nl");
    await db.updateScanRun(c.run.id, { status: "running" });
    expect(await removeCheck(db, { userId: null, email: "bezig@example.nl" }, c.run.id)).toEqual({ ok: false, reason: "not_finished" });
    expect((await left(c.run.id)).samples).toBe(1);
  });

  describe("the owner's archive", () => {
    async function twoRuns() {
      const old = await check("Bakkerij Eigen", "eigenaar@example.nl", { ownerUserId: "u-eig", ownerEmail: "eigenaar@example.nl", at: "2026-10-01T10:00:00.000Z" });
      const run2 = await db.createScanRun({ businessId: old.b.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 1 });
      await db.updateScanRun(run2.id, { status: "done", startedAt: "2026-11-01T10:00:00.000Z", finishedAt: "2026-11-01T10:05:00.000Z" });
      return { old, run2 };
    }

    it("removes an older check, keeps the business's findings (moved to the newest run) and refuses the newest", async () => {
      const { old, run2 } = await twoRuns();
      const res = await removeCheck(db, { userId: "u-eig", email: "eigenaar@example.nl" }, old.run.id);
      expect(res).toEqual({ ok: true, outcome: "removed", businessRemoved: false });
      expect(await left(old.run.id)).toMatchObject({ run: null, samples: 0, events: 0 });
      const kept = await db.listFindings(old.b.id);
      expect(kept).toHaveLength(1);
      expect(kept[0]!.scanRunId).toBe(run2.id);
      expect(kept[0]!.evidenceBefore).toBeNull();
      expect(await db.getBusiness(old.b.id)).not.toBeNull();
      // Now run2 is the only one: the newest finished check stays.
      expect(await removeCheck(db, { userId: "u-eig", email: "eigenaar@example.nl" }, run2.id)).toEqual({ ok: false, reason: "latest" });
    });

    it("refuses the newest check outright, and a non-member cannot reach it", async () => {
      const { old, run2 } = await twoRuns();
      expect(await removeCheck(db, { userId: "u-eig", email: "eigenaar@example.nl" }, run2.id)).toEqual({ ok: false, reason: "latest" });
      expect(await removeCheck(db, { userId: "u-x", email: "x@example.nl" }, old.run.id)).toEqual({ ok: false, reason: "not_yours" });
      expect((await left(old.run.id)).samples).toBe(1);
    });
  });
});
