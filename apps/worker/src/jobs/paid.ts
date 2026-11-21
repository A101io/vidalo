import type { BusinessStatus } from "@vidalo/core/types";
// The same handle the publisher and fixer use, so the guard sees what they act on.
import { getDb, lineScanRefusal, ondemandRefusal, productLineAccess } from "@vidalo/core/shared";
import type { BusinessRecord } from "@vidalo/core/db";
import type { ScanKind } from "@vidalo/core/types";
import { log } from "../log.js";
import type { JobKind } from "./types.js";

/**
 * Jobs that publish or send something in the business's name. They run only
 * for a business that has paid AND whose owner proved ownership through their
 * Google Business Profile (shared/ownership.ts). Anyone can run a free scan
 * and type an e-mail address into a report; without both checks a stranger
 * could push their own "facts" to the facts page, the directories and
 * third-party sites in Vidalo's name.
 */
export const PAID_ONLY: ReadonlySet<JobKind> = new Set<JobKind>(["setup", "publish", "sync", "fixes", "fix", "recheck", "sitecheck", "index_check"]);
const PAYING: ReadonlySet<BusinessStatus> = new Set<BusinessStatus>(["trial", "active"]);

/** The business a paid-only job acts for, or null when it does not exist. */
async function businessFor(kind: JobKind, payload: Record<string, unknown>) {
  const db = getDb();
  if (kind === "fixes" || kind === "fix") {
    const run = await db.getScanRun(String(payload.scanRunId));
    return run ? db.getBusiness(run.businessId) : null;
  }
  if (kind === "recheck") {
    const fix = await db.getFix(String(payload.fixId));
    const finding = fix ? await db.getFinding(fix.findingId) : null;
    return finding ? db.getBusiness(finding.businessId) : null;
  }
  return db.getBusiness(String(payload.businessId));
}

/**
 * Feature 006: a product line's scan or recheck. Checked at run time, not only at enqueue (an owner may stop paying between
 * the cron and the job): the plan and the switch (productLineAccess), then the line itself: it exists, is this business's,
 * is active (a recheck may run on a discontinued line) and the market is one of its current markets (lineScanRefusal).
 * A refused job calls no engine.
 */
async function lineBlock(kind: JobKind, payload: Record<string, unknown>, business: BusinessRecord): Promise<string | null> {
  let line: { id: string | null; market: string | null; scanKind: ScanKind } | null = null;
  if (kind === "scan" && (payload.productLineId !== undefined || payload.market !== undefined)) {
    line = { id: typeof payload.productLineId === "string" ? payload.productLineId : null, market: typeof payload.market === "string" ? payload.market : null, scanKind: payload.kind as ScanKind };
  } else if (kind === "recheck") {
    const fix = await getDb().getFix(String(payload.fixId));
    const finding = fix ? await getDb().getFinding(fix.findingId) : null;
    if (finding?.productLineId) line = { id: finding.productLineId, market: finding.market ?? null, scanKind: "recheck" };
  }
  if (!line) return null;
  const db = getDb();
  const skip = async (reason: string) => {
    await db.logEvent(business.id, "job.skipped", { kind, reason });
    log.warn("job.skipped.line", { kind, businessId: business.id, reason });
    return reason;
  };
  if (!line.id || !line.market) return skip("line_needs_line_and_market");
  const access = productLineAccess(business, business.ownerUserId);
  if (!access.ok) return skip(`line_${access.reason}`);
  const refusal = lineScanRefusal(await db.getProductLine(line.id), business.id, line.market, line.scanKind);
  return refusal ? skip(`line_${refusal}`) : null;
}

/** null when the job may run; otherwise the reason it is skipped. */
export async function paidOnlyBlock(kind: JobKind, payload: Record<string, unknown>): Promise<string | null> {
  // "Controleer nu" spends a full check: same guard, and only on the monthly plan (review R-02).
  const ondemand = kind === "scan" && payload.kind === "ondemand";
  // A product line's monthly scan is a paid run too (feature 006): same guard as an on-demand check.
  const lineScan = kind === "scan" && (payload.productLineId !== undefined || payload.market !== undefined);
  if (!PAID_ONLY.has(kind) && !ondemand && !lineScan) return null;
  const business = await businessFor(kind, payload);
  if (!business) {
    // Fail closed: a job whose business cannot be found must not publish anything.
    log.warn("job.skipped.no_business", { kind, payload });
    return "no_business";
  }
  if (!PAYING.has(business.status)) {
    await getDb().logEvent(business.id, "job.skipped", { kind, reason: "not_paying", status: business.status });
    log.warn("job.skipped.not_paying", { kind, businessId: business.id, status: business.status });
    return `not_paying:${business.status}`;
  }
  if (business.pauseUntil && new Date(business.pauseUntil) > new Date()) {
    // The owner paused (core/billing/lifecycle.ts): nothing runs until the date they were given.
    await getDb().logEvent(business.id, "job.skipped", { kind, reason: "paused_by_owner", until: business.pauseUntil });
    return "paused_by_owner";
  }
  if (ondemand) {
    // The 7-day limit counts what actually ran (scan_run), so a double click or a burst of
    // other events cannot slip a second paid check through (review QA-03 / SEC-04).
    const refused = ondemandRefusal(business, await getDb().lastScanRunStartedAt(business.id, "ondemand"));
    if (refused) {
      await getDb().logEvent(business.id, "job.skipped", { kind, reason: `ondemand_${refused}`, plan: business.plan });
      return `ondemand_${refused}`;
    }
  }
  if (!business.ownerVerifiedAt) {
    // Paid but not yet proven: the Google callback enqueues setup once it is.
    await getDb().logEvent(business.id, "job.skipped", { kind, reason: "owner_not_verified" });
    log.warn("job.skipped.owner_not_verified", { kind, businessId: business.id });
    return "owner_not_verified";
  }
  return lineBlock(kind, payload, business);
}
