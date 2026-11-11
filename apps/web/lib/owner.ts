import { redirect } from "next/navigation";
import { getSession, getOwnedBusiness, type Session } from "./session";
import type { BusinessRecord } from "@vidalo/core/db";
import { isVerifiedOwner } from "@vidalo/core/shared";
import { getI18n } from "./i18n";

/** Session + owned business, or redirect to /inloggen. */
export async function requireOwner(next = "/app"): Promise<{ session: Session; business: BusinessRecord }> {
  const { href } = await getI18n();
  const session = await getSession();
  if (!session) redirect(href(`/inloggen?next=${encodeURIComponent(next)}`));
  const business = await getOwnedBusiness(session);
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
 * For every action that changes or removes something: the business named in the form, only if this login may act on it.
 * Not its business, or unknown id: redirect(href("/app")), nothing changed. C-00 stub: requireOwner, then the ids must match.
 */
export async function requireOwnerOf(businessId: string, next = "/app"): Promise<{ session: Session; business: BusinessRecord }> {
  const owner = await requireOwner(next);
  if (owner.business.id !== businessId) redirect((await getI18n()).href("/app"));
  return owner;
}

/** requireOwnerOf over requireVerifiedOwner: not verified goes to /app/google?eerst=1. C-00 stub: the ids must match. */
export async function requireVerifiedOwnerOf(businessId: string, next = "/app"): Promise<{ session: Session; business: BusinessRecord }> {
  const owner = await requireVerifiedOwner(next);
  if (owner.business.id !== businessId) redirect((await getI18n()).href("/app"));
  return owner;
}

/** The business id a changing form carries. One reader, so the field name never drifts. */
export function businessFromForm(form: FormData): string {
  return String(form.get("business") ?? "");
}
