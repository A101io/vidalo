/**
 * Ending the Google connection (feature 002, AC-5e, Q14, F-015): the token is revoked at Google
 * first, then the gbp channel that held it is deleted. Ownership proof (owner_verified_at) stays:
 * it says who proved ownership and when, not that Vidalo may still act.
 */
import type { Db } from "../db/types.js";
import { log } from "./log.js";

const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * POST the token in the form body (never in the URL) to Google's revoke endpoint. 200, or 400 with
 * invalid_token (already revoked or expired), is done; anything else throws, so the caller keeps
 * the token and tries again. Google's answer is never logged.
 */
export async function revokeGoogleToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const res = await fetchImpl(REVOKE_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return;
  if (res.status === 400) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "invalid_token") return;
  }
  throw new Error(`google revoke failed: ${res.status}`);
}

/**
 * Revokes and deletes every gbp channel of one business. A revoke failure stops before the delete
 * (the job retries), except on purge, where the token goes with the row anyway and the failure is
 * only logged. Returns how many channels were removed.
 */
export async function disconnectGoogle(db: Db, businessId: string, revoke: (token: string) => Promise<void>, reason: "owner" | "churn" | "purge" | "scan_done"): Promise<{ disconnected: number; revokeFailed?: number }> {
  let disconnected = 0;
  let revokeFailed = 0;
  for (const c of await db.listChannels(businessId)) {
    if (c.type !== "gbp") continue;
    const token = typeof c.meta?.refreshToken === "string" && c.meta.refreshToken ? c.meta.refreshToken : typeof c.meta?.accessToken === "string" ? c.meta.accessToken : null;
    if (token) {
      try {
        await revoke(token);
      } catch (err) {
        const status = err instanceof Error ? (/\d{3}/.exec(err.message)?.[0] ?? null) : null;
        log.warn("google.revoke_failed", { status, reason });
        if (reason !== "purge") throw err;
        revokeFailed++;
      }
    }
    await db.deleteChannel(c.id);
    disconnected++;
  }
  if (disconnected) log.info("google.disconnected", { reason });
  return revokeFailed ? { disconnected, revokeFailed } : { disconnected };
}
