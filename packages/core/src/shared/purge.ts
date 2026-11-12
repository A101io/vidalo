/**
 * The one way a business is removed for its owner or for retention (feature 002, ADR-0005).
 * Called inline by "Verwijder alles" (guard no_subscription) and by the worker's purge job (guard
 * due, or the web's fallback). The database guards the delete itself (Db.purgeBusiness); this
 * module decides the order of the side effects around it.
 */
import type { BusinessRecord, Db, PurgeGuard } from "../db/types.js";
import { listMemberBusinesses, listMemberUserIds } from "../db/owner-area.js";
import { disconnectGoogle } from "./google-revoke.js";
import { log } from "./log.js";
import { purgeAllowed } from "./deletion.js";
import { clearServeCache } from "../publisher/serve.js";
import { defaultFactsHost } from "../publisher/render.js";

export interface PurgeDeps {
  db: Db;
  now: Date;
  /** VIDALO_PURGE unset. Holds back only guard "due" with delete_reason "retention" (F-010): an owner's own request always deletes. */
  dryRunRetention: boolean;
  /** True when Stripe lists any subscription of this customer that is not canceled/incomplete_expired (F-021). Throws when Stripe cannot be asked. */
  stripeLive(customerId: string): Promise<boolean>;
  /** V-SEC-04: expires the customer's open Checkout Sessions, so none completes after the deletion. Returns how many. Throws when Stripe cannot be asked. */
  expireOpenCheckouts(customerId: string): Promise<number>;
  /** Revoke at Google; invalid_token counts as done. */
  revokeGoogle(token: string): Promise<void>;
  /** The custom facts host's Cloudflare hostname and Worker route. */
  deleteCustomHostname(host: string): Promise<void>;
  /** Supabase Admin: delete the login. */
  deleteLogin(userId: string): Promise<void>;
  /** googleRevoked: a Google connection existed and was revoked at Google (V-COMP-10); the mail says so only then. */
  sendDeletedMail(to: { email: string; language: "nl" | "en"; businessName: string; googleRevoked: boolean; loginDeleted: boolean }): Promise<void>;
  /** Our own fallback facts host for this business (publisher/host.ts isOwnFactsHost), never sent to Cloudflare. */
  isOwnFactsHost?(host: string, b: BusinessRecord): boolean;
  /** The address the confirmation goes to when it is not the business's owner address (the requester's login). */
  mailTo?: string | null;
}

export type PurgeOutcome =
  | { done: true; loginsDeleted: number; mailed: boolean }
  | { done: false; reason: "not_found" | "guard" | "stripe_live" | "dry_run" };

export { purgeAllowed };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function purgeBusiness(deps: PurgeDeps, businessId: string, guard: PurgeGuard): Promise<PurgeOutcome> {
  const { db, now } = deps;
  const b = await db.getBusiness(businessId);
  if (!b) return { done: false, reason: "not_found" };
  if (!purgeAllowed(b, guard, now)) return { done: false, reason: "guard" };
  // Stripe first: our database can say churned while Stripe still bills (F-021).
  if (b.stripeCustomerId && (await deps.stripeLive(b.stripeCustomerId))) {
    log.warn("retention.stripe_live", { businessId });
    return { done: false, reason: "stripe_live" };
  }
  if (guard === "due" && b.deleteReason === "retention" && deps.dryRunRetention) {
    log.info("retention.would_purge", { businessId });
    return { done: false, reason: "dry_run" };
  }
  // A checkout still open (an add-on, a report's "Koop") could complete after the row is gone and bill nobody's business (V-SEC-04).
  if (b.stripeCustomerId) {
    const expired = await deps.expireOpenCheckouts(b.stripeCustomerId);
    if (expired) log.info("purge.checkouts_expired", { businessId, count: expired });
  }
  // What is needed after the row is gone, read now.
  // Membership through lane B's owner-area module; if it cannot answer, the recorded owner (F-A5).
  const members = (await listMemberUserIds(db, b.id).catch(() => [] as string[])).filter((u): u is string => typeof u === "string" && u.length > 0);
  if (!members.length && b.ownerUserId) members.push(b.ownerUserId);
  const mailTo = deps.mailTo ?? b.ownerEmail;
  const language = b.language;
  const businessName = b.name;

  // Google: revoked at Google; a failure is logged and the token goes with the row.
  const google = await disconnectGoogle(db, b.id, deps.revokeGoogle, "purge");
  const googleRevoked = google.disconnected > 0 && !google.revokeFailed;

  // The custom facts host, only when this business is its verified holder and it is not ours (F-019).
  if (b.factsHost) {
    const holder = b.factsHostVerifiedAt ? await db.getBusinessByFactsHost(b.factsHost) : null;
    const own = deps.isOwnFactsHost?.(b.factsHost, b) ?? false;
    if (holder?.id === b.id && !own) await deps.deleteCustomHostname(b.factsHost); // a failure throws: nothing deleted yet, the job retries
    else log.info("purge.host_skipped", { businessId, reason: own ? "own" : b.factsHostVerifiedAt ? "other_holder" : "unverified" });
  }

  if (!(await db.purgeBusiness(b.id, guard, now))) return { done: false, reason: "guard" };
  // This isolate's facts-page cache forgets it now; other isolates re-read the business on their next hit (V-QA-03).
  for (const host of [b.factsHost, defaultFactsHost(b)]) if (host) clearServeCache(host);

  let loginsDeleted = 0;
  let loginPending = false;
  for (const userId of members) {
    // When membership cannot be read, the login is kept: deleting it is the one step that cannot wait for support.
    const left = await listMemberBusinesses(db, userId).catch(() => null);
    if (left === null || left.length > 0) {
      log.info("account.login_kept", {});
      continue;
    }
    await db.deleteSignIns(userId);
    if (!UUID.test(userId)) continue; // a mock login has no Supabase user
    try {
      await deps.deleteLogin(userId);
      loginsDeleted++;
      await deleteAuditRows(db, userId);
    } catch (err) {
      // The business is gone, so this purge cannot be retried: a job of its own retries the login (R2, V2-COMP-01),
      // counted in the overdue line until it succeeds, and the mail does not say it is done.
      log.warn("account.login_delete_failed", { status: err instanceof Error ? (/\d{3}/.exec(err.message)?.[0] ?? null) : null });
      await db.enqueueJob("login_delete", { userId });
      loginPending = true;
    }
  }

  let mailed = false;
  if (mailTo) {
    try {
      await deps.sendDeletedMail({ email: mailTo, language, businessName, googleRevoked, loginDeleted: !loginPending });
      mailed = true;
    } catch {
      log.warn("account.deleted_mail_failed", {});
    }
  }
  await db.logEvent(null, "account.deleted", { guard, loginsDeleted });
  log.info("account.deleted", { guard, loginsDeleted });
  return { done: true, loginsDeleted, mailed };
}

/**
 * Supabase's own record of the login (V-COMP-06, R3): each sign-in (IP address, browser) and the user_deleted row
 * the deletion itself writes, so it runs after deleteLogin. A failure is logged; the rows stay for support to remove.
 */
export async function deleteAuditRows(db: Db, userId: string): Promise<void> {
  try {
    await db.deleteAuthAuditLog(userId);
  } catch (err) {
    log.warn("account.audit_log_delete_failed", { error: err instanceof Error ? err.name : "unknown" });
  }
}
