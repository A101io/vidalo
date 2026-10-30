/**
 * Reads for the owner pages in design G (/app, /app/fouten/[id],
 * /app/vermeldingen/[id]). These need the internal tables too (fix, sample,
 * claim, event), which have no owner RLS policy, so after requireOwner they
 * read through the service handle and filter on the owner's business
 * themselves. loadDashboard (lib/reads.ts) stays the RLS path for the rest.
 */
import type { Channel, Claim, Engine, Finding, Fix, Prompt, Sample, ScanReport, ScanRun } from "@vidalo/core/types";
import type { BusinessRecord, EventRow } from "@vidalo/core/db";
import { affectedPrompts, fixPathForFinding } from "@vidalo/core/fixer";
import { pendingDiffOf } from "@vidalo/core/publisher";
import { getScanReport, ready } from "./core";
import { loadDashboard, type DashboardData } from "./reads";

export interface OverviewData extends DashboardData {
  lastRun: ScanRun | null;
  previousRun: ScanRun | null;
  report: ScanReport | null;
  /** open fix per open finding, by finding id */
  fixes: Map<string, Fix>;
  events: EventRow[];
  /** the Google Business Profile change that waits for the owner, if any */
  gbp: { channel: Channel; pending: number } | null;
  nextCheckAt: Date | null;
}

/** Full scans only: rechecks ask a few questions and are not a "check" to the owner. */
const FULL: ScanRun["kind"][] = ["free", "baseline", "monthly", "ondemand"];

export function nextMonthlyCheck(anniversaryDay: number | null, now = new Date()): Date | null {
  if (!anniversaryDay) return null;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), anniversaryDay, 6, 0, 0));
  if (d.getTime() <= now.getTime()) d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

export async function loadOverview(business: BusinessRecord): Promise<OverviewData> {
  const data = await loadDashboard(business.id);
  const db = await ready();
  const done = data.scanRuns.filter((r) => r.status === "done" && FULL.includes(r.kind));
  const lastRun = done[0] ?? null;
  const previousRun = done[1] ?? null;
  const report = lastRun ? await getScanReport(lastRun.id) : null;
  const open = data.findings.filter((f) => f.status !== "resolved");
  const fixes = new Map<string, Fix>();
  for (const f of open) {
    const fix = (await db.listFixes(f.id)).find((x) => x.resolvedAt === null);
    if (fix) fixes.set(f.id, fix);
  }
  const events = await db.listEvents(business.id, 200);
  const gbpChannel = data.channels.find((c) => c.type === "gbp") ?? null;
  const pending = gbpChannel ? pendingDiffOf(gbpChannel).length : 0;
  return {
    ...data,
    lastRun,
    previousRun,
    report,
    fixes,
    events,
    gbp: gbpChannel && pending > 0 ? { channel: gbpChannel, pending } : null,
    nextCheckAt: nextMonthlyCheck(business.anniversaryDay),
  };
}

/** What changed since the previous full check: counts from the findings' own dates. */
export function sinceCounts(findings: Finding[], previousRun: ScanRun | null): { found: number; resolved: number; open: number } | null {
  if (!previousRun) return null;
  const since = previousRun.finishedAt ?? previousRun.startedAt ?? "";
  if (!since) return null;
  const found = findings.filter((f) => f.firstSeenAt > since).length;
  const resolved = findings.filter((f) => f.status === "resolved" && (f.resolvedAt ?? "") > since).length;
  const open = findings.filter((f) => f.status !== "resolved" && f.firstSeenAt <= since).length;
  return { found, resolved, open };
}

export interface FindingDetail {
  finding: Finding;
  fix: Fix | null;
  /** every fix ever opened for it, oldest first */
  fixes: Fix[];
  run: ScanRun | null;
  /** the answers of the finding's engine on the questions behind it, in that check */
  samples: Sample[];
  claims: Claim[];
  /** what the other engines said on the same questions in that check */
  others: { engine: Engine; verdict: "correct" | "wrong" | "not_found" }[];
  prompts: Prompt[];
  events: EventRow[];
}

/** One finding with its evidence, or null when it is not this business's. */
export async function loadFinding(id: string, business: BusinessRecord): Promise<FindingDetail | null> {
  const db = await ready();
  const finding = await db.getFinding(id);
  if (!finding || finding.businessId !== business.id) return null;
  const fixes = (await db.listFixes(finding.id)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const fix = fixes.find((x) => x.resolvedAt === null) ?? fixes[fixes.length - 1] ?? null;
  const run = await db.getScanRun(finding.scanRunId);
  const prompts = affectedPrompts(finding, await db.listPrompts(business.id));
  const promptIds = new Set(prompts.map((p) => p.id));
  const all = run ? await db.listSamples(run.id) : [];
  const onQuestion = all.filter((s) => promptIds.has(s.promptId));
  const samples = onQuestion.filter((s) => s.engine === finding.engine);
  const claims = samples.length ? await db.listClaims(onQuestion.map((s) => s.id)) : [];
  // Other engines: the business's findings on the same fact in the same run say who was wrong or found nothing; the rest answered right.
  const sameFact = (await db.listFindings(business.id)).filter((f) => f.scanRunId === finding.scanRunId && f.factKey === finding.factKey && f.subject === finding.subject && f.engine !== finding.engine);
  const engines = [...new Set(onQuestion.map((s) => s.engine))].filter((e) => e !== finding.engine);
  const others = engines.map((engine) => {
    const f = sameFact.find((x) => x.engine === engine);
    return { engine, verdict: f ? (f.verdict === "not_found" ? ("not_found" as const) : ("wrong" as const)) : ("correct" as const) };
  });
  const events = (await db.listEvents(business.id, 500)).filter((e) => e.payload.findingId === finding.id);
  return { finding, fix, fixes, run, samples, claims, others, prompts, events };
}

/** Open findings grouped per question (fact + subject): the same error on five AI systems is one line to the owner. */
export interface FindingGroup {
  key: string;
  /** the first finding, which carries the question and the link */
  lead: Finding;
  findings: Finding[];
  engines: Engine[];
}

export function groupByQuestion(findings: Finding[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>();
  for (const f of findings) {
    const key = `${f.factKey}:${f.subject ?? ""}:${f.verdict}:${f.sourceType}`;
    const g = groups.get(key);
    if (g) {
      g.findings.push(f);
      if (!g.engines.includes(f.engine)) g.engines.push(f.engine);
    } else groups.set(key, { key, lead: f, findings: [f], engines: [f.engine] });
  }
  return [...groups.values()];
}

/** The fix path's Dutch label and its recheck date, for "Loopt bij ons" lines. */
export function fixPlan(finding: Finding, fix: Fix | null): { labelNl: string; recheckAt: string | null } {
  return { labelNl: fixPathForFinding(finding).labelNl, recheckAt: fix?.resolvedAt ? null : (fix?.recheckAt ?? null) };
}

export interface ChannelDetail {
  channel: Channel;
  pending: ReturnType<typeof pendingDiffOf>;
  lastSync: Record<string, unknown> | null;
  lastDiff: ReturnType<typeof pendingDiffOf>;
  approval: { key: string; decision: "approved" | "declined"; at: string } | null;
  /** channels.synced events that mention this channel, newest first */
  syncs: { at: string; status: string; diff: number }[];
}

export async function loadChannel(id: string, business: BusinessRecord): Promise<ChannelDetail | null> {
  const db = await ready();
  const channel = (await db.listChannels(business.id)).find((c) => c.id === id) ?? null;
  if (!channel) return null;
  const meta = channel.meta ?? {};
  const syncs: ChannelDetail["syncs"] = [];
  for (const e of await db.listEvents(business.id, 500)) {
    if (e.type !== "channels.synced") continue;
    const results = Array.isArray(e.payload.results) ? (e.payload.results as { channel: string; status: string; diff: number }[]) : [];
    const mine = results.find((r) => r.channel === channel.id);
    if (mine) syncs.push({ at: e.at, status: mine.status, diff: mine.diff });
  }
  return {
    channel,
    pending: pendingDiffOf(channel),
    lastSync: (meta.lastSync as Record<string, unknown> | undefined) ?? null,
    lastDiff: Array.isArray(meta.lastDiff) ? (meta.lastDiff as ReturnType<typeof pendingDiffOf>) : [],
    approval: (meta.diffApproval as ChannelDetail["approval"] | undefined) ?? null,
    syncs,
  };
}
