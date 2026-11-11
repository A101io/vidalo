/**
 * Feature 002, ADR-0005: the worker side of deleting a business.
 *  - `purge { businessId, guard }`: core/shared/purge.ts with the worker's own access to Stripe,
 *    Google, Cloudflare and Supabase Admin. VIDALO_PURGE holds back retention purges only (F-010).
 *  - `google_disconnect { businessId, reason }`: revoke at Google and delete the channel, after
 *    re-reading the business (a resubscribe before the job ran keeps the connection, SEC-49).
 * Payloads carry only ids and a word; never an address, a token or a host.
 */
import { getDb, purgeBusiness, disconnectGoogle, revokeGoogleToken, log, type PurgeDeps } from "@vidalo/core/shared";
import { deleteCustomHostname, isOwnFactsHost } from "@vidalo/core/publisher";
import { sendDeletedMail } from "@vidalo/core/reporter";
import type { Handler } from "./types.js";

const env = (k: string) => process.env[k]?.trim() || undefined;
const mock = () => process.env.VIDALO_MOCK === "1";

/** F-021: any subscription of this customer that is not canceled or incomplete_expired. Fetch only (Workers). */
export async function stripeLive(customerId: string): Promise<boolean> {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) {
    if (mock()) return false;
    throw new Error("STRIPE_SECRET_KEY is not set: cannot confirm that nothing bills");
  }
  const url = `https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=100`;
  const res = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`stripe ${res.status}`);
  const body = (await res.json()) as { data?: { status: string }[] };
  return (body.data ?? []).some((s) => s.status !== "canceled" && s.status !== "incomplete_expired");
}

/** Supabase Admin API; the user id is a uuid from our own database. */
export async function deleteLogin(userId: string): Promise<void> {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    log.info("account.login_delete_mock", {});
    return;
  }
  const res = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok && res.status !== 404) throw new Error(`supabase admin ${res.status}`);
}

const revoke = (token: string) => (env("GOOGLE_OAUTH_CLIENT_ID") ? revokeGoogleToken(token) : Promise.resolve(void log.info("google.revoke_mock", {})));

export function workerPurgeDeps(now = new Date()): PurgeDeps {
  return {
    db: getDb(),
    now,
    dryRunRetention: process.env.VIDALO_PURGE !== "1",
    stripeLive,
    revokeGoogle: revoke,
    deleteCustomHostname,
    deleteLogin,
    sendDeletedMail,
    isOwnFactsHost: (h, b) => isOwnFactsHost(h, b),
  };
}

export const purge: Handler<"purge"> = async ({ businessId, guard }) => {
  const out = await purgeBusiness(workerPurgeDeps(), businessId, guard);
  return { ...out };
};

export const googleDisconnect: Handler<"google_disconnect"> = async ({ businessId, reason }) => {
  const db = getDb();
  const b = await db.getBusiness(businessId);
  if (!b) return { skipped: "gone" };
  if (reason === "churn" && b.status !== "churned") return { skipped: "not_churned" };
  if (reason === "scan_done" && !(b.plan === "setup" && b.status === "trial")) return { skipped: "not_scan" };
  return { ...(await disconnectGoogle(db, businessId, revoke, reason)) };
};
