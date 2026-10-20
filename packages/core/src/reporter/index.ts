/**
 * Reporter: turns db state into Dutch e-mails and proof-card data.
 */
import type { Engine, Finding, Sample, ScanReport } from "../types.js";
import { ENGINES } from "../types.js";
import type { BusinessRecord } from "../db/types.js";
import { getDb } from "../shared/db.js";
import { log } from "../shared/log.js";
import { findingWordsNl, hostOfUrl } from "../shared/facts-nl.js";
import { fixPathForFinding, daysBetween } from "../fixer/paths.js";
import { cnameTarget, isFallbackHost } from "../publisher/host.js";
import { confirmFactsUrl, dashboardUrl, factsPageUrl, googleConnectUrl, resultUrl, unsubscribeOneClickUrl, unsubscribeUrl } from "./links.js";
import { canSignUnsubscribe, isUnsubscribed } from "../shared/unsubscribe.js";
import { sendMail, type MailResult } from "./mail.js";
import {
  baselineSummaryEmail,
  followUpEmail,
  monthlyReportEmail,
  resolutionNoticeEmail,
  unfixableNoticeEmail,
  welcomeEmail,
  type Mail,
  type OpenFindingLine,
  type ProofCard,
} from "./templates.js";

export * from "./mail.js";
export * from "./templates.js";
export * from "./links.js";

const PRICE_SETUP = 149;
const PRICE_MONITOR = 49;

async function requireBusiness(businessId: string): Promise<BusinessRecord> {
  const b = await getDb().getBusiness(businessId);
  if (!b) throw new Error(`business ${businessId} not found`);
  return b;
}

async function deliver(business: BusinessRecord, m: Mail, type: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>): Promise<MailResult | null> {
  if (!business.ownerEmail) {
    log.warn("reporter.no_owner_email", { businessId: business.id, type });
    return null;
  }
  const res = await sendMail({ to: business.ownerEmail, subject: m.subject, text: m.text, html: m.html, headers, tags: { type, business: business.slug } });
  await getDb().logEvent(business.id, `email.${type}`, { to: business.ownerEmail, subject: m.subject, mode: res.mode, id: res.id, ...extra });
  return res;
}

function sourceLabel(f: Finding): string {
  if (f.sourceType === "none") return "geheugen van het model";
  if (f.sourceType === "owned_facts_page") return "je feitenpagina";
  if (f.sourceType === "owned_website") return hostOfUrl(f.sourceUrl) ?? "je website";
  if (f.sourceType === "other_entity") return "naamgenoot";
  return hostOfUrl(f.sourceUrl) ?? "onbekende bron";
}

/** Not-found answer count, visibility, colour and instable answers for a scan run, rebuilt from stored samples and claims. */
async function notFoundStats(
  scanRunId: string | null | undefined,
): Promise<Pick<ScanReport, "notFoundAnswers" | "visibility" | "stip" | "engineStips" | "instable" | "recommendations"> | null> {
  if (!scanRunId) return null;
  try {
    const { buildReport } = await import("../scanner/index.js");
    const r = await buildReport(scanRunId);
    return { notFoundAnswers: r.notFoundAnswers, visibility: r.visibility, stip: r.stip, engineStips: r.engineStips, instable: r.instable, recommendations: r.recommendations };
  } catch (err) {
    log.warn("reporter.not_found_stats_failed", { scanRunId, error: String((err as Error)?.message ?? err) });
    return null;
  }
}

async function sampleQuote(scanRunId: string | null, sampleId: string | null): Promise<Sample | null> {
  if (!scanRunId || !sampleId) return null;
  const samples = await getDb().listSamples(scanRunId);
  return samples.find((s) => s.id === sampleId) ?? null;
}

/** Find the after-sample via the fix evidence (recheckScanRunId) written by the fixer. */
async function afterSample(finding: Finding): Promise<Sample | null> {
  if (!finding.evidenceAfter) return null;
  const fixes = await getDb().listFixes(finding.id);
  for (const fix of fixes) {
    const runId = (fix.evidence as { recheckScanRunId?: string }).recheckScanRunId;
    const s = await sampleQuote(runId ?? null, finding.evidenceAfter);
    if (s) return s;
  }
  return null;
}

function trim(s: string, n = 220): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

// ---------------------------------------------------------------------------
// proof cards
// ---------------------------------------------------------------------------

export async function proofCards(businessId: string, limit = 12): Promise<ProofCard[]> {
  const db = getDb();
  const resolved = (await db.listFindings(businessId, "resolved")).sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? "")).slice(0, limit);
  const cards: ProofCard[] = [];
  for (const f of resolved) {
    const w = findingWordsNl(f);
    const before = await sampleQuote(f.scanRunId, f.evidenceBefore);
    const after = await afterSample(f);
    cards.push({
      findingId: f.id,
      engine: f.engine,
      what: w.what,
      before: before ? trim(before.answerText) : w.wrong,
      after: after ? trim(after.answerText) : w.correct,
      source: sourceLabel(f),
      days: Math.max(0, daysBetween(f.firstSeenAt, f.resolvedAt ?? new Date())),
      resolvedAt: f.resolvedAt ?? new Date().toISOString(),
    });
  }
  return cards;
}

// ---------------------------------------------------------------------------
// e-mails
// ---------------------------------------------------------------------------

export async function sendWelcome(businessId: string): Promise<MailResult | null> {
  const business = await requireBusiness(businessId);
  const host = business.factsHost;
  const cname = host && !isFallbackHost(host) ? { host, target: cnameTarget() } : null;
  const m = welcomeEmail({
    business,
    cname,
    links: {
      dashboardUrl: dashboardUrl(business),
      factsPageUrl: factsPageUrl(business),
      confirmFactsUrl: confirmFactsUrl(business),
      googleConnectUrl: googleConnectUrl(business),
    },
  });
  return deliver(business, m, "welcome");
}

export async function sendBaselineSummary(scanRunId: string): Promise<MailResult | null> {
  const db = getDb();
  const run = await db.getScanRun(scanRunId);
  if (!run) throw new Error(`scan_run ${scanRunId} not found`);
  const business = await requireBusiness(run.businessId);
  const findings = await db.listFindingsByScanRun(scanRunId);
  const prompts = await db.listPrompts(business.id, { activeOnly: true });
  const samples = await db.listSamples(scanRunId);
  const totalAnswers = samples.length || prompts.length * run.engines.length;
  const nf = await notFoundStats(scanRunId);
  const m = baselineSummaryEmail({
    business,
    checkedAt: run.finishedAt ?? run.startedAt,
    totalAnswers,
    wrongAnswers: findings.filter((f) => f.verdict !== "not_found").length,
    notFoundAnswers: nf?.notFoundAnswers,
    visibility: nf?.visibility,
    stip: nf?.stip,
    engineStips: nf?.engineStips,
    instable: nf?.instable,
    recommendations: nf?.recommendations,
    findings,
    engines: run.engines,
    links: { dashboardUrl: dashboardUrl(business), factsPageUrl: factsPageUrl(business) },
  });
  return deliver(business, m, "baseline", { scanRunId, stip: nf?.stip ?? null });
}

export async function sendResolutionNotice(findingId: string): Promise<MailResult | null> {
  const db = getDb();
  const finding = await db.getFinding(findingId);
  if (!finding) throw new Error(`finding ${findingId} not found`);
  const business = await requireBusiness(finding.businessId);
  const w = findingWordsNl(finding);
  const before = await sampleQuote(finding.scanRunId, finding.evidenceBefore);
  const after = await afterSample(finding);
  const resolvedAt = finding.resolvedAt ?? new Date().toISOString();
  const m = resolutionNoticeEmail({
    business,
    finding,
    before: { quote: before ? trim(before.answerText) : w.wrong, at: before?.capturedAt ?? finding.firstSeenAt },
    after: { quote: after ? trim(after.answerText) : w.correct, at: after?.capturedAt ?? resolvedAt },
    days: Math.max(0, daysBetween(finding.firstSeenAt, resolvedAt)),
    links: { dashboardUrl: dashboardUrl(business) },
  });
  return deliver(business, m, "resolution", { findingId });
}

export async function sendUnfixableNotice(findingId: string, note: string): Promise<MailResult | null> {
  const db = getDb();
  const finding = await db.getFinding(findingId);
  if (!finding) throw new Error(`finding ${findingId} not found`);
  const business = await requireBusiness(finding.businessId);
  const m = unfixableNoticeEmail({
    business,
    finding,
    note,
    triedDays: Math.max(1, daysBetween(finding.firstSeenAt, new Date())),
    links: { dashboardUrl: dashboardUrl(business) },
  });
  return deliver(business, m, "unfixable", { findingId });
}

export interface MonthlyReportOptions {
  /** the monthly scan run this report covers; when omitted the stats come from current findings */
  scanRunId?: string;
  monthLabel?: string;
}

function monthLabelNl(d = new Date()): string {
  return new Intl.DateTimeFormat("nl-NL", { month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(d);
}

export async function sendMonthlyReport(businessId: string, opts: MonthlyReportOptions = {}): Promise<MailResult | null> {
  const db = getDb();
  const business = await requireBusiness(businessId);
  const run = opts.scanRunId ? await db.getScanRun(opts.scanRunId) : null;
  const engines: Engine[] = run?.engines ?? ENGINES;
  const prompts = await db.listPrompts(business.id, { activeOnly: true });
  const samples = run ? await db.listSamples(run.id) : [];
  const totalAnswers = samples.length || prompts.length * engines.length;

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 31);
  const all = await db.listFindings(business.id);
  const openFindings = all.filter((f) => f.status === "open" || f.status === "fixing" || f.status === "recheck");
  const resolvedThisMonth = all.filter((f) => f.status === "resolved" && f.resolvedAt && new Date(f.resolvedAt) >= since);
  const unfixable = all.filter((f) => f.status === "unfixable");
  const cards = (await proofCards(business.id)).filter((c) => resolvedThisMonth.some((f) => f.id === c.findingId));

  const open: OpenFindingLine[] = openFindings.map((f) => ({ finding: f, nextStep: fixPathForFinding(f).labelNl, since: f.firstSeenAt }));
  const isNotFound = (f: Finding) => f.verdict === "not_found";
  const nf = await notFoundStats(run?.id);

  const m = monthlyReportEmail({
    business,
    month: opts.monthLabel ?? monthLabelNl(),
    checkedAt: run?.finishedAt ?? run?.startedAt ?? new Date().toISOString(),
    totalAnswers,
    wrongAnswers: openFindings.filter((f) => !isNotFound(f)).length + unfixable.filter((f) => !isNotFound(f)).length,
    notFound: openFindings.filter(isNotFound).length + unfixable.filter(isNotFound).length,
    notFoundAnswers: nf?.notFoundAnswers,
    visibility: nf?.visibility,
    stip: nf?.stip,
    engineStips: nf?.engineStips,
    instable: nf?.instable,
    recommendations: nf?.recommendations,
    resolved: resolvedThisMonth.length,
    inProgress: openFindings.length,
    unfixable: unfixable.length,
    proofCards: cards,
    openFindings: open,
    engines,
    links: { dashboardUrl: dashboardUrl(business), factsPageUrl: factsPageUrl(business) },
  });
  return deliver(business, m, "report", { scanRunId: run?.id ?? null, open: openFindings.length, resolved: resolvedThisMonth.length, stip: nf?.stip ?? null });
}

/** Non-customer follow-up after the free scan (day 7 / day 21). */
export async function sendFollowUp(businessId: string, day: 7 | 21): Promise<MailResult | null> {
  const db = getDb();
  const business = await requireBusiness(businessId);
  if (business.status !== "scanned") {
    log.info("followup.skip", { businessId, status: business.status, day });
    return null;
  }
  // Commercial mail: never without a working opt-out, never after one.
  if (!canSignUnsubscribe()) {
    log.warn("followup.skip", { businessId, reason: "UNSUBSCRIBE_SECRET not set", day });
    return null;
  }
  if (await isUnsubscribed(db, business.id)) {
    log.info("followup.skip", { businessId, reason: "unsubscribed", day });
    return null;
  }
  const findings = (await db.listFindings(business.id)).filter((f) => f.status !== "resolved");
  if (!findings.length) {
    log.info("followup.skip", { businessId, reason: "no findings", day });
    return null;
  }
  const prompts = await db.listPrompts(business.id, { activeOnly: true });
  const totalAnswers = Math.max(findings.length, (prompts.length || 6) * 3);
  const example = [...findings].sort((a, b) => b.frequency / b.sampleCount - a.frequency / a.sampleCount)[0] ?? null;
  const m = followUpEmail(
    {
      business,
      wrongAnswers: findings.length,
      totalAnswers,
      example,
      links: { dashboardUrl: dashboardUrl(business), resultUrl: resultUrl(business), unsubscribeUrl: unsubscribeUrl(business) },
      priceSetupEur: PRICE_SETUP,
      priceMonitorEur: PRICE_MONITOR,
    },
    day,
  );
  // RFC 8058: mail apps show their own "unsubscribe" button and POST here.
  const headers = { "List-Unsubscribe": `<${unsubscribeOneClickUrl(business)}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
  return deliver(business, m, `followup_${day}`, {}, headers);
}
