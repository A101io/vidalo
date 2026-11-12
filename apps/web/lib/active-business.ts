import { cache } from "react";
import { cookies } from "next/headers";
import { ready } from "./core";
import { linkBusinessesByEmail, listMemberBusinesses, type BusinessRecord } from "@vidalo/core/db";
import type { Session } from "./session";

/** The owner's choice of business. Value: a business uuid. HttpOnly, Secure on https, SameSite=Lax, Path=/, Max-Age 90 days.
 *  Never trusted: getActiveBusiness re-checks it against the membership list on every request. */
export const ACTIVE_BUSINESS_COOKIE = "vidalo_business";

/** Cookie options for ACTIVE_BUSINESS_COOKIE (written only by chooseBusiness, after isMember). */
export const ACTIVE_BUSINESS_MAX_AGE = 90 * 86400;

// Keyed on the two strings, not the Session object: getSession() returns a new object per call,
// and React's cache() compares arguments by identity.
const membersOf = cache(async (userId: string, email: string): Promise<BusinessRecord[]> => {
  const db = await ready();
  // Businesses whose owner address is this login's verified address and that nobody owns yet (SEC-11).
  await linkBusinessesByEmail(db, userId, email);
  const list = await listMemberBusinesses(db, userId);
  const out: BusinessRecord[] = [];
  for (let b of list) {
    if (b.ownerEmail?.toLowerCase() !== email.toLowerCase()) {
      // The owner confirmed a new address with Supabase (account page): owner mail follows the login, per business.
      b = await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ownerEmail: email.toLowerCase() });
      await db.logEvent(b.id, "account.email_changed", { via: "auth" });
    }
    out.push(b);
  }
  return out;
});

/** Every business this login is a member of, newest first. First links unowned businesses with the login's address. */
export function listMyBusinesses(session: Session): Promise<BusinessRecord[]> {
  return membersOf(session.userId, session.email);
}

/** The business every owner page acts on: the cookie's id when it is in listMyBusinesses, else the newest; null when none. */
export async function getActiveBusiness(session: Session): Promise<BusinessRecord | null> {
  const list = await listMyBusinesses(session);
  if (!list.length) return null;
  const chosen = (await cookies()).get(ACTIVE_BUSINESS_COOKIE)?.value;
  return (chosen ? list.find((b) => b.id === chosen) : undefined) ?? list[0]!;
}
