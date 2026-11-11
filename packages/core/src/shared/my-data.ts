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
import type { BusinessStatus, Channel } from "../types.js";

/**
 * The channel `meta` keys the owner's download may carry (feature 002, ADR-0006). An allow-list,
 * so a token or secret stored under any other key (refreshToken, accessToken, expiresAt, a key
 * added later) never reaches the file.
 */
export const CHANNEL_META_EXPORT_KEYS: readonly string[] = [
  "factsVersion", "verified", "lastSync", "lastDiff", "note", "correction", "pendingDiff", "diffApproval",
  "mode", "domain", "discovery", "factsPageUrl", "current", "url", "scope",
];

/** A channel as the download shows it: its own fields and only the allowed meta keys. */
export function exportChannel(c: Channel): Omit<Channel, "meta"> & { meta: Record<string, unknown> } {
  const meta: Record<string, unknown> = {};
  for (const k of CHANNEL_META_EXPORT_KEYS) if (c.meta && k in c.meta) meta[k] = c.meta[k];
  return { id: c.id, businessId: c.businessId, type: c.type, name: c.name, externalId: c.externalId, url: c.url, status: c.status, lastSyncedAt: c.lastSyncedAt, meta };
}

/** Statuses with no running subscription. */
const DELETABLE: BusinessStatus[] = ["scanned", "churned"];

export function canDeleteMyData(status: BusinessStatus): boolean {
  return DELETABLE.includes(status);
}

/** Everything that hangs off one business, as one JSON-ready object. */
export async function exportMyData(db: Db, businessId: string, now: Date = new Date(), opts: { userId?: string } = {}) {
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
    // What the understanding step decided and what the owner corrected (art. 15 and 20); each scan's own profile is on its run.
    profiles: { auto: business.profileAuto ?? null, owner: business.profileOwner ?? null },
    facts: await db.listFacts(businessId),
    prompts: await db.listPrompts(businessId),
    scans,
    findings,
    fixes,
    channels: (await db.listChannels(businessId)).map(exportChannel),
    googleIndex: await db.getGoogleIndex(businessId),
    // The login's last sign-ins (date, browser and system family; art. 15), feature 002.
    signIns: opts.userId ? await db.listSignIns(opts.userId, 10) : [],
    // Letters to directories go out in the owner's name to a directory's public address: those stay (AVG art. 15).
    events: (await db.listEvents(businessId, 10_000)).map((e) => (e.type === "email.directory_correction" ? e : { ...e, payload: ownAddressesOnly(e.payload, business.ownerEmail) })),
  };
}

/**
 * An event may name someone else's address: the person who asked for the free
 * report, a payer, a directory. The export goes to the owner, so only the
 * owner's own address stays (review CMP-03 / SEC-03).
 */
export function ownAddressesOnly(payload: Record<string, unknown>, ownerEmail: string | null | undefined): Record<string, unknown> {
  const own = ownerEmail?.trim().toLowerCase() || null;
  const foreign = (v: unknown) => typeof v === "string" && v.includes("@") && v.trim().toLowerCase() !== own;
  // Nested too: `owner.verified` keeps `previous.ownerEmail`, an earlier claimant's address.
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.filter((x) => !foreign(x)).map(walk);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) if (!foreign(x)) out[k] = walk(x);
      return out;
    }
    return v;
  };
  return walk(payload) as Record<string, unknown>;
}
