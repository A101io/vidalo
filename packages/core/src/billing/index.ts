/**
 * What a Stripe event means for a business. The web app's webhook route
 * verifies the signature and hands the event here; everything that changes
 * a business because of money happens in this one place, and is tested.
 *
 * State, in Vidalo's words:
 *   scanned  → trial    paid checkout (setup or setup + monitoring)
 *   trial    → active   first monthly invoice paid
 *   active   → paused   Stripe gave up collecting (subscription "unpaid")
 *   paused   → active   the customer paid after all
 *   any      → churned  subscription ended
 *
 * Rules that matter:
 * - A checkout is only "paid" when Stripe says so. SEPA direct debit and
 *   some iDEAL flows complete the session first and settle days later
 *   (payment_status "unpaid"); those wait for async_payment_succeeded.
 * - Stripe retries webhooks. Each event id is handled once per business.
 * - Stripe's own retry schedule (Smart Retries, set in the dashboard) does
 *   the dunning; Vidalo only follows the subscription's status.
 */
import type { BusinessRecord } from "../db/types.js";
import { getDb, setBusinessStatus } from "../shared/db.js";
import { log } from "../shared/log.js";

/** The parts of a Stripe event this module reads; no Stripe SDK needed in core. */
export interface StripeEventLike {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export type BillingOutcome =
  | "activated"
  | "payment_processing"
  | "payment_failed"
  | "paused"
  | "resumed"
  | "now_active"
  | "churned"
  | "invoice_failed_logged"
  | "duplicate"
  | "no_business"
  | "ignored";

const PAID = new Set(["paid", "no_payment_required"]);

function str(v: unknown): string | null {
  if (typeof v === "string" && v) return v;
  if (v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string") return (v as { id: string }).id;
  return null;
}

function meta(o: Record<string, unknown>): Record<string, string> {
  return (o.metadata as Record<string, string> | undefined) ?? {};
}

async function findBusiness(o: Record<string, unknown>): Promise<BusinessRecord | null> {
  const db = getDb();
  // An invoice carries the subscription's metadata under subscription_details,
  // or, from API version 2025-03-31 on, under parent.subscription_details.
  type Details = { metadata?: Record<string, string> } | undefined;
  const parent = o.parent as { subscription_details?: Details } | null | undefined;
  const byMeta = meta(o).businessId ?? (o.subscription_details as Details)?.metadata?.businessId ?? parent?.subscription_details?.metadata?.businessId;
  if (byMeta) {
    const b = await db.getBusiness(byMeta);
    if (b) return b;
  }
  const customer = str(o.customer);
  return customer ? db.getBusinessByStripeCustomer(customer) : null;
}

/** True when this Stripe event was already handled for this business. */
async function seen(business: BusinessRecord, eventId: string): Promise<boolean> {
  const events = await getDb().listEvents(business.id, 1000);
  return events.some((e) => e.type === "stripe.event" && e.payload.id === eventId);
}

async function activate(business: BusinessRecord, session: Record<string, unknown>): Promise<void> {
  const db = getDb();
  const plan = meta(session).plan === "setup" ? "setup" : "monitor";
  const addon = meta(session).plan === "monitor_addon";
  const email = (session.customer_details as { email?: string } | undefined)?.email ?? null;
  await db.upsertBusiness({
    id: business.id,
    slug: business.slug,
    name: business.name,
    place: business.place,
    plan,
    ownerEmail: business.ownerEmail ?? email,
    stripeCustomerId: str(session.customer) ?? business.stripeCustomerId,
    stripeSubscriptionId: str(session.subscription) ?? business.stripeSubscriptionId,
  });
  if (addon) {
    // Monitoring added later by a customer who already paid for setup.
    await db.logEvent(business.id, "checkout.completed", { plan: "monitor_addon", sessionId: session.id });
    return;
  }
  await setBusinessStatus(business.id, "trial", { via: "stripe", plan, sessionId: session.id });
  // Setup waits for proven ownership (apps/worker/src/jobs/paid.ts) and is
  // enqueued again by the Google callback once it is proven.
  await db.enqueueJob("setup", { businessId: business.id });
  // The terms consent is recorded with the sale: a completed session reading
  // "accepted" is the proof the account-level Terms URL is set and the box
  // was ticked (playbook/STRIPE.md), not a settings page.
  const consent = (session.consent as { terms_of_service?: string } | null | undefined)?.terms_of_service ?? null;
  await db.logEvent(business.id, "checkout.completed", { plan, sessionId: session.id, termsConsent: consent, email });
}

export async function handleStripeEvent(event: StripeEventLike): Promise<BillingOutcome> {
  const db = getDb();
  const o = event.data.object;
  const business = await findBusiness(o);
  if (!business) {
    log.warn("billing.no_business", { type: event.type, eventId: event.id });
    return "no_business";
  }
  if (await seen(business, event.id)) return "duplicate";
  const outcome = await apply(business, event);
  // Marked only once the work is done: if it throws, the route answers 500
  // and Stripe's retry runs it again instead of being taken for a duplicate.
  await db.logEvent(business.id, "stripe.event", { id: event.id });
  return outcome;
}

async function apply(business: BusinessRecord, event: StripeEventLike): Promise<BillingOutcome> {
  const db = getDb();
  const o = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      if (PAID.has(String(o.payment_status))) {
        await activate(business, o);
        return "activated";
      }
      // Bank debit still on its way: nothing starts until it settles.
      await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, stripeCustomerId: str(o.customer) ?? business.stripeCustomerId });
      await db.logEvent(business.id, "payment.processing", { sessionId: o.id, method: (o.payment_method_types as string[] | undefined)?.join(",") ?? null });
      return "payment_processing";
    }
    case "checkout.session.async_payment_succeeded":
      await activate(business, o);
      return "activated";
    case "checkout.session.async_payment_failed":
      await db.logEvent(business.id, "payment.failed", { sessionId: o.id });
      return "payment_failed";
    case "invoice.paid": {
      // The first renewal turns a new customer into a regular one; a payment
      // after a pause resumes the service.
      if (business.status === "paused" || (business.status === "trial" && o.billing_reason === "subscription_cycle")) {
        await setBusinessStatus(business.id, "active", { via: "stripe", invoiceId: o.id });
        return business.status === "paused" ? "resumed" : "now_active";
      }
      return "ignored";
    }
    case "invoice.payment_failed":
      await db.logEvent(business.id, "invoice.payment_failed", { invoiceId: o.id, attempt: o.attempt_count ?? null });
      return "invoice_failed_logged";
    case "customer.subscription.updated": {
      const status = String(o.status);
      if (status === "unpaid" && business.status !== "paused" && business.status !== "churned") {
        await setBusinessStatus(business.id, "paused", { via: "stripe", reason: "unpaid", subscriptionId: o.id });
        return "paused";
      }
      if (status === "active" && business.status === "paused") {
        await setBusinessStatus(business.id, "active", { via: "stripe", subscriptionId: o.id });
        return "resumed";
      }
      if (status === "canceled") {
        await setBusinessStatus(business.id, "churned", { via: "stripe", reason: "canceled", subscriptionId: o.id });
        return "churned";
      }
      return "ignored";
    }
    case "customer.subscription.deleted":
      await setBusinessStatus(business.id, "churned", { via: "stripe", reason: "subscription.deleted", subscriptionId: o.id });
      return "churned";
    default:
      return "ignored";
  }
}

/** The webhook events Vidalo listens to (scripts/stripe-setup.mjs registers exactly these). */
export const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;
