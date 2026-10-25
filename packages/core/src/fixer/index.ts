/**
 * Fixer: one fix path per finding (docs/ARCHITECTURE.md workflow D).
 *
 *   finding → fix row → auto action now (republish / sync / email / owner mail /
 *   operator task / nothing) → recheck_at → mini-scan → resolved (proof) or next
 *   step (follow-up, escalation, unfixable after the window).
 *
 * Owner is only mailed at resolution or when we give up; third parties are
 * mailed in the owner's name with reply-to the owner.
 */
import type { Channel, Finding, Fix, Prompt, ScanReport, Engine, FixAction } from "../types.js";
import type { BusinessRecord, Db } from "../db/types.js";
import { getDb, getFix, isMock } from "../shared/db.js";
import { log, errorMessage } from "../shared/log.js";
import { findingWordsNl, hostOfUrl } from "../shared/facts-nl.js";
import { discoverDirectories, ensurePlatformChannels, publishFactsPage, syncAllChannels, syncOneChannel } from "../publisher/index.js";
import { directoryForUrl } from "../publisher/channels/directories.js";
import { dashboardUrl, factsPageUrl } from "../reporter/links.js";
import {
  correctionFollowUpEmail,
  correctionRequestEmail,
  ownerWebsiteInstructionEmail,
  ownerWebsiteReminderEmail,
  type CorrectionContext,
} from "./email-templates.js";
import { addDays, daysBetween, fixPathForFinding, isFindabilityFinding, type FixPath } from "./paths.js";

export * from "./paths.js";
export * from "./email-templates.js";

// ---------------------------------------------------------------------------
// scanner dependency (injectable for tests)
// ---------------------------------------------------------------------------

export interface RunScanOptions {
  businessId: string;
  kind: "free" | "baseline" | "monthly" | "recheck" | "ondemand";
  engines?: Engine[];
  samplesPerPrompt?: number;
  promptIds?: string[];
  /** share the fixer's db handle with the scanner */
  db?: Db;
}
export type RunScanFn = (opts: RunScanOptions) => Promise<ScanReport>;

export interface FixerDeps {
  runScan?: RunScanFn;
  now?: () => Date;
  /** businesses already republished in this batch (openFixesForScan fills it so one scan run republishes once) */
  republished?: Set<string>;
}

async function defaultRunScan(opts: RunScanOptions): Promise<ScanReport> {
  const mod = (await import("../scanner/index.js")) as unknown as { runScan: RunScanFn };
  return mod.runScan(opts);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export interface FixOutcome {
  fix: Fix;
  finding: Finding;
  path: FixPath;
  action: FixAction;
  executed: boolean;
  note?: string;
}

function hostMatches(url: string | null, patterns: string[]): boolean {
  const host = hostOfUrl(url);
  return !!host && patterns.some((p) => host === p || host.endsWith(`.${p}`));
}

/** Pick the channel that carries a finding's source URL. */
function channelForFinding(finding: Finding, channels: Channel[]): Channel | null {
  if (hostMatches(finding.sourceUrl, ["google.com", "google.nl", "maps.google.com", "business.google.com"])) return channels.find((c) => c.type === "gbp") ?? null;
  if (hostMatches(finding.sourceUrl, ["bing.com", "bingplaces.com"])) return channels.find((c) => c.type === "bing") ?? null;
  if (hostMatches(finding.sourceUrl, ["apple.com", "maps.apple.com"])) return channels.find((c) => c.type === "apple") ?? null;
  const host = hostOfUrl(finding.sourceUrl);
  if (host) {
    const byUrl = channels.find((c) => c.type === "directory" && c.url && hostOfUrl(c.url) === host);
    if (byUrl) return byUrl;
    const dir = finding.sourceUrl ? directoryForUrl(finding.sourceUrl) : undefined;
    if (dir) return channels.find((c) => c.type === "directory" && c.name === dir.name) ?? null;
  }
  return null;
}

function correctionContext(business: BusinessRecord): CorrectionContext {
  return { business: { name: business.name, place: business.place, ownerEmail: business.ownerEmail, kvk: business.kvk }, factsPageUrl: factsPageUrl(business) };
}

/** Where a correction request for a third-party source goes. */
function thirdPartyAddress(finding: Finding): { to: string | null; guessed: boolean } {
  const dir = finding.sourceUrl ? directoryForUrl(finding.sourceUrl) : undefined;
  if (dir?.contactEmail) return { to: dir.contactEmail, guessed: false };
  const host = hostOfUrl(finding.sourceUrl);
  if (host && isMock()) return { to: `info@${host}`, guessed: true };
  return { to: null, guessed: true };
}

/** Prompts that probe the finding's fact (category + subject). */
export function affectedPrompts(finding: Pick<Finding, "factKey" | "subject"> & Partial<Pick<Finding, "evidenceKind">>, prompts: Prompt[]): Prompt[] {
  const kind = finding.evidenceKind ?? "about";
  const active = prompts.filter((p) => p.active && (p.kind ?? "about") === kind);
  const byCategory = active.filter((p) => p.category === finding.factKey);
  if (!finding.subject) return byCategory;
  const subj = finding.subject.toLowerCase();
  const specific = byCategory.filter((p) => p.probes.some((probe) => probe.toLowerCase() === `${finding.factKey}.${subj}` || probe.toLowerCase() === `${finding.factKey}:${subj}` || probe.toLowerCase().endsWith(`.${subj}`) || probe.toLowerCase().endsWith(`:${subj}`)));
  return specific.length ? specific : byCategory;
}

/** True when the recheck report still carries this finding's wrong value. */
export function stillPresent(finding: Finding, report: ScanReport): boolean {
  return report.findings.some(
    (f) =>
      f.id === finding.id ||
      (f.engine === finding.engine &&
        f.factKey === finding.factKey &&
        (f.subject ?? null) === (finding.subject ?? null) &&
        (f.verdict ?? "wrong") === (finding.verdict ?? "wrong") &&
        (f.evidenceKind ?? "about") === (finding.evidenceKind ?? "about") &&
        f.status !== "resolved"),
  );
}

// ---------------------------------------------------------------------------
// opening fixes
// ---------------------------------------------------------------------------

export async function escalateToOperator(fix: Fix, reason: string, payload: Record<string, unknown> = {}): Promise<void> {
  const db = getDb();
  const finding = await db.getFinding(fix.findingId);
  const businessId = finding?.businessId ?? (payload.businessId as string | undefined) ?? null;
  await db.enqueueJob("operator_task", { reason, fixId: fix.id, findingId: fix.findingId, businessId, ...payload });
  await db.updateFix(fix.id, { evidence: { ...fix.evidence, escalatedAt: new Date().toISOString(), escalationReason: reason } });
  await db.logEvent(businessId, "fix.escalated", { fixId: fix.id, findingId: fix.findingId, reason });
  log.info("fix.escalated", { fixId: fix.id, reason });
}

export async function openFixesForScan(scanRunId: string, deps: FixerDeps = {}): Promise<FixOutcome[]> {
  const db = getDb();
  const findings = await db.listFindingsByScanRun(scanRunId);
  const out: FixOutcome[] = [];
  const batchDeps: FixerDeps = { ...deps, republished: deps.republished ?? new Set<string>() };
  for (const f of findings) {
    if (f.status !== "open") continue;
    try {
      out.push(await openFixForFinding(f, batchDeps));
    } catch (err) {
      log.error("fix.open.failed", { findingId: f.id, error: errorMessage(err) });
    }
  }
  log.info("fixes.opened", { scanRunId, count: out.length });
  return out;
}

export async function openFixForFinding(finding: Finding, deps: FixerDeps = {}): Promise<FixOutcome> {
  const db = getDb();
  const now = deps.now?.() ?? new Date();
  const existing = (await db.listFixes(finding.id)).find((x) => x.resolvedAt === null);
  const path = fixPathForFinding(finding);
  if (existing) {
    return { fix: existing, finding, path, action: existing.action, executed: false, note: "fix already open" };
  }
  const business = await db.getBusiness(finding.businessId);
  if (!business) throw new Error(`business ${finding.businessId} not found`);
  const w = findingWordsNl(finding);
  // not_found, or not named in a recommendation without a cited source: make the fact findable.
  const notFound = isFindabilityFinding(finding);
  const target = finding.sourceUrl ?? (notFound || finding.sourceType === "owned_facts_page" || finding.sourceType === "other_entity" ? factsPageUrl(business) : finding.sourceType);

  let fix = await db.insertFix({
    findingId: finding.id,
    action: path.action,
    target,
    scheduledAt: now.toISOString(),
    recheckAt: addDays(now, path.recheckDays).toISOString(),
    evidence: { sourceType: finding.sourceType, verdict: finding.verdict, wrong: w.wrong, correct: w.correct, path: path.action },
  });

  let executed = false;
  let note: string | undefined;
  const ev: Record<string, unknown> = { ...fix.evidence };

  try {
    if (notFound) {
      // Make the business findable: facts page + every channel + directory discovery.
      if (deps.republished?.has(business.id)) {
        ev.publish = { dedupedInBatch: true, at: now.toISOString() };
      } else {
        const pub = await publishFactsPage(business.id);
        deps.republished?.add(business.id);
        ev.publish = { url: pub.url, factsVersion: pub.factsVersion, at: now.toISOString() };
      }
      await ensurePlatformChannels(business.id);
      const discovered = await discoverDirectories(business.id);
      const sync = await syncAllChannels(business.id);
      ev.discover = discovered.map((c) => c.name);
      ev.sync = sync.results.map((r) => ({ channel: r.channelId, status: r.status }));
      executed = true;
      note = "Not found: facts page published, channels synced, directories discovered.";
    } else
    switch (path.action) {
      case "republish": {
        if (deps.republished?.has(business.id)) {
          ev.publish = { dedupedInBatch: true, at: now.toISOString() };
        } else {
          const pub = await publishFactsPage(business.id);
          deps.republished?.add(business.id);
          ev.publish = { url: pub.url, factsVersion: pub.factsVersion, at: now.toISOString() };
        }
        if (finding.sourceType === "other_entity") {
          const sync = await syncAllChannels(business.id);
          ev.sync = sync.results.map((r) => ({ channel: r.channelId, status: r.status }));
          note = "Disambiguation republished and place synced everywhere.";
        }
        executed = true;
        break;
      }
      case "sync": {
        const channels = await db.listChannels(business.id);
        const channel = channelForFinding(finding, channels);
        if (!channel) {
          await escalateToOperator(fix, "no_channel_for_source", { sourceUrl: finding.sourceUrl, wrong: w.wrong, correct: w.correct });
          note = "No channel matches the source; operator task created.";
          break;
        }
        const facts = await db.latestFacts(business.id);
        if (!facts) throw new Error("no facts");
        const res = await syncOneChannel(channel, facts, business);
        ev.sync = { channelId: channel.id, status: res.status, diff: res.diff, evidence: res.evidence };
        if (res.status === "failed") await escalateToOperator(fix, "sync_rejected", { channelId: channel.id, evidence: res.evidence });
        executed = res.status === "synced" || res.status === "pending";
        break;
      }
      case "form": {
        const channels = await db.listChannels(business.id);
        const channel = channelForFinding(finding, channels);
        const dir = finding.sourceUrl ? directoryForUrl(finding.sourceUrl) : undefined;
        await escalateToOperator(fix, "directory_form", {
          directory: dir?.domain ?? hostOfUrl(finding.sourceUrl),
          listingUrl: finding.sourceUrl,
          channelId: channel?.id ?? null,
          diff: [{ field: w.field, current: w.wrong, expected: w.correct }],
          factsPageUrl: factsPageUrl(business),
        });
        ev.form = { mode: "operator", at: now.toISOString() };
        executed = true;
        note = "Form submission handed to operator (no browser agent yet).";
        break;
      }
      case "email": {
        const { to, guessed } = thirdPartyAddress(finding);
        const m = correctionRequestEmail(finding, correctionContext(business));
        if (!to) {
          await escalateToOperator(fix, "lookup_contact_address", { sourceUrl: finding.sourceUrl, draft: m });
          note = "No contact address known; operator looks it up.";
          break;
        }
        await db.enqueueJob("email", {
          to,
          subject: m.subject,
          text: m.text,
          replyTo: business.ownerEmail ?? undefined,
          businessId: business.id,
          findingId: finding.id,
          fixId: fix.id,
          kind: "correction_request",
        });
        ev.email = { to, guessed, subject: m.subject, queuedAt: now.toISOString(), followUpsSent: [] };
        fix = await db.updateFix(fix.id, { sentAt: now.toISOString() });
        executed = true;
        break;
      }
      case "manual": {
        // owned_website: instruct the owner
        if (business.ownerEmail) {
          const m = ownerWebsiteInstructionEmail(finding, business, dashboardUrl(business), business.language);
          await db.enqueueJob("email", { to: business.ownerEmail, subject: m.subject, text: m.text, lang: business.language, businessId: business.id, findingId: finding.id, fixId: fix.id, kind: "owner_instruction" });
          ev.ownerMail = { subject: m.subject, queuedAt: now.toISOString(), remindersSent: [] };
          fix = await db.updateFix(fix.id, { sentAt: now.toISOString() });
          executed = true;
        } else {
          await escalateToOperator(fix, "owner_email_missing");
          note = "Owner has no e-mail; operator task created.";
        }
        break;
      }
      case "none":
      default: {
        ev.note = "uit het geheugen van het model";
        note = "Model memory: nothing to fix at the source; recheck after the window.";
        executed = true;
        break;
      }
    }
  } catch (err) {
    ev.error = errorMessage(err);
    log.error("fix.execute.failed", { fixId: fix.id, action: path.action, error: ev.error });
    await escalateToOperator(fix, "action_failed", { error: ev.error, action: path.action });
  }

  fix = await db.updateFix(fix.id, { evidence: ev });
  const updated = await db.updateFindingStatus(finding.id, "fixing");
  await db.logEvent(business.id, "fix.opened", { fixId: fix.id, findingId: finding.id, action: path.action, executed, recheckAt: fix.recheckAt, note: note ?? null });
  log.info("fix.opened", { fixId: fix.id, findingId: finding.id, action: path.action, executed, recheckAt: fix.recheckAt });
  return { fix, finding: updated, path, action: path.action, executed, note };
}

// ---------------------------------------------------------------------------
// rechecks
// ---------------------------------------------------------------------------

export interface RecheckOutcome {
  fixId: string;
  findingId: string;
  result: "resolved" | "still_wrong" | "unfixable" | "skipped";
  scanRunId: string | null;
  nextRecheckAt: string | null;
  step?: string;
}

export async function runRecheck(fixId: string, deps: FixerDeps = {}): Promise<RecheckOutcome> {
  const db = getDb();
  const now = deps.now?.() ?? new Date();
  const runScan = deps.runScan ?? defaultRunScan;
  let fix = await getFix(fixId);
  if (!fix) log.warn("recheck.fix_missing", { fixId });
  const finding = fix ? await db.getFinding(fix.findingId) : null;
  if (!fix || !finding) return { fixId, findingId: fix?.findingId ?? "", result: "skipped", scanRunId: null, nextRecheckAt: null, step: "fix or finding not found" };
  if (finding.status === "resolved" || finding.status === "unfixable" || fix.resolvedAt) {
    return { fixId, findingId: finding.id, result: "skipped", scanRunId: null, nextRecheckAt: null, step: `finding is ${finding.status}` };
  }
  const business = await db.getBusiness(finding.businessId);
  if (!business) throw new Error(`business ${finding.businessId} not found`);
  const path = fixPathForFinding(finding);

  const prompts = affectedPrompts(finding, await db.listPrompts(business.id, { activeOnly: true }));
  const report = await runScan({
    businessId: business.id,
    kind: "recheck",
    promptIds: prompts.map((p) => p.id),
    engines: [finding.engine],
    samplesPerPrompt: 10,
    db,
  });
  const ev: Record<string, unknown> = { ...fix.evidence, recheckScanRunId: report.scanRunId, lastRecheckAt: now.toISOString() };
  const history = Array.isArray(ev.rechecks) ? (ev.rechecks as unknown[]) : [];

  if (!stillPresent(finding, report)) {
    const samples = await db.listSamples(report.scanRunId);
    const promptIds = new Set(prompts.map((p) => p.id));
    const after = samples.find((s) => s.engine === finding.engine && promptIds.has(s.promptId)) ?? samples[0] ?? null;
    await db.markFindingResolved(finding.id, after?.id ?? null);
    ev.rechecks = [...history, { at: now.toISOString(), scanRunId: report.scanRunId, outcome: "resolved" }];
    await db.updateFix(fix.id, { resolvedAt: now.toISOString(), recheckAt: null, evidence: ev });
    await db.logEvent(business.id, "finding.resolved", { findingId: finding.id, fixId: fix.id, scanRunId: report.scanRunId, evidenceAfter: after?.id ?? null, days: daysBetween(finding.firstSeenAt, now) });
    await db.enqueueJob("email", { template: "resolution", findingId: finding.id, businessId: business.id });
    log.info("recheck.resolved", { fixId: fix.id, findingId: finding.id, scanRunId: report.scanRunId });
    return { fixId: fix.id, findingId: finding.id, result: "resolved", scanRunId: report.scanRunId, nextRecheckAt: null };
  }

  // Still wrong: next step.
  const age = daysBetween(finding.firstSeenAt, now);
  ev.rechecks = [...history, { at: now.toISOString(), scanRunId: report.scanRunId, outcome: "still_wrong" }];

  if (path.unfixableAfterDays != null && age >= path.unfixableAfterDays) {
    const note = path.unfixableNoteNl ?? "De bron is niet aangepast.";
    await db.updateFindingStatus(finding.id, "unfixable");
    await db.updateFix(fix.id, { resolvedAt: now.toISOString(), recheckAt: null, evidence: { ...ev, outcome: "unfixable", note } });
    await db.logEvent(business.id, "finding.unfixable", { findingId: finding.id, fixId: fix.id, note, days: age });
    await db.enqueueJob("email", { template: "unfixable", findingId: finding.id, businessId: business.id, note });
    log.info("recheck.unfixable", { fixId: fix.id, findingId: finding.id, days: age });
    return { fixId: fix.id, findingId: finding.id, result: "unfixable", scanRunId: report.scanRunId, nextRecheckAt: null, step: "unfixable" };
  }

  let step = "recheck_again";
  const sentAt = fix.sentAt ? new Date(fix.sentAt) : null;
  const sinceSent = sentAt ? daysBetween(sentAt, now) : age;
  switch (path.escalation) {
    case "followup_email": {
      const mail = (ev.email ?? {}) as { to?: string; followUpsSent?: string[] };
      const sent = mail.followUpsSent ?? [];
      const due = (path.followUpDays ?? []).find((d) => sinceSent >= d && !sent.includes(String(d)));
      if (due != null && mail.to) {
        const m = correctionFollowUpEmail(finding, correctionContext(business), fix.sentAt ?? finding.firstSeenAt);
        await db.enqueueJob("email", { to: mail.to, subject: m.subject, text: m.text, replyTo: business.ownerEmail ?? undefined, businessId: business.id, findingId: finding.id, fixId: fix.id, kind: "correction_followup" });
        ev.email = { ...mail, followUpsSent: [...sent, String(due)] };
        step = `followup_email_${due}`;
      } else if ((path.followUpDays ?? []).every((d) => sent.includes(String(d)))) {
        step = "waiting_for_window";
      }
      break;
    }
    case "reminder": {
      const mail = (ev.ownerMail ?? {}) as { remindersSent?: string[] };
      const sent = mail.remindersSent ?? [];
      const due = (path.followUpDays ?? []).find((d) => sinceSent >= d && !sent.includes(String(d)));
      if (due != null && business.ownerEmail) {
        const m = ownerWebsiteReminderEmail(finding, business, dashboardUrl(business), due, business.language);
        await db.enqueueJob("email", { to: business.ownerEmail, subject: m.subject, text: m.text, lang: business.language, businessId: business.id, findingId: finding.id, fixId: fix.id, kind: "owner_reminder" });
        ev.ownerMail = { ...mail, remindersSent: [...sent, String(due)] };
        step = `owner_reminder_${due}`;
      }
      break;
    }
    case "operator": {
      if (!ev.escalatedAt) {
        fix = await db.updateFix(fix.id, { evidence: ev });
        await escalateToOperator(fix, "still_wrong_after_recheck", { scanRunId: report.scanRunId, sourceUrl: finding.sourceUrl });
        ev.escalatedAt = now.toISOString();
        step = "operator";
      }
      break;
    }
    case "resync": {
      // Not found: sync everything once more and come back at the follow-up day (45), then every recheckDays.
      const sync = await syncAllChannels(business.id);
      const resyncs = Array.isArray(ev.resyncs) ? (ev.resyncs as unknown[]) : [];
      ev.resyncs = [...resyncs, { at: now.toISOString(), results: sync.results.map((r) => ({ channel: r.channelId, status: r.status })) }];
      step = "resync";
      break;
    }
    case "model_release":
    default:
      step = "wait_for_model_release";
      break;
  }

  let nextRecheckAt = addDays(now, path.recheckDays).toISOString();
  if (path.escalation === "resync") {
    const followUp = (path.followUpDays ?? []).map((d) => addDays(finding.firstSeenAt, d)).find((d) => d.getTime() > now.getTime());
    if (followUp) nextRecheckAt = followUp.toISOString();
  }
  await db.updateFix(fix.id, { recheckAt: nextRecheckAt, evidence: ev });
  await db.updateFindingStatus(finding.id, "recheck");
  await db.logEvent(business.id, "finding.still_wrong", { findingId: finding.id, fixId: fix.id, scanRunId: report.scanRunId, step, nextRecheckAt });
  log.info("recheck.still_wrong", { fixId: fix.id, findingId: finding.id, step, nextRecheckAt });
  return { fixId: fix.id, findingId: finding.id, result: "still_wrong", scanRunId: report.scanRunId, nextRecheckAt, step };
}

/** Run every due recheck (cron). */
export async function runDueRechecks(deps: FixerDeps = {}): Promise<RecheckOutcome[]> {
  const due = await getDb().listDueRechecks(deps.now?.() ?? new Date());
  const out: RecheckOutcome[] = [];
  for (const fix of due) {
    try {
      out.push(await runRecheck(fix.id, deps));
    } catch (err) {
      log.error("recheck.failed", { fixId: fix.id, error: errorMessage(err) });
    }
  }
  return out;
}
