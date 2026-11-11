import { redirect } from "next/navigation";
import { getSession, type Session } from "./session";
import { getActiveBusiness, listMyBusinesses } from "./active-business";
import type { BusinessRecord } from "@vidalo/core/db";
import { isVerifiedOwner } from "@vidalo/core/shared";
import { getI18n } from "./i18n";

/** Session + the ACTIVE business (membership, then the cookie), or redirect to /inloggen. */
export async function requireOwner(next = "/app"): Promise<{ session: Session; business: BusinessRecord }> {
  const { href } = await getI18n();
  const session = await getSession();
  if (!session) redirect(href(`/inloggen?next=${encodeURIComponent(next)}`));
  const business = await getActiveBusiness(session);
  // No cookie changes here: this runs while rendering, where Next forbids them
  // (it threw for anyone whose claim was taken over by a verified owner).
  if (!business) redirect(href(`/inloggen?fout=geen&next=${encodeURIComponent(next)}`));
  return { session, business };
}

/**
 * Like requireOwner, but the owner must have proven ownership with Google
 * (shared/ownership.ts). Anything that changes what is published about the
 * business, or spends money on it, goes through this; viewing does not.
 */
export async function requireVerifiedOwner(next = "/app"): Promise<{ session: Session; business: BusinessRecord }> {
  const owner = await requireOwner(next);
  if (!isVerifiedOwner(owner.business, owner.session.userId)) redirect((await getI18n()).href("/app/google?eerst=1"));
  return owner;
}

/**
 * For every action that changes or removes something: the business named in the form, only if this login is a member of it
 * (listMyBusinesses, never the cookie). Not a member, or an unknown or malformed id: the same answer, redirect(href("/app")),
 * nothing read or changed. Not signed in: /inloggen.
 */
export async function requireOwnerOf(businessId: string, next = "/app"): Promise<{ session: Session; business: BusinessRecord }> {
  const { href } = await getI18n();
  const session = await getSession();
  if (!session) redirect(href(`/inloggen?next=${encodeURIComponent(next)}`));
  const business = (await listMyBusinesses(session)).find((b) => b.id === businessId);
  if (!business) redirect(href("/app"));
  return { session, business };
}

/** requireOwnerOf, then the owner must have proven ownership: not verified goes to /app/google?eerst=1. */
export async function requireVerifiedOwnerOf(businessId: string, next = "/app"): Promise<{ session: Session; business: BusinessRecord }> {
  const owner = await requireOwnerOf(businessId, next);
  if (!isVerifiedOwner(owner.business, owner.session.userId)) redirect((await getI18n()).href("/app/google?eerst=1"));
  return owner;
}

/** The business id a changing form carries. One reader, so the field name never drifts. */
export function businessFromForm(form: FormData): string {
  return String(form.get("business") ?? "");
}
