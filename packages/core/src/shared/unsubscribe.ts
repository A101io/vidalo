/**
 * Unsubscribing from the follow-up mails. Those mails are commercial (they
 * sell the plan), so Dutch law (Telecommunicatiewet 11.7) requires a working
 * opt-out in every one of them.
 *
 * The link carries the business id and an HMAC of it, so nobody can opt
 * someone else out by guessing ids. UNSUBSCRIBE_SECRET signs it; in mock mode
 * a fixed development secret is used. With real mail and no secret, follow-ups
 * are not sent at all: a mail without a working opt-out may not go out.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "../db/types.js";
import { allOptionalOff, mailAllowed } from "./mail-prefs.js";

export const UNSUBSCRIBED_EVENT = "email.unsubscribed";
const DEV_SECRET = "vidalo-dev-unsubscribe-secret";

function secret(): string | null {
  if (process.env.UNSUBSCRIBE_SECRET) return process.env.UNSUBSCRIBE_SECRET;
  return process.env.VIDALO_MOCK === "1" ? DEV_SECRET : null;
}

/** True when opt-out links can be signed, i.e. commercial mail may be sent. */
export function canSignUnsubscribe(): boolean {
  return secret() !== null;
}

export function unsubscribeToken(businessId: string): string {
  const s = secret();
  if (!s) throw new Error("UNSUBSCRIBE_SECRET is not set");
  return createHmac("sha256", s).update(`unsubscribe:${businessId}`).digest("base64url").slice(0, 32);
}

export function verifyUnsubscribeToken(businessId: string, token: string): boolean {
  if (!secret() || !businessId || !token) return false;
  const expected = Buffer.from(unsubscribeToken(businessId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** True when the follow-ups are switched off (by the link or on the account page). */
export async function isUnsubscribed(db: Db, businessId: string): Promise<boolean> {
  const b = await db.getBusiness(businessId);
  return b ? !mailAllowed(b.mailPrefs, "followup_7") : false;
}

/**
 * Unsubscribing switches every optional mail off (shared/mail-prefs.ts);
 * required service mails still go. The event is logged once, without the address.
 */
export async function recordUnsubscribe(db: Db, businessId: string, via: "link" | "one-click"): Promise<void> {
  const b = await db.getBusiness(businessId);
  if (!b) return;
  const already = (await db.listEvents(businessId, 1000)).some((e) => e.type === UNSUBSCRIBED_EVENT);
  await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, mailPrefs: allOptionalOff() });
  if (!already) await db.logEvent(businessId, UNSUBSCRIBED_EVENT, { via });
}
