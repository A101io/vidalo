/**
 * Linking a business to a signed-in account after checkout (/inloggen,
 * claimBusiness). A session proves only an e-mail address, and a business is
 * found by its name and town, so the claim must be tied to a payment for this
 * business: the Stripe Checkout session from the /welkom URL, checked with
 * Stripe, paid and carrying this business id. Before 6 Nov 2026 any session
 * could link a business nobody had claimed yet (review SEC-01).
 * Ownership is still proven by Google afterwards (ownership.ts).
 */
import type { BusinessRecord, Db } from "../db/types.js";

/** What Stripe says about a Checkout session; null when Stripe does not know it. */
export interface CheckoutProof {
  paid: boolean;
  businessId: string | null;
}

/** Looks a Checkout session up at Stripe; null = no Stripe (mock mode). */
export type LoadCheckout = ((sessionId: string) => Promise<CheckoutProof | null>) | null;

export type ClaimResult = { ok: true; business: BusinessRecord } | { ok: false; reason: "not_found" | "taken" | "unpaid" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Only a business id, never a slug: a slug is the name and the town. */
export function isBusinessId(v: string): boolean {
  return UUID.test(v);
}

/**
 * A business that paid before is bought again only by its signed-in owner:
 * otherwise a second, stranger's payment would be fresh proof for a claim
 * (claimPaidBusiness) before the first buyer signed in.
 */
export function onlyOwnerMayBuy(b: Pick<BusinessRecord, "stripeCustomerId" | "status">): boolean {
  return Boolean(b.stripeCustomerId) || b.status === "trial" || b.status === "active";
}

export async function claimPaidBusiness(
  db: Db,
  input: { businessId: string; userId: string; email: string; checkoutSessionId: string | null; loadCheckout: LoadCheckout },
): Promise<ClaimResult> {
  const b = isBusinessId(input.businessId) ? await db.getBusiness(input.businessId) : null;
  if (!b || b.id !== input.businessId) return { ok: false, reason: "not_found" };
  if (b.ownerUserId) return b.ownerUserId === input.userId ? { ok: true, business: b } : { ok: false, reason: "taken" };
  if (!(await paidFor(db, b, input.checkoutSessionId, input.loadCheckout))) return { ok: false, reason: "unpaid" };
  const business = await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ownerEmail: input.email.toLowerCase(), ownerUserId: input.userId });
  // billing activate() keeps this address only when the claim names its session.
  await db.logEvent(b.id, "owner.claimed", { sessionId: input.checkoutSessionId });
  return { ok: true, business };
}

async function paidFor(db: Db, b: BusinessRecord, sessionId: string | null, load: LoadCheckout): Promise<boolean> {
  // Mock mode has no Stripe: the mock checkout (api/checkout) is the payment.
  if (!load) return (await db.listEvents(b.id, 1000)).some((e) => e.type === "checkout.mock");
  if (!sessionId || !sessionId.startsWith("cs_")) return false;
  const proof = await load(sessionId);
  return Boolean(proof?.paid && proof.businessId === b.id);
}
