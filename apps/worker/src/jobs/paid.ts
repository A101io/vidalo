import type { BusinessStatus } from "@vidalo/core/types";
// The same handle the publisher and fixer use, so the guard sees what they act on.
import { getDb } from "@vidalo/core/shared";
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

/** null when the job may run; otherwise the reason it is skipped. */
export async function paidOnlyBlock(kind: JobKind, payload: Record<string, unknown>): Promise<string | null> {
  if (!PAID_ONLY.has(kind)) return null;
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
  if (!business.ownerVerifiedAt) {
    // Paid but not yet proven: the Google callback enqueues setup once it is.
    await getDb().logEvent(business.id, "job.skipped", { kind, reason: "owner_not_verified" });
    log.warn("job.skipped.owner_not_verified", { kind, businessId: business.id });
    return "owner_not_verified";
  }
  return null;
}
