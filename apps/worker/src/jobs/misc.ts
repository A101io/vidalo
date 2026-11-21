import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import { checkGoogleIndex, publishFactsPage, runSiteCheck, syncAllChannels } from "@vidalo/core/publisher";
import { openFixesForScan, runRecheck, directoryCorrectionEmail } from "@vidalo/core/fixer";
import {
  sendMail,
  sendBaselineSummary,
  sendFollowUp,
  sendMonthlyReport,
  sendResolutionNotice,
  sendFactsReconfirm,
  sendUnfixableNotice,
  sendWelcome,
  sendOrderConfirmation,
  sendOwnerText,
  factsPageUrl,
  textToHtml,
  sendDeletionReminder,
} from "@vidalo/core/reporter";
import { scannableLineMarkets } from "@vidalo/core/shared";
import { amsterdamParts } from "../cron.js";
import { getDb, runScan } from "../compat.js";
import { log } from "../log.js";
import type { Handler } from "./types.js";

export const publish: Handler<"publish"> = async (p) => {
  const r = await publishFactsPage(p.businessId);
  return { host: r.host, url: r.url, factsVersion: r.factsVersion, verified: r.verified };
};

export const sync: Handler<"sync"> = async (p) => {
  const r = await syncAllChannels(p.businessId, { channelIds: p.channelIds });
  return { channels: r.results.map((x) => ({ id: x.channelId, type: x.channelType, status: x.status, diff: x.diff.length })) };
};

export const sitecheck: Handler<"sitecheck"> = async (p) => {
  const r = await runSiteCheck(p.businessId);
  return { skipped: r.skipped ?? null, issues: r.result?.issues.map((i) => i.kind) ?? [], newIssues: r.newIssues, notified: r.notified };
};

export const indexCheck: Handler<"index_check"> = async (p) => {
  const r = await checkGoogleIndex(p.businessId);
  return { skipped: r.skipped ?? null, failedAt: r.failedAt ?? null, indexed: r.indexed, verdict: r.state?.inspection?.verdict ?? null };
};

export const fixes: Handler<"fixes"> = async (p) => {
  const out = await openFixesForScan(p.scanRunId, { runScan });
  return { opened: out.length, actions: out.map((o) => ({ fixId: o.fix.id, action: o.action, executed: o.executed })) };
};

export const recheck: Handler<"recheck"> = async (p) => {
  const out = await runRecheck(p.fixId, { runScan });
  return { result: out.result, step: out.step ?? null, scanRunId: out.scanRunId, nextRecheckAt: out.nextRecheckAt };
};

/** Feature 006: the monthly mail waits for the month's line runs, a bounded number of times (ADR-0010). */
export const LINE_REPORT_WAIT_MINUTES = 15;
export const LINE_REPORT_MAX_WAITS = 8;

/** The expected (line, market) runs of this month that are not finished yet (missing, queued or running). */
async function missingLineRuns(p: { businessId: string; lines?: { productLineId: string; market: string }[] }, now: Date): Promise<number> {
  const db = getDb();
  // Never wider than what the business may have now: the list is narrowed to today's active lines within the limits.
  const allowed = new Set(scannableLineMarkets(await db.listProductLines(p.businessId)).map((l) => `${l.productLineId}|${l.market}`));
  const month = amsterdamParts(now);
  let missing = 0;
  for (const want of (p.lines ?? []).slice(0, 40)) {
    if (typeof want?.productLineId !== "string" || typeof want.market !== "string" || !allowed.has(`${want.productLineId}|${want.market}`)) continue;
    const run = (await db.listScanRuns(p.businessId, 50, { productLineId: want.productLineId, market: want.market })).find((r) => {
      const at = amsterdamParts(new Date(r.startedAt));
      return r.kind === "monthly" && at.y === month.y && at.m === month.m;
    });
    if (!run || (run.status !== "done" && run.status !== "failed")) missing++;
  }
  return missing;
}

export const report: Handler<"report"> = async (p) => {
  // `waited` is ours to count, never the payload's to set: at most LINE_REPORT_MAX_WAITS, then the mail goes with what exists.
  const waited = Math.min(LINE_REPORT_MAX_WAITS, Math.max(0, Math.floor(Number(p.waited) || 0)));
  if (p.lines?.length && waited < LINE_REPORT_MAX_WAITS) {
    const missing = await missingLineRuns(p, new Date());
    if (missing > 0) {
      const db = getDb();
      await db.enqueueJob("report", { ...p, waited: waited + 1 }, new Date(Date.now() + LINE_REPORT_WAIT_MINUTES * 60_000));
      await db.logEvent(p.businessId, "report.waiting", { waited: waited + 1, missing });
      return { sent: false, waiting: true, waited: waited + 1, missing };
    }
  }
  const r = await sendMonthlyReport(p.businessId, { scanRunId: p.scanRunId });
  return { sent: r !== null, mode: r?.mode ?? null };
};

export const followup: Handler<"followup"> = async (p) => {
  const r = await sendFollowUp(p.businessId, p.day);
  return { sent: r !== null, mode: r?.mode ?? null };
};

/** Owner mails queued as plain text get the branded HTML; mails to directories and websites stay plain letters signed by the owner. */
const OWNER_TEXT_KINDS = new Set(["owner_instruction", "owner_reminder", "site_instruction"]);

export const email: Handler<"email"> = async (p) => {
  if (!("template" in p) || p.template === undefined) {
    const owner = !!p.kind && OWNER_TEXT_KINDS.has(p.kind);
    // An owner mail carries the owner's language (business.language); letters to third parties are Dutch, with no tag.
    const lang = p.lang === "en" ? "en" : "nl";
    // Owner mails go through the reporter, which checks the owner's mail preferences and uses the current address.
    if (p.businessId && p.kind && owner) {
      const r = await sendOwnerText(p.businessId, p.kind, { subject: p.subject, text: p.text, html: p.html ?? textToHtml(p.text, lang) }, { findingId: p.findingId ?? null, fixId: p.fixId ?? null });
      return { mode: r?.mode ?? null, id: r?.id ?? null };
    }
    const html = p.html ?? (owner ? textToHtml(p.text, lang) : undefined);
    const r = await sendMail({ to: p.to, subject: p.subject, text: p.text, html, replyTo: p.replyTo, tags: p.kind ? { kind: p.kind, ...(owner ? { lang } : {}) } : undefined });
    if (p.businessId) await getDb().logEvent(p.businessId, `email.${p.kind ?? "raw"}`, { to: p.to, subject: p.subject, mode: r.mode, id: r.id, findingId: p.findingId ?? null, fixId: p.fixId ?? null });
    return { mode: r.mode, id: r.id };
  }
  switch (p.template) {
    case "resolution":
      return { mode: (await sendResolutionNotice(p.findingId))?.mode ?? null };
    case "unfixable":
      return { mode: (await sendUnfixableNotice(p.findingId, p.note))?.mode ?? null };
    case "welcome":
      return { mode: (await sendWelcome(p.businessId))?.mode ?? null };
    case "order_confirmation":
      return { mode: (await sendOrderConfirmation(p))?.mode ?? null };
    case "baseline":
      return { mode: (await sendBaselineSummary(p.scanRunId, p.to ? { email: p.to, lang: p.lang === "en" ? "en" : "nl" } : undefined))?.mode ?? null };
    case "report":
      return { mode: (await sendMonthlyReport(p.businessId, { scanRunId: p.scanRunId }))?.mode ?? null };
    case "followup":
      return { mode: (await sendFollowUp(p.businessId, p.day))?.mode ?? null };
    case "reconfirm":
      return { mode: (await sendFactsReconfirm(p.businessId))?.mode ?? null };
    case "deletion_reminder": {
      // Re-read: a business that resubscribed or signed in since has no retention date any more.
      const b = await getDb().getBusiness(p.businessId);
      if (!b || b.deleteReason !== "retention") return { skipped: "no_retention_date" };
      return { sent: await sendDeletionReminder(b) };
    }
    case "directory_correction": {
      const db = getDb();
      const business = await db.getBusiness(p.businessId);
      if (!business) throw new Error(`business ${p.businessId} not found`);
      const m = directoryCorrectionEmail(
        p.directory,
        p.listingUrl ?? null,
        p.diff,
        { business: { name: business.name, place: business.place, ownerEmail: business.ownerEmail, kvk: business.kvk }, factsPageUrl: factsPageUrl(business) },
        p.reminder ? { reminderOf: p.firstSentAt ?? null } : {},
      );
      const r = await sendMail({ to: p.to, subject: m.subject, text: m.text, replyTo: business.ownerEmail ?? undefined, tags: { kind: "directory_correction" } });
      await db.logEvent(business.id, "email.directory_correction", { to: p.to, directory: p.directory, channelId: p.channelId ?? null, reminder: p.reminder ?? false, mode: r.mode, id: r.id });
      return { mode: r.mode, id: r.id };
    }
    default:
      throw new Error(`unknown email template ${(p as { template: string }).template}`);
  }
};

/**
 * Operator queue: things a human must do (directory forms, lookups, rejected
 * syncs). Appended as JSON lines to out/operator/queue.jsonl and logged as an
 * event, so the dashboard/admin can list them later.
 */
export const operatorTask: Handler<"operator_task"> = async (p, job) => {
  await getDb().logEvent(p.businessId ?? null, "operator_task", { jobId: job.id, reason: p.reason, payload: p });
  log.info("operator_task.queued", { jobId: job.id, reason: p.reason, businessId: p.businessId ?? null });
  // The event is the record. The file is a convenience on a machine with a
  // disk; a Cloudflare Worker has none that outlives the invocation.
  if (onCloudflare()) return { event: "operator_task" };
  const dir = path.resolve(process.env.VIDALO_OUT_DIR ?? "out", "operator");
  await mkdir(dir, { recursive: true });
  const row = { id: job.id, at: new Date().toISOString(), ...p };
  await appendFile(path.join(dir, "queue.jsonl"), `${JSON.stringify(row)}\n`, "utf8");
  return { file: path.join(dir, "queue.jsonl") };
};

/** True inside a Cloudflare Worker (workerd sets this user agent). */
export function onCloudflare(): boolean {
  return (globalThis as { navigator?: { userAgent?: string } }).navigator?.userAgent === "Cloudflare-Workers";
}
