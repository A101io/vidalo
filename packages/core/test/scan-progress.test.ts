import { describe, expect, it } from "vitest";
import { withMockDb } from "../src/db";
import { prepareBusiness } from "../src/scanner/onboard";
import { createMockEngine } from "../src/scanner/engines";
import { persistScanState, readScanState, runScanWithProgress, scanStatusBody, type ScanJobState, type ScanStage } from "../src/scanner/progress";
import { runScan } from "../src/scanner";

const ORDER: ScanStage[] = ["understand", "choose", "ask", "compare", "done"];

const freshState = (businessId: string): ScanJobState => ({ token: `${businessId}_abc123abc123`, businessId, scanRunId: null, status: "queued", stage: "understand", profile: null, questions: [], engines: [], error: null });

/** Run a scan and keep a deep copy of every state that was stored. */
async function run(kind: "free" | "monthly", engines: ("chatgpt" | "google_ai")[], clients?: Parameters<typeof runScanWithProgress>[1]["clients"]) {
  const db = withMockDb();
  const { business } = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
  const state = freshState(business.id);
  const stored: ScanJobState[] = [];
  const report = await runScanWithProgress(state, { kind, engines, clients, db, persist: async (s) => void stored.push(structuredClone(s)) });
  return { db, state, stored, report: report! };
}

describe("waiting-room state follows the scan's real steps", () => {
  it("passes understand/choose, ask, compare, done in order and never backwards", async () => {
    const { stored, state } = await run("free", ["chatgpt", "google_ai"]);
    const stages = stored.map((s) => ORDER.indexOf(s.stage));
    for (let i = 1; i < stages.length; i++) expect(stages[i]!, `state ${i}`).toBeGreaterThanOrEqual(stages[i - 1]!);
    const seen = new Set(stored.map((s) => s.stage));
    for (const st of ["choose", "ask", "compare", "done"] as ScanStage[]) expect(seen.has(st), st).toBe(true);
    expect(state.stage).toBe("done");
    expect(stored.at(-1)).toMatchObject({ status: "done", stage: "done" });
    // Only the last stored state is done; a done stage never sits next to a running status.
    expect(stored.filter((s) => s.stage === "done").every((s) => s.status === "done")).toBe(true);
  });

  it("the profile arrives at choose and the questions equal the asked prompts, in order", async () => {
    const { stored, db, report } = await run("free", ["chatgpt"]);
    const choose = stored.find((s) => s.stage === "choose" && s.questions.length)!;
    expect(choose.profile).toMatchObject({ mode: "door", source: "auto" });
    const final = stored.at(-1)!;
    expect(final.questions.length).toBeGreaterThan(0);
    const samples = await db.listSamples(report.scanRunId);
    const asked = new Set(samples.map((s) => s.promptId));
    expect(new Set(final.questions.map((q) => q.id))).toEqual(asked);
    const prompts = await db.listPrompts(final.questions.length ? stored[0]!.businessId : "");
    for (const q of final.questions) expect(prompts.find((p) => p.id === q.id)!.textNl).toBe(q.text);
  });

  it("per engine, received ends equal to expected and to the samples stored", async () => {
    const { state, db, report } = await run("free", ["chatgpt", "google_ai"]);
    const samples = await db.listSamples(report.scanRunId);
    expect(state.engines.map((e) => e.engine).sort()).toEqual(["chatgpt", "google_ai"]);
    for (const e of state.engines) {
      expect(e.expected).toBeGreaterThan(0);
      expect(e.received).toBe(e.expected);
      expect(samples.filter((s) => s.engine === e.engine).length).toBe(e.received);
    }
    // google_ai is capped at one sample per question, chatgpt asks more: counts come from the plan, not a constant.
    const by = Object.fromEntries(state.engines.map((e) => [e.engine, e.expected]));
    expect(by.chatgpt!).toBeGreaterThan(by.google_ai!);
  });

  it("counters in stored states never run ahead of expected and only grow", async () => {
    const { stored } = await run("free", ["chatgpt", "google_ai"]);
    for (const s of stored) for (const e of s.engines) expect(e.received).toBeLessThanOrEqual(e.expected);
    const sumAt = (s: ScanJobState) => s.engines.reduce((n, e) => n + e.received, 0);
    for (let i = 1; i < stored.length; i++) expect(sumAt(stored[i]!)).toBeGreaterThanOrEqual(sumAt(stored[i - 1]!));
  });

  it("an escalated cell grows expected, and received still ends equal", async () => {
    const messy = createMockEngine("chatgpt", { wrongPairRate: 1 });
    const { stored, state, db, report } = await run("monthly", ["chatgpt"], [messy]);
    const firstAsk = stored.find((s) => s.stage === "ask" && s.engines.length)!;
    const firstExpected = firstAsk.engines[0]!.expected;
    const e = state.engines[0]!;
    expect(e.expected).toBeGreaterThan(firstExpected);
    expect(e.received).toBe(e.expected);
    expect((await db.listSamples(report.scanRunId)).length).toBe(e.received);
  });

  it("a failed scan stores the error but is a failed state, not a done one", async () => {
    const db = withMockDb();
    const state = freshState("no-such-business");
    const stored: ScanJobState[] = [];
    await runScanWithProgress(state, { kind: "free", engines: ["chatgpt"], db, persist: async (s) => void stored.push(structuredClone(s)) });
    expect(stored.at(-1)).toMatchObject({ status: "failed", stage: "understand" });
    expect(stored.at(-1)!.error).toBeTruthy();
  });
});

describe("runScan emits the typed events in order", () => {
  it("profile, questions, start (with per-engine counts), asked, phases", async () => {
    const db = withMockDb();
    const { business } = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
    const types: string[] = [];
    let start: { perEngine: Record<string, number>; total: number } | null = null;
    await runScan({ businessId: business.id, kind: "free", engines: ["chatgpt"], db, onProgress: (ev) => { types.push(ev.type); if (ev.type === "start") start = ev; } });
    expect(types.slice(0, 3)).toEqual(["profile", "questions", "start"]);
    expect(types.indexOf("asked")).toBeGreaterThan(2);
    expect(start!.perEngine.chatgpt).toBe(start!.total);
  });

  it("reports the profile it is passed for a recheck, which skips the understanding step", async () => {
    const db = withMockDb();
    const { business } = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
    const profile = { mode: "online" as const, offer: "brood", audience: "buren", category: "bakker", source: "auto" as const };
    let got: unknown = null;
    await runScan({ businessId: business.id, kind: "recheck", engines: ["chatgpt"], db, profile, onProgress: (ev) => { if (ev.type === "profile") got = ev.profile; } });
    expect(got).toEqual(profile);
  });
});

describe("status body", () => {
  const base: ScanJobState = { token: "b1_aaaaaaaaaaaa", businessId: "b1", scanRunId: "run1", status: "running", stage: "ask", profile: null, questions: [{ id: "p1", text: "Bestaat X nog?" }], engines: [{ engine: "chatgpt", received: 1, expected: 5 }], error: "boom: secret stack" };

  it("has exactly the contract's keys; never error, steps, token, businessId or scanRunId while running", () => {
    const body = scanStatusBody(base);
    expect(Object.keys(body).sort()).toEqual(["engines", "profile", "questions", "reportUrl", "stage", "status"]);
    expect(JSON.stringify(body)).not.toMatch(/boom|secret|b1|run1/);
    expect(body.reportUrl).toBeNull();
  });

  it("a failed scan does not leak its error either", () => {
    const body = scanStatusBody({ ...base, status: "failed" });
    expect(JSON.stringify(body)).not.toContain("boom");
    expect(body.reportUrl).toBeNull();
  });

  it("done gives the report path", () => {
    expect(scanStatusBody({ ...base, status: "done", stage: "done" }).reportUrl).toBe("/r/run1");
  });

  it("a state stored before this feature reads as ask with empty lists", async () => {
    const db = withMockDb();
    const { business } = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
    const token = `${business.id}_oldoldoldold`;
    await db.logEvent(business.id, "scan.progress", { token, scanRunId: null, status: "running", steps: [{ key: "found", label: "Gevonden", done: true }], error: null });
    const state = (await readScanState(token, db))!;
    expect(scanStatusBody(state)).toEqual({ status: "running", stage: "ask", profile: null, questions: [], engines: [], reportUrl: null });
  });

  it("the stored state round-trips through the event", async () => {
    const db = withMockDb();
    const { business } = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
    const s = { ...base, businessId: business.id, token: `${business.id}_aaaaaaaaaaaa` };
    await persistScanState(s, db);
    expect(await readScanState(s.token, db)).toMatchObject({ stage: "ask", questions: s.questions, engines: s.engines });
    expect(await readScanState(`${business.id}_zzzzzzzzzzzz`, db)).toBeNull();
  });
});
