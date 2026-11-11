/**
 * From a ScanReport to what the result page shows (docs/DESIGN_G.md "Result"):
 * one row per question, three answer cards, source rows, the plan steps and
 * the hero numbers. Three states by colour: red/orange, green, grey.
 * Never a score: only counts.
 */
import type { Engine, Finding, ScanReport, Severity, Stip } from "@vidalo/core/types";
import { ENGINE_LABEL } from "@vidalo/core/types";
import type { CopyShape } from "@vidalo/core/copy";
import { findingSeverity } from "@vidalo/core/scanner";
import type { ReportRowData } from "@/components/ReportRow";
import type { SourceStatusTone } from "@/components/SourceRow";
import { questionFor, recommendationQuestionFor, wrongText, correctText, humanValue } from "./questions";
import { competitionCountsOf, isNeutralProfile, isUncheckedGrey } from "@vidalo/core/types";
import { checkedAsParts } from "@vidalo/core/shared";
import { hostOf } from "./format";

export type ReportState = "rood" | "groen" | "grijs";

export interface AnswerCardData {
  question: string;
  engine: string;
  before?: string;
  highlight: string;
  highlightTone: "rood" | "grijs" | "bold";
  after?: string;
  caption: string;
}

export interface SourceRowData {
  label: string;
  status: string;
  tone: SourceStatusTone;
  href?: string | null;
}

/** One recommendation question where the business was left out: who AI named instead and where it got that. */
export interface NamedBlock {
  question: string;
  you: string;
  others: { name: string; times: string }[];
  sources: { host: string; href: string; times: string }[];
}

/** The competition block of an online business: per question, counts only. */
export interface CompetitionView {
  /** "Genoemd in 4 van 30 antwoorden", over every category and alternative question. */
  summary: string;
  questions: { question: string; you: string; others: { name: string; times: string }[]; quotes: { text: string; engine: string }[] }[];
  note: string;
}

export interface PlanStep {
  tone: Stip;
  text: string;
}

export interface ReportView {
  state: ReportState;
  stip: Stip;
  questions: number;
  perQuestion: number;
  wrongQuestions: number;
  notFoundQuestions: number;
  hero: { number: number; label: readonly string[] };
  h1: string;
  intro: string;
  engineLines: { name: string; text: string }[];
  cards: AnswerCardData[];
  rows: ReportRowData[];
  /** Every answer, for the "Alle n antwoorden" list: question → engine → value. */
  all: { question: string; engine: string; value: string; times: string; total: number; n: number; tone: ReportRowData["tone"] }[];
  instable: { question: string; engine: string; value: string; note: string }[];
  /** "Wie AI wel noemt": up to three recommendation questions where the business was left out. */
  named: NamedBlock[];
  /** "Vergeleken als: afhaalrestaurant in Rotterdam." when the report knows its comparison profile. */
  profile: string | null;
  /** "Gecontroleerd als: …" when the report carries a profile (every mode), with how it was read and how to correct it. */
  checkedAs: string | null;
  checkedAsNote: string | null;
  /** The business could not be read (ADR-0007): the note already says how to fix it. */
  checkedAsNeutral: boolean;
  /** Online businesses only (and only when there are category or alternative questions). */
  competition: CompetitionView | null;
  sources: SourceRowData[];
  sourcesTitle: string;
  sourcesBody: string;
  plan: { h2: string; steps: PlanStep[]; note?: string; monitor: string; setup: string; excl: string };
  self: { h3: string; body: string; steps: string[] };
  /** The count in "Alle N antwoorden bekijken": the number of lines below it. */
  allCount: number;
}

type LineKind = "correct" | "wrong" | "notFound" | "other" | "unchecked";

const severityRank: Record<Severity, number> = { afhaker: 0, misleider: 1, verwarring: 2 };

interface QuestionGroup {
  key: string;
  question: string;
  findings: Finding[];
  correct: { engine: Engine; value: string }[];
}

function keyOf(factKey: string, subject: string | null | undefined, rec = false): string {
  return `${factKey}:${subject ?? ""}${rec ? ":rec" : ""}`;
}

/** The stored question behind a recommendation finding (core first), else the generic wording. */
function recQuestion(report: ScanReport, factKey: string, subject: string | null, copy: CopyShape): string {
  const probe = subject ? `${factKey}:${subject}` : factKey;
  const hit = (report.recommendations ?? []).find((r) => r.probe === probe && r.pool === "core") ?? (report.recommendations ?? []).find((r) => r.probe === probe);
  return hit?.prompt ?? recommendationQuestionFor(factKey as never, subject, report.business.place, copy);
}

function namedBlocks(report: ScanReport, copy: CopyShape): NamedBlock[] {
  const N = copy.result.named;
  return (report.recommendations ?? [])
    .filter((r) => r.pool === "core" && r.named < r.answers && r.others.length > 0)
    .slice(0, 3)
    .map((r) => ({
      question: r.prompt,
      you: N.you(r.named, r.answers),
      others: r.others.slice(0, 3).map((o) => ({ name: o.name, times: N.times(o.answers) })),
      sources: r.sources.slice(0, 3).map((s) => ({ host: s.host, href: s.url, times: N.times(s.answers) })),
    }));
}

/** Group findings and correct answers into one row per question. */
function groupQuestions(report: ScanReport, copy: CopyShape, online: boolean): QuestionGroup[] {
  const { name, place } = report.business;
  const groups = new Map<string, QuestionGroup>();
  const get = (key: string, question: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { key, question, findings: [], correct: [] };
      groups.set(key, g);
    }
    return g;
  };
  for (const c of report.correct) {
    // Older reports carry only the Dutch prompt and wording; newer ones let the page word both itself.
    const key = c.factKey ? keyOf(c.factKey, c.subject) : `p:${c.prompt}`;
    const question = c.factKey ? questionFor(c.factKey, c.subject ?? null, name, place, copy, online) : c.prompt;
    const value = c.factKey && c.raw != null ? humanValue(c.factKey, c.raw, c.subject ?? null, copy) : c.value;
    get(key, question).correct.push({ engine: c.engine, value });
  }
  for (const f of report.findings) {
    const rec = f.evidenceKind === "recommendation";
    const key = keyOf(f.factKey, f.subject, rec);
    const q = rec ? recQuestion(report, f.factKey, f.subject, copy) : questionFor(f.factKey, f.subject, name, place, copy, online);
    const g = groups.get(key) ?? get(key, q);
    g.findings.push(f);
  }
  // Findings first (worst first), then the correct ones, in a stable order.
  const rank = (g: QuestionGroup) => {
    const wrong = g.findings.filter((f) => f.verdict !== "not_found");
    if (wrong.length) return Math.min(...wrong.map((f) => severityRank[findingSeverity(f)]));
    if (g.findings.length) return 3;
    return 4;
  };
  return [...groups.values()].sort((a, b) => rank(a) - rank(b));
}

function sourceLabel(f: Finding, copy: CopyShape): { label: string; href: string | null } {
  const T = copy.result.table;
  if (f.verdict === "not_found") return { label: T.noSource, href: null };
  if (f.evidenceKind === "recommendation" && !f.sourceUrl) return { label: T.noSource, href: null };
  if (f.sourceUrl) {
    const host = hostOf(f.sourceUrl);
    return { label: f.sourceType === "other_entity" ? `${host}, ${T.otherEntity}` : host, href: f.sourceUrl };
  }
  if (f.sourceType === "other_entity") return { label: copy.sourceType.other_entity, href: null };
  if (f.sourceType === "none") return { label: T.memory, href: null };
  return { label: copy.sourceType[f.sourceType], href: null };
}

function dominant(findings: Finding[]): Finding | null {
  if (!findings.length) return null;
  return [...findings].sort((a, b) => severityRank[findingSeverity(a)] - severityRank[findingSeverity(b)] || b.frequency - a.frequency)[0]!;
}

function rowFor(g: QuestionGroup, copy: CopyShape): ReportRowData {
  const T = copy.result.table;
  const wrong = g.findings.filter((f) => f.verdict !== "not_found");
  const notFound = g.findings.filter((f) => f.verdict === "not_found");
  if (wrong.length) {
    const f = dominant(wrong)!;
    const rec = f.evidenceKind === "recommendation";
    const src = sourceLabel(f, copy);
    return {
      question: g.question,
      said: rec ? T.notNamed : wrongText(f, copy),
      tone: "rood",
      correct: rec ? copy.recommendation.shouldName : f.sourceType === "other_entity" ? `${correctText(f, copy)} (${T.otherEntity})` : correctText(f, copy),
      source: src.label,
      sourceUrl: src.href,
      note: rec ? copy.recommendation.line : undefined,
    };
  }
  if (notFound.length) {
    const f = dominant(notFound)!;
    return { question: g.question, said: T.notFound, tone: "grijs", correct: correctText(f, copy), source: T.noSource };
  }
  const value = g.correct[0]?.value ?? T.ok;
  return { question: g.question, said: value, tone: "groen", correct: T.ok, source: T.none };
}

function cardFor(f: Finding, report: ScanReport, copy: CopyShape, online: boolean): AnswerCardData {
  const A = copy.result.answerCard;
  const business = report.business;
  const question = f.evidenceKind === "recommendation" ? recQuestion(report, f.factKey, f.subject, copy) : questionFor(f.factKey, f.subject, business.name, business.place, copy, online);
  const engine = ENGINE_LABEL[f.engine];
  const caption = A.frequency(f.frequency, f.sampleCount) + (f.sourceType === "other_entity" ? ` · ${A.otherEntity}` : "");
  if (f.verdict === "not_found") return { question, engine, highlight: A.notFoundQuote, highlightTone: "grijs", caption };
  if (f.evidenceKind === "recommendation") return { question, engine, highlight: A.notNamed, highlightTone: "bold", caption };
  return { question, engine, highlight: wrongText(f, copy), highlightTone: "rood", caption };
}

function pickCards(findings: Finding[], report: ScanReport, grey: boolean, copy: CopyShape, online: boolean): AnswerCardData[] {
  const sorted = [...findings].sort((a, b) => severityRank[findingSeverity(a)] - severityRank[findingSeverity(b)] || b.frequency - a.frequency);
  if (!grey) {
    // One card per question: the worst finding of each question first.
    const seen = new Set<string>();
    const picks = sorted.filter((f) => {
      const k = keyOf(f.factKey, f.subject, f.evidenceKind === "recommendation");
      return seen.has(k) ? false : (seen.add(k), true);
    });
    return picks.slice(0, 3).map((f) => cardFor(f, report, copy, online));
  }
  // Grey: show the three kinds of "AI kent je niet" when they exist: not named, not found, another business.
  const picks: Finding[] = [];
  const add = (f: Finding | undefined) => f && !picks.includes(f) && picks.push(f);
  add(sorted.find((f) => f.evidenceKind === "recommendation"));
  add(sorted.find((f) => f.verdict === "not_found"));
  add(sorted.find((f) => f.sourceType === "other_entity"));
  for (const f of sorted) if (picks.length < 3) add(f);
  return picks.slice(0, 3).map((f) => cardFor(f, report, copy, online));
}

/** "Gecontroleerd als: aanbieder van achtergrondmuziek voor hotels en horeca, online": Vidalo's reading, and how to correct it. */
function checkedAsFor(report: ScanReport, copy: CopyShape): { checkedAs: string | null; checkedAsNote: string | null; checkedAsNeutral: boolean } {
  // The same function the CLI and the mails use (core shared/checked-as.ts).
  const parts = checkedAsParts(report.profile, copy.result.checkedAs);
  return { checkedAs: parts?.line ?? null, checkedAsNote: parts?.how ?? null, checkedAsNeutral: isNeutralProfile(report.profile) };
}

/** One entry per category and alternative question: how often the business was named, who else, and what AI wrote about it. Counts only. */
function competitionFor(report: ScanReport, copy: CopyShape): CompetitionView | null {
  const K = copy.result.competition;
  const rows = (report.recommendations ?? []).filter((r) => r.family === "rec_category" || r.family === "alternative");
  const counts = competitionCountsOf(report);
  if (!counts) return null;
  return {
    // The counts the free-check mail shows come from the same function (core types.ts).
    summary: K.summary(counts.named, counts.answers),
    questions: rows.map((r) => ({
      question: r.prompt,
      you: K.you(r.named, r.answers),
      others: r.others.slice(0, 5).map((o) => ({ name: o.name, times: K.times(o.answers, r.answers) })),
      quotes: r.quotes.slice(0, 3).map((q) => ({ text: q.text, engine: K.quoteBy(ENGINE_LABEL[q.engine]) })),
    })),
    note: K.note,
  };
}

export interface BuildViewOptions {
  domain?: string | null;
  /** Pre-built source rows (grey state, when a source audit exists). */
  sources?: SourceRowData[];
  website?: string | null;
  googlePlaceId?: string | null;
  kvk?: string | null;
}

export function buildReportView(report: ScanReport, copy: CopyShape, opts: BuildViewOptions = {}): ReportView {
  const R = copy.result;
  const grey = report.visibility === "unknown" || report.stip === "grijs";
  const state: ReportState = grey ? "grijs" : report.stip === "groen" ? "groen" : "rood";
  const online = report.profile?.mode === "online";
  const groups = groupQuestions(report, copy, online);
  const rows = groups.map((g) => rowFor(g, copy));
  const wrongQuestions = rows.filter((r) => r.tone === "rood").length;
  const notFoundQuestions = rows.filter((r) => r.tone === "grijs").length;
  const activeEngines = report.engines.filter((e) => !e.skipped);
  // What was really asked (reports since 11 Nov 2026): every question, also the ones without a fact to check them
  // against, and how often each engine answered it. Older reports fall back to the rows and an average.
  const askedAbout = (report.asked ?? []).filter((a) => a.kind === "about");
  const askedKeys = new Set(askedAbout.map((a) => keyOf(a.factKey, a.subject)));
  const checkedKeys = new Set(askedAbout.filter((a) => a.checked).map((a) => keyOf(a.factKey, a.subject)));
  const questions = askedKeys.size ? Math.max(askedKeys.size, rows.length) : rows.length;
  // A question without a fact that still produced a finding (not found, another business) is on the table, not unchecked.
  const unchecked = [...askedKeys].filter((k) => !checkedKeys.has(k) && !groups.some((g) => g.key === k && g.findings.length > 0)).length;
  const legacyPerQuestion = report.findings[0]?.sampleCount ?? (rows.length && activeEngines.length ? Math.max(1, Math.round(report.totalAnswers / (rows.length * activeEngines.length))) : 3);
  // The most common number of answers per question: a paid check asks 5 times and goes on to 10 only where an answer was wrong.
  const timesPer = activeEngines.map((e) => {
    const cells = askedAbout.filter((a) => a.engine === e.engine);
    if (!cells.length) return { name: ENGINE_LABEL[e.engine], n: legacyPerQuestion };
    const freq = new Map<number, number>();
    for (const c of cells) freq.set(c.samples, (freq.get(c.samples) ?? 0) + 1);
    const n = [...freq.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
    return { name: ENGINE_LABEL[e.engine], n };
  });
  const times = R.hero.times(timesPer.length ? timesPer : [{ name: "", n: legacyPerQuestion }]);
  const askedSamples = (key: string, engine: Engine) => askedAbout.filter((a) => a.engine === engine && keyOf(a.factKey, a.subject) === key).reduce((n, a) => Math.max(n, a.samples), 0);
  // Grey because nothing could be checked, while the AI did answer: not "AI kent je niet".
  const uncheckedGrey = isUncheckedGrey(report);
  const engineNames = activeEngines.map((e) => ENGINE_LABEL[e.engine]);
  const enginesText = engineNames.length > 1 ? `${engineNames.slice(0, -1).join(", ")} ${copy.report.and} ${engineNames[engineNames.length - 1]}` : (engineNames[0] ?? "");

  const otherByEngine = new Map<Engine, number>();
  for (const f of report.findings) if (f.sourceType === "other_entity") otherByEngine.set(f.engine, (otherByEngine.get(f.engine) ?? 0) + f.frequency);
  const otherEntityTotal = [...otherByEngine.values()].reduce((a, b) => a + b, 0);

  const hero = uncheckedGrey
    ? { number: questions, label: R.hero.uncheckedLabel(questions) }
    : state === "grijs"
      ? { number: rows.filter((r) => r.tone === "groen").length, label: R.hero.answeredLabel(questions) }
      : state === "groen"
        ? { number: questions, label: R.hero.okLabel(questions) }
        : { number: wrongQuestions, label: R.hero.wrongLabel(questions) };

  const tone = report.stip === "oranje" ? "oranje" : state === "groen" ? "groen" : "rood";
  const h1 = online
    ? uncheckedGrey ? R.hero.h1UncheckedOnline(report.business.name) : state === "grijs" ? R.hero.h1GreyOnline(report.business.name) : R.hero.h1Online(report.business.name, tone)
    : uncheckedGrey ? R.hero.h1Unchecked(report.business.name, report.business.place) : state === "grijs" ? R.hero.h1Grey(report.business.name, report.business.place) : R.hero.h1(report.business.name, report.business.place, tone);
  const intro = uncheckedGrey
    ? R.hero.introUnchecked(enginesText, questions, times, report.notFoundAnswers, report.totalAnswers, otherEntityTotal)
    : state === "grijs"
      ? R.hero.introGrey(enginesText, questions, times, report.notFoundAnswers, report.totalAnswers, otherEntityTotal)
      : R.hero.intro(enginesText, questions, times, wrongQuestions, notFoundQuestions, unchecked);

  const cards = pickCards(report.findings, report, grey && !uncheckedGrey, copy, online);

  // One line per question, AI system and answer, with how often it came: a wrong answer 3 of 3 times
  // reads differently from 1 of 3, and the lines add up to the count in the heading (9 Nov 2026: the
  // list showed findings once but every correct answer per sample, 10 lines under "Alle 12 antwoorden").
  const all = groups.flatMap((g) => {
    const row = rowFor(g, copy);
    if (!row) return [];
    const perEngine = new Map<Engine, { wrong: number; correct: Map<string, number>; total: number }>();
    const cell = (e: Engine) => {
      let c = perEngine.get(e);
      if (!c) perEngine.set(e, (c = { wrong: 0, correct: new Map(), total: 0 }));
      return c;
    };
    for (const f of g.findings) {
      const c = cell(f.engine);
      c.wrong += f.frequency;
      c.total = Math.max(c.total, f.sampleCount);
    }
    for (const a of g.correct) {
      const c = cell(a.engine);
      c.correct.set(a.value, (c.correct.get(a.value) ?? 0) + 1);
    }
    for (const [e, c] of perEngine.entries()) c.total = Math.max(c.total, c.wrong + [...c.correct.values()].reduce((s, n) => s + n, 0), askedSamples(g.key, e));
    const fromFindings = g.findings.map((f) => ({
      question: g.question,
      engine: ENGINE_LABEL[f.engine],
      value: f.verdict === "not_found" ? R.table.notFound : f.evidenceKind === "recommendation" ? R.table.notNamed : wrongText(f, copy),
      times: R.table.times(f.frequency, cell(f.engine).total),
      total: cell(f.engine).total,
      n: f.frequency,
      tone: (f.verdict === "not_found" ? "grijs" : "rood") as ReportRowData["tone"],
      kind: (f.verdict === "not_found" ? "notFound" : f.sourceType === "other_entity" ? "other" : "wrong") as LineKind,
    }));
    const fromCorrect = [...perEngine.entries()].flatMap(([e, c]) => [...c.correct.entries()].map(([value, n]) => ({ question: g.question, engine: ENGINE_LABEL[e], value, times: R.table.times(n, c.total), total: c.total, n, tone: "groen" as const, kind: "correct" as LineKind })));
    return [...fromFindings, ...fromCorrect];
  });
  // Every answer asked is on the list (reports since 11 Nov 2026): per question and AI system what was said,
  // values on a question we have no fact for marked "niet te controleren" (the Sonova address stayed hidden),
  // and the rest as "geen bruikbaar antwoord". Per (question, engine), so one engine's finding never hides another's answers.
  const lineKey = (question: string, engine: string) => `${question}|${engine}`;
  const covered = new Map<string, number>();
  for (const l of all) covered.set(lineKey(l.question, l.engine), (covered.get(lineKey(l.question, l.engine)) ?? 0) + l.n);
  for (const a of askedAbout) {
    const question = questionFor(a.factKey, a.subject, report.business.name, report.business.place, copy, online);
    const engine = ENGINE_LABEL[a.engine];
    const k = lineKey(question, engine);
    let used = covered.get(k) ?? 0;
    if (!a.checked) {
      for (const u of a.unknown ?? []) {
        if (used + u.n > a.samples) break;
        all.push({ question, engine, value: `${humanValue(a.factKey, u.value, a.subject, copy)} (${R.table.unchecked})`, times: R.table.times(u.n, a.samples), total: a.samples, n: u.n, tone: "grijs", kind: "unchecked" });
        used += u.n;
      }
    }
    if (a.samples > used) all.push({ question, engine, value: R.table.noAnswer, times: R.table.times(a.samples - used, a.samples), total: a.samples, n: a.samples - used, tone: "grijs", kind: "notFound" });
    covered.set(k, Math.max(used, a.samples));
  }
  // Per AI system the questions, not the answers: each question counts once (11 Nov 2026: "ChatGPT 6 klopt · 3 fout"
  // under "3 vragen" counted samples). A finding (wrong, other business) counts like the table and the hero count it,
  // even at 1 of 3; otherwise the verdict most answers carried, a tie counting as the worse one.
  const worse: LineKind[] = ["wrong", "other", "notFound", "unchecked", "correct"];
  const engineLines = report.engines.map((e) => {
    const name = ENGINE_LABEL[e.engine];
    if (e.skipped) return { name, text: R.hero.engineSkipped };
    const perQuestion = new Map<string, Map<LineKind, number>>();
    for (const l of all) {
      if (l.engine !== name) continue;
      const m = perQuestion.get(l.question) ?? new Map<LineKind, number>();
      m.set(l.kind, (m.get(l.kind) ?? 0) + l.n);
      perQuestion.set(l.question, m);
    }
    const count: Record<LineKind, number> = { correct: 0, wrong: 0, notFound: 0, other: 0, unchecked: 0 };
    for (const m of perQuestion.values()) {
      const finding = (["wrong", "other"] as const).find((k) => (m.get(k) ?? 0) > 0);
      const top = Math.max(...m.values());
      count[finding ?? worse.find((k) => m.get(k) === top)!] += 1;
    }
    return { name, text: R.hero.engineCounts(count.correct, count.wrong, count.notFound, count.other, count.unchecked) };
  });
  // The heading counts the lines below it (one per question and AI system), not the samples behind them (11 Nov 2026).
  const allCount = all.length;

  const instable = report.instable.map((f) => ({
    question: f.evidenceKind === "recommendation" ? recQuestion(report, f.factKey, f.subject, copy) : questionFor(f.factKey, f.subject, report.business.name, report.business.place, copy, online),
    engine: ENGINE_LABEL[f.engine],
    value: f.evidenceKind === "recommendation" ? R.table.notNamed : wrongText(f, copy),
    note: copy.instableLine,
  }));

  // Sources
  let sources: SourceRowData[];
  if (opts.sources) sources = opts.sources;
  // Grey because we could not check: nothing to say about where AI looks for you (compliance round 2).
  else if (uncheckedGrey) sources = [];
  else if (state === "grijs") {
    const S = R.sources;
    const website: SourceRowData = { label: S.rows.website, status: opts.website ? S.known : S.missing, tone: opts.website ? "muted" : "rood", href: opts.website ?? null };
    // No Google, Bing, Apple or directory rows for an online business: there is no listing to audit (compliance B6).
    sources = online ? [website, { label: S.rows.kvk, status: opts.kvk ? S.ok : S.unchecked, tone: opts.kvk ? "groen" : "muted" }] : [
      website,
      { label: S.rows.gbp, status: opts.googlePlaceId ? S.known : S.unclaimed, tone: opts.googlePlaceId ? "muted" : "rood" },
      { label: S.rows.bingApple, status: S.unchecked, tone: "muted" },
      { label: S.rows.directories(13), status: S.unchecked, tone: "muted" },
      { label: S.rows.kvk, status: opts.kvk ? S.ok : S.unchecked, tone: opts.kvk ? "groen" : "muted" },
    ];
  } else {
    const bySource = new Map<string, { label: string; href: string | null; n: number }>();
    for (const f of report.findings) {
      if (f.verdict === "not_found") continue;
      const src = sourceLabel(f, copy);
      const k = src.href ?? src.label;
      const cur = bySource.get(k) ?? { label: src.label, href: src.href, n: 0 };
      cur.n += 1;
      bySource.set(k, cur);
    }
    sources = [...bySource.values()].map((s) => ({ label: s.label, href: s.href, status: R.sources.wrongCount(s.n), tone: "rood" as const }));
  }

  // Plan
  const hosts = [...new Set(report.findings.filter((f) => f.verdict !== "not_found" && f.sourceUrl && f.sourceType !== "owned_website" && f.sourceType !== "owned_facts_page").map((f) => hostOf(f.sourceUrl)))];
  const firstTone: Stip = state === "grijs" ? "grijs" : state === "groen" ? "grijs" : report.stip === "oranje" ? "oranje" : "rood";
  // An online business has no listing to compare: its panel promises no Google, Bing, Apple or directory work
  // (compliance B6) and says "1 bedrijf".
  const O = R.plan.online;
  const greenSteps = (online ? O.stepsGreen : R.plan.stepsGreen).map((text, i) => ({ tone: (["grijs", "oranje", "groen"] as const)[i]!, text }));
  const excl = online ? O.exclVat : R.plan.exclVat;
  const plan = uncheckedGrey
    ? {
        h2: R.plan.h2Unchecked,
        steps: greenSteps,
        monitor: R.plan.monitor,
        setup: R.plan.setup,
        excl,
      }
    : state === "grijs"
      ? {
          h2: R.plan.h2Grey,
          steps: online
            ? [
                { tone: "grijs" as const, text: O.stepsGrey.facts },
                { tone: "oranje" as const, text: O.stepsGrey.publish(opts.domain ?? null) },
                { tone: "groen" as const, text: O.stepsGrey.recheck },
              ]
            : [
                { tone: "grijs" as const, text: R.plan.stepsGrey.facts },
                { tone: "oranje" as const, text: R.plan.stepsGrey.publish(opts.domain ?? null) },
                { tone: "groen" as const, text: R.plan.stepsGrey.recheck },
              ],
          note: R.plan.noteGrey,
          monitor: R.plan.monitorGrey,
          setup: R.plan.setupGrey,
          excl: online ? O.exclVatGrey : R.plan.exclVatGrey,
        }
      : state === "groen"
        ? {
            h2: R.plan.h2Green,
            steps: greenSteps,
            monitor: R.plan.monitor,
            setup: R.plan.setup,
            excl,
          }
        : {
            h2: R.plan.h2,
            steps: [
              { tone: firstTone, text: hosts.length ? R.plan.stepSources(hosts.join(", ")) : R.plan.stepSourcesNone },
              { tone: "oranje" as const, text: online ? O.stepFacts(opts.domain ?? null) : R.plan.stepFacts(opts.domain ?? null) },
              { tone: "groen" as const, text: R.plan.stepRecheck },
            ],
            monitor: R.plan.monitor,
            setup: R.plan.setup,
            excl,
          };

  const wrongSteps = report.findings
          .filter((f) => f.verdict !== "not_found")
          .map((f) => {
            const src = sourceLabel(f, copy);
            return copy.report.selfStep(src.label, ENGINE_LABEL[f.engine], f.evidenceKind === "recommendation" ? null : wrongText(f, copy), correctText(f, copy), f.verdict === "wrong" ? copy.report.selfFix[f.sourceType] : "");
          });
  // No wrong answer (green, or grey): the general steps, so "Bekijk de stappen" never opens on nothing (11 Nov 2026).
  const general = state === "grijs" || wrongSteps.length === 0;
  const selfSteps = general ? [...R.self.stepsGrey] : wrongSteps;

  return {
    state,
    stip: report.stip,
    questions,
    perQuestion: timesPer.length ? Math.max(...timesPer.map((t) => t.n)) : legacyPerQuestion,
    wrongQuestions,
    notFoundQuestions,
    hero,
    h1,
    intro,
    engineLines,
    cards,
    rows,
    all,
    instable,
    // An online business has no town questions: its competition block replaces "Wie AI wel noemt".
    named: online ? [] : namedBlocks(report, copy),
    profile: report.comparedAs && !online ? R.named.profile(report.comparedAs, report.business.place) : null,
    ...checkedAsFor(report, copy),
    competition: online ? competitionFor(report, copy) : null,
    sources,
    sourcesTitle: state === "grijs" ? R.sources.h2Grey : R.sources.h2,
    sourcesBody: state === "grijs" ? R.sources.bodyGrey : R.sources.body,
    plan,
    self: { h3: general ? R.self.h3Grey : R.self.h3, body: general ? R.self.bodyGrey : R.self.body, steps: selfSteps },
    allCount,
  };
}

