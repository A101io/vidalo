/**
 * "Je gegevens" on /app/account: the owner downloads everything Vidalo holds
 * about their business (AVG art. 15 and 20) or has it deleted (art. 17).
 *
 * Deleting waits until the subscription has ended: while Stripe still bills,
 * the webhook would find no business and the service would stop without the
 * billing stopping. Invoices stay at Stripe for the fiscal retention period
 * (7 years); the privacy text says so.
 */
import type { Db } from "../db/types.js";
import type { BusinessStatus } from "../types.js";

/** Statuses with no running subscription. */
const DELETABLE: BusinessStatus[] = ["scanned", "churned"];

export function canDeleteMyData(status: BusinessStatus): boolean {
  return DELETABLE.includes(status);
}

/** Everything that hangs off one business, as one JSON-ready object. */
export async function exportMyData(db: Db, businessId: string, now: Date = new Date()) {
  const business = await db.getBusiness(businessId);
  if (!business) return null;
  const scanRuns = await db.listScanRuns(businessId, 10_000);
  const scans = [];
  for (const run of scanRuns) {
    const samples = await db.listSamples(run.id);
    const claims = await db.listClaims(samples.map((s) => s.id));
    scans.push({ ...run, samples, claims });
  }
  const findings = await db.listFindings(businessId);
  const fixes = (await Promise.all(findings.map((f) => db.listFixes(f.id)))).flat();
  return {
    exportedAt: now.toISOString(),
    business,
    facts: await db.listFacts(businessId),
    prompts: await db.listPrompts(businessId),
    scans,
    findings,
    fixes,
    channels: await db.listChannels(businessId),
    googleIndex: await db.getGoogleIndex(businessId),
    events: await db.listEvents(businessId, 10_000),
  };
}
