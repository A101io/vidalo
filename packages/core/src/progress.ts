/**
 * Progress over time: what the owner's dashboard shows under "Voortgang".
 *
 * A scan is summarised per (question, AI system): the answer that came back
 * most often decides whether that cell was correct, wrong or not found. That
 * unit stays comparable between a free scan (3 samples per question) and a
 * monthly scan (10 samples), where raw sample counts would not.
 *
 * Rules from docs/CRITERIA.md hold here too: never a score or a percentage,
 * only counts and the colour of the dot; recommendation questions are judged
 * on one thing, named or not, never on position. Pure, so tests and the web
 * share it.
 */
import type { CriteriumId, Engine, EngineStip, Finding, Prompt, PromptKind, Sample, ScanKind, Severity, Stip } from "./types";
import { VISIBILITY_PARTIAL_RATIO, VISIBILITY_UNKNOWN_RATIO } from "./types";
import { FACT_KEY_CRITERIUM, severityOf } from "./criteria";

export type CellVerdict = "correct" | "wrong" | "not_found";

/** One question asked of one AI system in one scan. */
export interface ProgressCell {
  promptId: string;
  engine: Engine;
  criterium: CriteriumId;
  kind: PromptKind;
  verdict: CellVerdict;
}

export interface ScanSnapshot {
  scanRunId: string;
  kind: ScanKind;
  checkedAt: string;
  engines: Engine[];
  /** The colour of the dot by the stipregel, as the report shows it. */
  stip: Stip;
  engineStips: EngineStip[];
  cells: ProgressCell[];
}

/** Scan kinds that ask the full question set. A recheck asks only the questions under repair, so it is left out. */
export const PROGRESS_SCAN_KINDS: ScanKind[] = ["free", "baseline", "monthly", "ondemand"];

/** Indicator bundles the owner can filter on. "recommendation" = the questions where AI recommends a business. */
export type Bundle = "all" | Severity | "recommendation";
export const BUNDLES: Bundle[] = ["all", "afhaker", "misleider", "verwarring", "recommendation"];

export type Period = "3m" | "6m" | "12m" | "all";
export const PERIODS: Period[] = ["3m", "6m", "12m", "all"];

export interface ProgressFilter {
  engine: Engine | "all";
  bundle: Bundle;
}

type SampleVerdictLike = "correct" | "wrong" | "unknown" | "other_entity" | "not_found" | "named" | "not_named";

/**
 * Per (prompt, engine): the verdict most samples carried. A tie leans to the
 * worse verdict (wrong, then not found), so a coin-flip answer never reads as fixed.
 * Samples without a verdict ("unknown": the answer said nothing checkable) do not vote.
 */
export function cellsFromSamples(samples: Pick<Sample, "id" | "promptId" | "engine">[], verdicts: Map<string, SampleVerdictLike>, prompts: Pick<Prompt, "id" | "category" | "criterium" | "kind">[]): ProgressCell[] {
  const promptById = new Map(prompts.map((p) => [p.id, p]));
  const groups = new Map<string, { promptId: string; engine: Engine; votes: Record<CellVerdict, number> }>();
  for (const s of samples) {
    const v = verdicts.get(s.id);
    if (!v || v === "unknown" || !promptById.has(s.promptId)) continue;
    // A recommendation cell keeps named / not named as correct / wrong; its kind keeps it out of the fact bundles.
    const verdict: CellVerdict = v === "other_entity" || v === "not_named" ? "wrong" : v === "named" ? "correct" : v;
    const key = `${s.promptId}|${s.engine}`;
    const g = groups.get(key) ?? { promptId: s.promptId, engine: s.engine, votes: { correct: 0, wrong: 0, not_found: 0 } };
    g.votes[verdict]++;
    groups.set(key, g);
  }
  const cells: ProgressCell[] = [];
  for (const g of groups.values()) {
    const p = promptById.get(g.promptId)!;
    const { correct, wrong, not_found } = g.votes;
    const verdict: CellVerdict = wrong >= correct && wrong >= not_found ? "wrong" : not_found >= correct ? "not_found" : "correct";
    cells.push({ promptId: g.promptId, engine: g.engine, criterium: p.criterium ?? FACT_KEY_CRITERIUM[p.category], kind: p.kind ?? "about", verdict });
  }
  return cells;
}

export function filterCells(cells: ProgressCell[], filter: ProgressFilter): ProgressCell[] {
  return cells.filter((c) => {
    if (filter.engine !== "all" && c.engine !== filter.engine) return false;
    // "Alles" is every fact question; being named in a recommendation is its own bundle, never a wrong fact.
    if (filter.bundle === "all") return c.kind !== "recommendation";
    if (filter.bundle === "recommendation") return c.kind === "recommendation";
    return c.kind === "about" && severityOf(c.criterium) === filter.bundle;
  });
}

export interface Tally {
  correct: number;
  wrong: number;
  notFound: number;
  total: number;
}

export function tally(cells: ProgressCell[]): Tally {
  const t: Tally = { correct: 0, wrong: 0, notFound: 0, total: cells.length };
  for (const c of cells) {
    if (c.verdict === "correct") t.correct++;
    else if (c.verdict === "wrong") t.wrong++;
    else t.notFound++;
  }
  return t;
}

/**
 * The colour of a set of cells, by the same steps as the stipregel per engine:
 * grey when most say not found, red on a wrong answer about an afhaker fact or
 * a missed recommendation tied to one, orange on any other wrong answer or
 * when a quarter or more is not found, green otherwise. Null when nothing was asked.
 */
export function cellStip(cells: ProgressCell[]): Stip | null {
  if (cells.length === 0) return null;
  const t = tally(cells);
  if (t.notFound / t.total >= VISIBILITY_UNKNOWN_RATIO) return "grijs";
  if (cells.some((c) => c.verdict === "wrong" && severityOf(c.criterium) === "afhaker")) return "rood";
  if (t.wrong > 0) return "oranje";
  if (t.notFound / t.total >= VISIBILITY_PARTIAL_RATIO) return "oranje";
  return "groen";
}

/** The dot for one scan under a filter: the report's own colour where the filter matches what the report judged, else the cells' colour. */
export function snapshotStip(s: ScanSnapshot, filter: ProgressFilter): Stip | null {
  if (filter.bundle === "all") {
    if (filter.engine === "all") return s.stip;
    const e = s.engineStips.find((x) => x.engine === filter.engine);
    if (e) return e.stip;
  }
  return cellStip(filterCells(s.cells, filter));
}

export function periodStart(period: Period, now: Date = new Date()): Date | null {
  if (period === "all") return null;
  const months = { "3m": 3, "6m": 6, "12m": 12 }[period];
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d;
}

/** Snapshots in the period, oldest first. */
export function inPeriod(snaps: ScanSnapshot[], period: Period, now: Date = new Date()): ScanSnapshot[] {
  const from = periodStart(period, now);
  return snaps.filter((s) => !from || new Date(s.checkedAt) >= from).sort((a, b) => a.checkedAt.localeCompare(b.checkedAt));
}

export interface Change {
  /** The scan the latest one is compared with. */
  base: ScanSnapshot;
  first: Tally;
  last: Tally;
  /** last minus base, per count (positive correct = better; positive wrong = worse). */
  correct: number;
  wrong: number;
  notFound: number;
}

/** Share of the latest scan's questions an earlier scan must also have asked to be compared with it. */
export const COMPARABLE_OVERLAP = 0.9;

const cellKey = (c: ProgressCell) => `${c.promptId}|${c.engine}`;

/**
 * The earliest scan in the list that asked (nearly) the same questions of the
 * same AI systems as the latest one, under the filter. A free check asks three
 * systems a handful of questions; comparing a full check with it would count
 * new questions as improvement. Null when no earlier scan qualifies.
 */
export function comparableBase(snaps: ScanSnapshot[], filter: ProgressFilter): ScanSnapshot | null {
  if (snaps.length < 2) return null;
  const latest = snaps[snaps.length - 1]!;
  const want = new Set(filterCells(latest.cells, filter).map(cellKey));
  if (want.size === 0) return null;
  for (const s of snaps.slice(0, -1)) {
    const have = new Set(filterCells(s.cells, filter).map(cellKey));
    let shared = 0;
    for (const k of want) if (have.has(k)) shared++;
    if (shared >= want.size * COMPARABLE_OVERLAP) return s;
  }
  return null;
}

/** The latest scan against its comparable base, on the same filter. Null when there is nothing to compare with. */
export function changeOver(snaps: ScanSnapshot[], filter: ProgressFilter): Change | null {
  const base = comparableBase(snaps, filter);
  if (!base) return null;
  const first = tally(filterCells(base.cells, filter));
  const last = tally(filterCells(snaps[snaps.length - 1]!.cells, filter));
  return { base, first, last, correct: last.correct - first.correct, wrong: last.wrong - first.wrong, notFound: last.notFound - first.notFound };
}

/** One dot in a grid: its colour (null = not asked) and how many answers under it were not right (wrong or not found). */
export interface GridCell {
  stip: Stip | null;
  misses: number;
}

const gridCell = (cells: ProgressCell[], stip: Stip | null = cellStip(cells)): GridCell => ({ stip, misses: cells.filter((c) => c.verdict !== "correct").length });

/** Per criterium, per scan. Only criteria asked at least once. */
export function criteriumGrid(snaps: ScanSnapshot[], filter: ProgressFilter): { criterium: CriteriumId; cells: GridCell[] }[] {
  const ids = new Set<CriteriumId>();
  const perSnap = snaps.map((s) => filterCells(s.cells, filter));
  for (const cells of perSnap) for (const c of cells) ids.add(c.criterium);
  return [...ids].sort((a, b) => a - b).map((criterium) => ({ criterium, cells: perSnap.map((cells) => gridCell(cells.filter((c) => c.criterium === criterium))) }));
}

/** Per engine, per scan; the colour is the report's own where the bundle allows it. */
export function engineGrid(snaps: ScanSnapshot[], bundle: Bundle): { engine: Engine; cells: GridCell[] }[] {
  const engines = new Set<Engine>();
  for (const s of snaps) for (const e of s.engines) engines.add(e);
  return [...engines].map((engine) => ({
    engine,
    cells: snaps.map((s) => {
      if (!s.engines.includes(engine)) return { stip: null, misses: 0 };
      const filter = { engine, bundle };
      return gridCell(filterCells(s.cells, filter), snapshotStip(s, filter));
    }),
  }));
}

// ---------------------------------------------------------------------------
// Repairs: from the findings' own dates, which stay put when a later scan
// updates the row (a scan run id does not).
// ---------------------------------------------------------------------------

export interface RepairSummary {
  /** findings first seen in the period */
  found: number;
  /** findings resolved in the period */
  resolved: number;
  /** open now (not resolved, not unfixable) */
  open: number;
  /** being repaired now (fixing / recheck) */
  inProgress: number;
  /** median days from first seen to resolved, over findings resolved in the period; null when none */
  medianDays: number | null;
}

function findingMatches(f: Pick<Finding, "engine" | "criterium" | "factKey" | "evidenceKind">, filter: ProgressFilter): boolean {
  if (filter.engine !== "all" && f.engine !== filter.engine) return false;
  if (filter.bundle === "all") return true;
  const kind = f.evidenceKind ?? "about";
  if (filter.bundle === "recommendation") return kind === "recommendation";
  return kind === "about" && severityOf(f.criterium ?? FACT_KEY_CRITERIUM[f.factKey]) === filter.bundle;
}

export function repairSummary(findings: Finding[], period: Period, filter: ProgressFilter, now: Date = new Date()): RepairSummary {
  const from = periodStart(period, now);
  const inP = (iso: string | null) => Boolean(iso) && (!from || new Date(iso!) >= from);
  const mine = findings.filter((f) => findingMatches(f, filter));
  const resolvedInP = mine.filter((f) => f.status === "resolved" && inP(f.resolvedAt));
  const days = resolvedInP.map((f) => (new Date(f.resolvedAt!).getTime() - new Date(f.firstSeenAt).getTime()) / 86_400_000).sort((a, b) => a - b);
  const mid = days.length ? (days.length % 2 ? days[(days.length - 1) / 2]! : (days[days.length / 2 - 1]! + days[days.length / 2]!) / 2) : null;
  return {
    found: mine.filter((f) => inP(f.firstSeenAt)).length,
    resolved: resolvedInP.length,
    open: mine.filter((f) => f.status === "open").length,
    inProgress: mine.filter((f) => f.status === "fixing" || f.status === "recheck").length,
    medianDays: mid === null ? null : Math.max(0, Math.round(mid)),
  };
}
