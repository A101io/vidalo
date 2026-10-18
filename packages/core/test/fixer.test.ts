import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemDb } from "../src/db/mem";
import { setDb } from "../src/shared/db";
import { FIX_PATHS, NOT_FOUND_PATH, fixPathFor, fixPathForFinding, addDays } from "../src/fixer/paths";
import { affectedPrompts, openFixForFinding, runRecheck, stillPresent } from "../src/fixer";
import type { Finding, ScanReport, SourceType } from "../src/types";
import type { BusinessRecord } from "../src/db/types";
import { facts as baseFacts } from "./worker-fixtures";

describe("fix path selection", () => {
  const expected: Record<SourceType, { action: string; recheckDays: number }> = {
    owned_facts_page: { action: "republish", recheckDays: 7 },
    owned_website: { action: "manual", recheckDays: 14 },
    directory_api: { action: "sync", recheckDays: 7 },
    directory_form: { action: "form", recheckDays: 14 },
    third_party: { action: "email", recheckDays: 30 },
    other_entity: { action: "republish", recheckDays: 30 },
    none: { action: "none", recheckDays: 30 },
  };

  it("maps every SourceType to the ARCHITECTURE table", () => {
    for (const [st, exp] of Object.entries(expected) as [SourceType, { action: string; recheckDays: number }][]) {
      const p = fixPathFor(st);
      expect(p.action, st).toBe(exp.action);
      expect(p.recheckDays, st).toBe(exp.recheckDays);
      expect(p.labelNl.length).toBeGreaterThan(10);
    }
  });

  it("has follow-ups and windows where the table says so", () => {
    expect(FIX_PATHS.owned_website.followUpDays).toEqual([14, 28]);
    expect(FIX_PATHS.third_party.followUpDays).toEqual([14]);
    expect(FIX_PATHS.third_party.unfixableAfterDays).toBe(45);
    expect(FIX_PATHS.none.escalation).toBe("model_release");
    expect(FIX_PATHS.none.labelNl).toContain("geheugen van het model");
    expect(FIX_PATHS.directory_api.escalation).toBe("operator");
  });

  it("falls back to 'none' for unknown types", () => {
    expect(fixPathFor("weird" as SourceType).action).toBe("none");
  });

  it("a not_found verdict takes its own path regardless of source type", () => {
    expect(fixPathFor("none", "not_found")).toBe(NOT_FOUND_PATH);
    expect(fixPathForFinding({ sourceType: "third_party", verdict: "not_found" })).toBe(NOT_FOUND_PATH);
    expect(fixPathForFinding({ sourceType: "third_party", verdict: "wrong" })).toBe(FIX_PATHS.third_party);
    expect(NOT_FOUND_PATH).toMatchObject({ action: "republish", recheckDays: 21, followUpDays: [45], unfixableAfterDays: 60, escalation: "resync", labelNl: "Niet gevonden: we maken je vindbaar" });
  });
});

// ---------------------------------------------------------------------------

async function seed(db: MemDb, sourceType: SourceType, extra: Partial<Finding> = {}) {
  const business: BusinessRecord = await db.upsertBusiness({
    name: "Bakkerij Jansen",
    place: "Haarlem",
    domain: "bakkerijjansen.nl",
    ownerEmail: "eigenaar@bakkerijjansen.nl",
    status: "active",
    plan: "monitor",
    factsHost: "bakkerij-jansen-haarlem.feiten.vidalo.io",
    factsHostVerifiedAt: new Date().toISOString(),
  });
  await db.insertFacts(business.id, { ...baseFacts, businessId: business.id }, { provisional: false, verifiedAt: new Date().toISOString() });
  const prompts = await db.insertPrompts(business.id, [
    { category: "hours", textNl: "Is Bakkerij Jansen in Haarlem op zondag open?", probes: ["hours.6"], active: true },
    { category: "hours", textNl: "Wat zijn de openingstijden van Bakkerij Jansen?", probes: ["hours"], active: true },
    { category: "phone", textNl: "Wat is het telefoonnummer?", probes: ["phone"], active: true },
  ]);
  const run = await db.createScanRun({ businessId: business.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 10, status: "done" });
  const [sample] = await db.insertSamples([{ scanRunId: run.id, promptId: prompts[0]!.id, engine: "chatgpt", answerText: "Op zondag open van 10 tot 14.", citations: ["https://www.openingstijden.nl/bakkerij-jansen"], costCents: 1 }]);
  const [finding] = await db.upsertFindings([
    {
      businessId: business.id,
      scanRunId: run.id,
      factKey: "hours",
      subject: "6",
      engine: "chatgpt",
      wrongValue: "10:00-14:00",
      correctValue: "closed",
      frequency: 7,
      sampleCount: 10,
      sourceUrl: "https://www.openingstijden.nl/bakkerij-jansen",
      sourceType,
      evidenceBefore: sample!.id,
      ...extra,
    },
  ]);
  return { business, prompts, run, finding: finding!, sample: sample! };
}

function report(db: MemDb, businessId: string, findings: Finding[], scanRunId: string): ScanReport {
  return {
    business: { id: businessId, slug: "x", name: "Bakkerij Jansen", place: "Haarlem" },
    scanRunId,
    kind: "recheck",
    checkedAt: new Date().toISOString(),
    totalAnswers: 10,
    wrongAnswers: findings.length,
    notFoundAnswers: 0,
    visibility: "found",
    engines: [{ engine: "chatgpt", correct: 10 - findings.length, wrong: findings.length, notFound: 0, skipped: false }],
    findings,
    correct: [],
  };
}

describe("openFixForFinding", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    process.env.VIDALO_MOCK = "1";
    process.env.VIDALO_OUT_DIR = "out/test";
  });

  it("third_party → correction email job in the owner's name, finding 'fixing', recheck in 30 days", async () => {
    const { finding, business } = await seed(db, "third_party");
    const out = await openFixForFinding(finding, { now: () => new Date("2026-10-07T10:00:00Z") });
    expect(out.action).toBe("email");
    expect(out.executed).toBe(true);
    expect(out.fix.recheckAt).toBe(addDays("2026-10-07T10:00:00Z", 30).toISOString());
    expect((await db.getFinding(finding.id))!.status).toBe("fixing");
    const job = [...db.jobs.values()].find((j) => j.kind === "email")!;
    expect(job).toBeDefined();
    expect(job.payload.to).toBe("info@openingstijden.nl");
    expect(job.payload.replyTo).toBe(business.ownerEmail);
    expect(String(job.payload.text)).toContain("10:00 tot 14:00");
    expect(String(job.payload.text)).toContain("gesloten");
    expect(String(job.payload.text)).toContain("feiten.vidalo.io");
  });

  it("owned_facts_page → republish immediately", async () => {
    const { finding, business } = await seed(db, "owned_facts_page", { sourceUrl: "https://bakkerij-jansen-haarlem.feiten.vidalo.io/" });
    const out = await openFixForFinding(finding);
    expect(out.action).toBe("republish");
    expect(out.executed).toBe(true);
    const channels = await db.listChannels(business.id);
    expect(channels.find((c) => c.type === "facts_page")?.status).toBe("synced");
  });

  it("directory_form → operator task with the diff", async () => {
    const { finding } = await seed(db, "directory_form");
    const out = await openFixForFinding(finding);
    expect(out.action).toBe("form");
    const task = [...db.jobs.values()].find((j) => j.kind === "operator_task")!;
    expect(task.payload.reason).toBe("directory_form");
    expect(task.payload.directory).toBe("openingstijden.nl");
  });

  it("owned_website → owner instruction mail", async () => {
    const { finding, business } = await seed(db, "owned_website", { sourceUrl: "https://www.bakkerijjansen.nl/contact" });
    await openFixForFinding(finding);
    const job = [...db.jobs.values()].find((j) => j.kind === "email")!;
    expect(job.payload.to).toBe(business.ownerEmail);
    expect(String(job.payload.text)).toContain("Op pagina https://www.bakkerijjansen.nl/contact staat: 10:00 tot 14:00");
    expect(String(job.payload.text)).toContain("Dit moet zijn: gesloten");
  });

  it("none → no action, note about model memory", async () => {
    const { finding } = await seed(db, "none", { sourceUrl: null });
    const out = await openFixForFinding(finding);
    expect(out.action).toBe("none");
    expect(out.fix.evidence.note).toBe("uit het geheugen van het model");
    expect([...db.jobs.values()]).toHaveLength(0);
  });

  it("not_found → facts page published, platform channels + directories, recheck in 21 days", async () => {
    const { finding, business } = await seed(db, "none", { sourceUrl: null, verdict: "not_found", wrongValue: "niet gevonden", frequency: 8 });
    const out = await openFixForFinding(finding, { now: () => new Date("2026-10-07T10:00:00Z") });
    expect(out.path).toBe(NOT_FOUND_PATH);
    expect(out.action).toBe("republish");
    expect(out.executed).toBe(true);
    expect(out.fix.recheckAt).toBe(addDays("2026-10-07T10:00:00Z", 21).toISOString());
    expect(out.fix.evidence.verdict).toBe("not_found");
    expect(out.fix.evidence.publish).toMatchObject({ factsVersion: 1 });
    expect(Array.isArray(out.fix.evidence.sync)).toBe(true);
    const types = (await db.listChannels(business.id)).map((c) => c.type);
    for (const t of ["facts_page", "gbp", "bing", "apple"]) expect(types).toContain(t);
    expect((await db.getFinding(finding.id))!.status).toBe("fixing");
    // No correction request for a wrong source and no owner instruction; only the directory sync's own listing requests.
    const mails = [...db.jobs.values()].filter((j) => j.kind === "email");
    expect(mails.length).toBeGreaterThan(0);
    expect(mails.every((j) => j.payload.template === "directory_correction")).toBe(true);
  });

  it("does not open a second fix while one is open", async () => {
    const { finding } = await seed(db, "third_party");
    const a = await openFixForFinding(finding);
    const b = await openFixForFinding(finding);
    expect(b.fix.id).toBe(a.fix.id);
    expect(b.note).toBe("fix already open");
  });
});

describe("runRecheck", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    process.env.VIDALO_MOCK = "1";
    process.env.VIDALO_OUT_DIR = "out/test";
  });

  it("selects the prompts that probe the finding", async () => {
    const { finding, prompts } = await seed(db, "third_party");
    const affected = affectedPrompts(finding, prompts);
    expect(affected.map((p) => p.probes[0])).toEqual(["hours.6"]);
    expect(affectedPrompts({ factKey: "hours", subject: null }, prompts)).toHaveLength(2);
    expect(affectedPrompts({ factKey: "phone", subject: null }, prompts)).toHaveLength(1);
  });

  it("resolves the finding when the recheck no longer shows the wrong value and queues the resolution mail", async () => {
    const { finding, prompts, business } = await seed(db, "third_party");
    const opened = await openFixForFinding(finding);
    db.jobs.clear();

    const runScan = vi.fn(async (opts: { businessId: string; kind: string; promptIds?: string[]; engines?: string[]; samplesPerPrompt?: number }) => {
      const run = await db.createScanRun({ businessId: opts.businessId, kind: "recheck", engines: ["chatgpt"], samplesPerPrompt: 10, status: "done" });
      await db.insertSamples([{ scanRunId: run.id, promptId: prompts[0]!.id, engine: "chatgpt", answerText: "Op zondag is Bakkerij Jansen gesloten.", citations: [], costCents: 1 }]);
      return report(db, opts.businessId, [], run.id);
    });

    const out = await runRecheck(opened.fix.id, { runScan, now: () => new Date("2026-11-07T10:00:00Z") });
    expect(runScan).toHaveBeenCalledWith(expect.objectContaining({ kind: "recheck", engines: ["chatgpt"], samplesPerPrompt: 10, promptIds: [prompts[0]!.id] }));
    expect(out.result).toBe("resolved");
    const f = (await db.getFinding(finding.id))!;
    expect(f.status).toBe("resolved");
    expect(f.evidenceAfter).toBeTruthy();
    const fix = (await db.listFixes(finding.id))[0]!;
    expect(fix.resolvedAt).not.toBeNull();
    expect(fix.evidence.recheckScanRunId).toBe(out.scanRunId);
    const mail = [...db.jobs.values()].find((j) => j.kind === "email")!;
    expect(mail.payload).toMatchObject({ template: "resolution", findingId: finding.id, businessId: business.id });
  });

  it("still wrong after 14 days → follow-up email, recheck rescheduled", async () => {
    const { finding } = await seed(db, "third_party");
    const opened = await openFixForFinding(finding, { now: () => new Date("2026-10-07T10:00:00Z") });
    db.jobs.clear();
    const runScan = vi.fn(async (opts: { businessId: string }) => {
      const run = await db.createScanRun({ businessId: opts.businessId, kind: "recheck", engines: ["chatgpt"], samplesPerPrompt: 10, status: "done" });
      return report(db, opts.businessId, [{ ...finding, status: "fixing" }], run.id);
    });
    const out = await runRecheck(opened.fix.id, { runScan, now: () => new Date("2026-10-22T10:00:00Z") });
    expect(out.result).toBe("still_wrong");
    expect(out.step).toBe("followup_email_14");
    expect((await db.getFinding(finding.id))!.status).toBe("recheck");
    const mail = [...db.jobs.values()].find((j) => j.kind === "email")!;
    expect(mail.payload.kind).toBe("correction_followup");
    expect(String(mail.payload.subject)).toContain("Herinnering");
    expect(out.nextRecheckAt).toBe(addDays("2026-10-22T10:00:00Z", 30).toISOString());
  });

  it("still wrong after the window → unfixable with honest note", async () => {
    const { finding } = await seed(db, "none", { sourceUrl: null });
    const opened = await openFixForFinding(finding, { now: () => new Date("2026-10-07T10:00:00Z") });
    db.jobs.clear();
    const runScan = vi.fn(async (opts: { businessId: string }) => {
      const run = await db.createScanRun({ businessId: opts.businessId, kind: "recheck", engines: ["chatgpt"], samplesPerPrompt: 10, status: "done" });
      return report(db, opts.businessId, [{ ...finding, status: "fixing" }], run.id);
    });
    // The seed stamps firstSeenAt with the real clock, so "after the window"
    // is counted from that, not from a fixed date (a fixed 2026-12-01 started
    // failing on 18 Oct 2026, once the gap fell under the window).
    const later = addDays(finding.firstSeenAt, 120);
    const out = await runRecheck(opened.fix.id, { runScan, now: () => later });
    expect(out.result).toBe("unfixable");
    expect((await db.getFinding(finding.id))!.status).toBe("unfixable");
    const mail = [...db.jobs.values()].find((j) => j.kind === "email")!;
    expect(mail.payload.template).toBe("unfixable");
    expect(String(mail.payload.note)).toContain("geheugen van het model");
  });

  it("not_found: still not found at day 30 → resync, follow-up recheck at day 45, unfixable only after 60", async () => {
    const { finding } = await seed(db, "none", { sourceUrl: null, verdict: "not_found", wrongValue: "niet gevonden", frequency: 8 });
    const opened = await openFixForFinding(finding, { now: () => new Date("2026-10-07T10:00:00Z") });
    db.jobs.clear();
    const runScan = vi.fn(async (opts: { businessId: string }) => {
      const run = await db.createScanRun({ businessId: opts.businessId, kind: "recheck", engines: ["chatgpt"], samplesPerPrompt: 10, status: "done" });
      return report(db, opts.businessId, [{ ...finding, status: "fixing" }], run.id);
    });
    const firstSeen = (await db.getFinding(finding.id))!.firstSeenAt;

    const day30 = await runRecheck(opened.fix.id, { runScan, now: () => addDays(firstSeen, 30) });
    expect(day30.result).toBe("still_wrong");
    expect(day30.step).toBe("resync");
    expect(day30.nextRecheckAt).toBe(addDays(firstSeen, 45).toISOString());
    expect((await db.getFinding(finding.id))!.status).toBe("recheck");

    const day46 = await runRecheck(opened.fix.id, { runScan, now: () => addDays(firstSeen, 46) });
    expect(day46.result).toBe("still_wrong");
    expect(day46.nextRecheckAt).toBe(addDays(addDays(firstSeen, 46), 21).toISOString());
    expect([...db.jobs.values()].some((j) => j.kind === "email" && j.payload.template === "unfixable")).toBe(false);
    expect((await db.getFinding(finding.id))!.status).toBe("recheck");

    const day61 = await runRecheck(opened.fix.id, { runScan, now: () => addDays(firstSeen, 61) });
    expect(day61.result).toBe("unfixable");
    const mail = [...db.jobs.values()].find((j) => j.kind === "email" && j.payload.template === "unfixable")!;
    expect(mail).toBeDefined();
    expect(String(mail.payload.note)).toContain("60 dagen");
  });

  it("not_found resolves when the recheck no longer lists it, even if a wrong finding for the same key appears", async () => {
    const { finding } = await seed(db, "none", { sourceUrl: null, verdict: "not_found", wrongValue: "niet gevonden", frequency: 8 });
    const opened = await openFixForFinding(finding);
    const runScan = vi.fn(async (opts: { businessId: string }) => {
      const run = await db.createScanRun({ businessId: opts.businessId, kind: "recheck", engines: ["chatgpt"], samplesPerPrompt: 10, status: "done" });
      return report(db, opts.businessId, [{ ...finding, id: "other", verdict: "wrong", wrongValue: "10:00-14:00", status: "open" }], run.id);
    });
    const out = await runRecheck(opened.fix.id, { runScan });
    expect(out.result).toBe("resolved");
  });

  it("stillPresent matches by id or by engine+fact+subject", () => {
    const f = { id: "a", engine: "chatgpt", factKey: "hours", subject: "6" } as Finding;
    const r = (findings: Partial<Finding>[]) => ({ findings } as unknown as ScanReport);
    expect(stillPresent(f, r([{ id: "a" }]))).toBe(true);
    expect(stillPresent(f, r([{ id: "b", engine: "chatgpt", factKey: "hours", subject: "6", status: "open" }]))).toBe(true);
    expect(stillPresent(f, r([{ id: "b", engine: "gemini", factKey: "hours", subject: "6", status: "open" }]))).toBe(false);
    expect(stillPresent(f, r([]))).toBe(false);
  });
});
