import { ready } from "./core";
import type { BusinessRecord } from "@vidalo/core/db";
import type { Session } from "./session";

/** The owner's choice of business. Value: a business uuid. HttpOnly, Secure on https, SameSite=Lax, Path=/, Max-Age 90 days.
 *  Never trusted: getActiveBusiness re-checks it against the membership list on every request. */
export const ACTIVE_BUSINESS_COOKIE = "vidalo_business";

/** Every business this login is a member of, newest first. C-00 stub: today's single owned business, or none. */
export async function listMyBusinesses(session: Session): Promise<BusinessRecord[]> {
  const b = await getActiveBusiness(session);
  return b ? [b] : [];
}

/** The business every owner page acts on. C-00 stub: the business owned by the session user, linking owner_user_id on first visit. */
export async function getActiveBusiness(session: Session): Promise<BusinessRecord | null> {
  const db = await ready();
  let b = await db.getBusinessByOwner({ userId: session.userId });
  if (!b) {
    b = await db.getBusinessByOwner({ email: session.email });
    if (b && !b.ownerUserId) b = await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ownerUserId: session.userId });
  } else if (b.ownerEmail?.toLowerCase() !== session.email.toLowerCase()) {
    // The owner confirmed a new address with Supabase (account page): owner mail follows the login.
    b = await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ownerEmail: session.email.toLowerCase() });
    await db.logEvent(b.id, "account.email_changed", { via: "auth" });
  }
  return b;
}
