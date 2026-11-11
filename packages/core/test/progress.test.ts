import { describe, expect, it } from "vitest";
import type { Finding, Prompt } from "../src/types";
import { cellStip, cellsFromSamples, changeOver, criteriumGrid, filterCells, inPeriod, repairSummary, snapshotStip, tally, type ProgressCell, type ScanSnapshot } from "../src/progress";

const prompts: Pick<Prompt, "id" | "category" | "criterium" | "kind">[] = [
  { id: "p-hours", category: "hours", criterium: 3, kind: "about" },
  { id: "p-price", category: "price", criterium: 9, kind: "about" },
  { id: "p-rec", category: "hours", criterium: 3, kind: "recommendation" },
];

const s = (id: string, promptId: string, engine: "chatgpt" | "gemini" = "chatgpt") => ({ id, promptId, engine });

describe("cellsFromSamples", () => {
  it("takes the verdict most samples carried, per question and AI system", () => {
    const samples = [s("1", "p-hours"), s("2", "p-hours"), s("3", "p-hours"), s("4", "p-price"), s("5", "p-price")];
    const verdicts = new Map([
      ["1", "correct"],
      ["2", "correct"],
      ["3", "wrong"],
      ["4", "not_found"],
      ["5", "unknown"],
    ] as const);
    const cells = cellsFromSamples(samples, new Map(verdicts), prompts);
    expect(cells).toHaveLength(2);
    expect(cells.find((c) => c.promptId === "p-hours")!.verdict).toBe("correct");
    expect(cells.find((c) => c.promptId === "p-price")!.verdict).toBe("not_found");
  });

  it("leans to the worse verdict on a tie, and counts another business as wrong", () => {
    const samples = [s("1", "p-hours"), s("2", "p-hours"), s("3", "p-price")];
    const verdicts = new Map<string, "correct" | "wrong" | "other_entity">([
      ["1", "correct"],
      ["2", "wrong"],
      ["3", "other_entity"],
    ]);
    const cells = cellsFromSamples(samples, verdicts, prompts);
    expect(cells.map((c) => c.verdict)).toEqual(["wrong", "wrong"]);
  });

  it("drops samples whose question is no longer known, and samples without a vote", () => {
    const cells = cellsFromSamples([s("1", "gone"), s("2", "p-hours")], new Map([["1", "correct"], ["2", "unknown"]] as const), prompts);
    expect(cells).toEqual([]);
  });
});

const cell = (verdict: ProgressCell["verdict"], criterium: ProgressCell["criterium"] = 9, kind: ProgressCell["kind"] = "about", engine: ProgressCell["engine"] = "chatgpt"): ProgressCell => ({ promptId: `${criterium}-${kind}`, engine, criterium, kind, verdict });

describe("filters and colour", () => {
  const cells = [cell("correct", 3), cell("wrong", 9), cell("not_found", 11), cell("wrong", 3, "recommendation"), cell("correct", 9, "about", "gemini")];

  it("bundles by severity, keeps recommendation questions apart, and filters on engine", () => {
    expect(filterCells(cells, { engine: "all", bundle: "afhaker" })).toHaveLength(1);
    expect(filterCells(cells, { engine: "all", bundle: "misleider" })).toHaveLength(2);
    expect(filterCells(cells, { engine: "all", bundle: "verwarring" })).toHaveLength(1);
    expect(filterCells(cells, { engine: "all", bundle: "recommendation" })).toHaveLength(1);
    expect(filterCells(cells, { engine: "gemini", bundle: "all" })).toHaveLength(1);
  });

  it("counts, never a share", () => {
    expect(tally(cells)).toEqual({ correct: 2, wrong: 2, notFound: 1, total: 5 });
  });

  it("follows the stipregel steps", () => {
    expect(cellStip([])).toBeNull();
    expect(cellStip([cell("correct"), cell("correct")])).toBe("groen");
    expect(cellStip([cell("correct"), cell("wrong", 9)])).toBe("oranje");
    expect(cellStip([cell("correct"), cell("wrong", 2)])).toBe("rood");
    expect(cellStip([cell("not_found"), cell("not_found"), cell("correct")])).toBe("grijs");
    expect(cellStip([cell("not_found"), cell("correct"), cell("correct")])).toBe("oranje");
  });
});

const snap = (checkedAt: string, cells: ProgressCell[], stip: ScanSnapshot["stip"] = "rood"): ScanSnapshot => ({
  scanRunId: checkedAt,
  kind: "monthly",
  checkedAt,
  engines: ["chatgpt"],
  stip,
  engineStips: [{ engine: "chatgpt", stip, usage: 0.83, counts: true }],
  cells,
});

describe("over time", () => {
  const now = new Date("2026-10-15T00:00:00Z");
  const snaps = [snap("2026-09-07T00:00:00Z", [cell("correct", 3), cell("correct", 9)], "groen"), snap("2026-03-07T00:00:00Z", [cell("wrong", 3), cell("wrong", 9)]), snap("2026-06-07T00:00:00Z", [cell("correct", 3), cell("wrong", 9)], "oranje")];

  it("keeps the period, oldest first", () => {
    expect(inPeriod(snaps, "3m", now).map((x) => x.checkedAt)).toEqual(["2026-09-07T00:00:00Z"]);
    expect(inPeriod(snaps, "all", now).map((x) => x.checkedAt.slice(0, 7))).toEqual(["2026-03", "2026-06", "2026-09"]);
  });

  it("compares the first and the last scan on the same filter", () => {
    const c = changeOver(inPeriod(snaps, "all", now), { engine: "all", bundle: "all" })!;
    expect(c.base.checkedAt.slice(0, 7)).toBe("2026-03");
    expect(c.first.correct).toBe(0);
    expect(c.last.correct).toBe(2);
    expect(c.correct).toBe(2);
    expect(c.wrong).toBe(-2);
  });

  it("skips an earlier scan that asked other questions or fewer AI systems", () => {
    const small = snap("2026-01-07T00:00:00Z", [cell("wrong", 3)]);
    const full = [cell("wrong", 3), cell("wrong", 9), cell("correct", 3, "about", "gemini")];
    const later = [cell("correct", 3), cell("correct", 9), cell("correct", 3, "about", "gemini")];
    const list = [small, snap("2026-04-07T00:00:00Z", full), snap("2026-09-07T00:00:00Z", later)];
    const c = changeOver(list, { engine: "all", bundle: "all" })!;
    expect(c.base.checkedAt.slice(0, 7)).toBe("2026-04");
    expect(c.correct).toBe(2);
    expect(changeOver([small], { engine: "all", bundle: "all" })).toBeNull();
    expect(changeOver([snap("2026-01-07T00:00:00Z", [cell("wrong", 12)]), snap("2026-09-07T00:00:00Z", later)], { engine: "all", bundle: "all" })).toBeNull();
  });

  it("gives every fact a dot per scan", () => {
    const grid = criteriumGrid(inPeriod(snaps, "all", now), { engine: "all", bundle: "all" });
    expect(grid.map((r) => [r.criterium, r.cells.map((c) => c.stip)])).toEqual([
      [3, ["rood", "groen", "groen"]],
      [9, ["oranje", "oranje", "groen"]],
    ]);
    expect(grid[1]!.cells.map((c) => c.misses)).toEqual([1, 1, 0]);
  });

  it("uses the report's own colour when nothing is filtered away", () => {
    const x = snap("2026-09-07T00:00:00Z", [cell("correct")], "oranje");
    expect(snapshotStip(x, { engine: "all", bundle: "all" })).toBe("oranje");
    expect(snapshotStip(x, { engine: "chatgpt", bundle: "all" })).toBe("oranje");
    expect(snapshotStip(x, { engine: "all", bundle: "misleider" })).toBe("groen");
  });
});

describe("repairSummary", () => {
  const f = (over: Partial<Finding>): Finding => ({
    id: Math.random().toString(36),
    businessId: "b",
    scanRunId: "r",
    factKey: "hours",
    subject: null,
    engine: "chatgpt",
    verdict: "wrong",
    wrongValue: "x",
    correctValue: "y",
    frequency: 3,
    sampleCount: 10,
    sourceUrl: null,
    sourceType: "third_party",
    status: "open",
    firstSeenAt: "2026-09-01T00:00:00Z",
    resolvedAt: null,
    evidenceBefore: null,
    evidenceAfter: null,
    criterium: 3,
    ...over,
  });
  const now = new Date("2026-10-15T00:00:00Z");
  const findings = [
    f({ status: "resolved", firstSeenAt: "2026-08-01T00:00:00Z", resolvedAt: "2026-08-11T00:00:00Z" }),
    f({ status: "resolved", firstSeenAt: "2026-09-01T00:00:00Z", resolvedAt: "2026-09-21T00:00:00Z" }),
    f({ status: "fixing" }),
    f({ status: "open", factKey: "price", criterium: 9 }),
    f({ status: "resolved", firstSeenAt: "2025-01-01T00:00:00Z", resolvedAt: "2025-02-01T00:00:00Z" }),
  ];

  it("counts found, resolved, open and in repair, with the median repair time", () => {
    expect(repairSummary(findings, "6m", { engine: "all", bundle: "all" }, now)).toEqual({ found: 4, resolved: 2, open: 1, inProgress: 1, medianDays: 15 });
  });

  it("follows the bundle filter", () => {
    expect(repairSummary(findings, "all", { engine: "all", bundle: "misleider" }, now)).toEqual({ found: 1, resolved: 0, open: 1, inProgress: 0, medianDays: null });
  });
});

describe("buildSnapshot (mock pipeline)", () => {
  it("summarises a stored scan per question and AI system, and an all-correct scan reads green", async () => {
    const { withMockDb } = await import("../src/db");
    const { buildSnapshot, runScan, createMockEngine } = await import("../src/scanner");
    const { prepareBusiness } = await import("../src/scanner/onboard");
    const db = withMockDb();
    const { business } = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
    const { storeDoorPrompts } = await import("./scanner-fixtures");
    const prompts = await storeDoorPrompts(db, business);
    const engines = ["chatgpt", "google_ai"] as const;

    const messy = await runScan({ businessId: business.id, kind: "monthly", engines: [...engines], samplesPerPrompt: 3, db });
    const before = (await buildSnapshot(messy.scanRunId, db))!;
    expect(before.cells.length).toBeLessThanOrEqual(prompts.length * engines.length);
    expect(before.cells.length).toBeGreaterThan(prompts.length);
    expect(tally(before.cells).wrong).toBeGreaterThan(0);
    expect(before.stip).toBe(messy.stip);

    const clean = await runScan({ businessId: business.id, kind: "monthly", engines: [...engines], samplesPerPrompt: 3, clients: engines.map((e) => createMockEngine(e, { wrongPairRate: 0, otherEntityRate: 0 })), db });
    const after = (await buildSnapshot(clean.scanRunId, db))!;
    expect(tally(after.cells).wrong).toBe(0);
    expect(changeOver([before, after], { engine: "all", bundle: "all" })!.wrong).toBeLessThan(0);
  });
});
