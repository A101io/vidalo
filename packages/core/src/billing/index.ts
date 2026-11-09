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
import { plusYear } from "./domain.js";

export * from "./lifecycle.js";
export * from "./domain.js";

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
  | "synced"
  | "invoice_failed_logged"
  | "domain_paid"
  | "domain_renewed"
  | "domain_payment_failed"
  | "domain_ended"
  | "domain_synced"
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
  const email = (session.customer_details as { email?: string } | undefined)?.email?.toLowerCase() ?? null;
  // The buyer's address wins over one that no payment stands behind (review
  // SEC-01): a proven owner, an earlier paying customer, or a claim made with
  // this very checkout session keep theirs; anyone else is unlinked.
  const tied =
    Boolean(business.ownerVerifiedAt || business.stripeCustomerId) ||
    (await db.listEvents(business.id, 1000)).some((e) => e.type === "owner.claimed" && e.payload.sessionId === session.id);
  const ownerEmail = tied || !email ? business.ownerEmail ?? email : email;
  const replaced = Boolean(business.ownerEmail && ownerEmail !== business.ownerEmail.toLowerCase());
  await db.upsertBusiness({
    id: business.id,
    slug: business.slug,
    name: business.name,
    place: business.place,
    plan,
    ownerEmail,
    ...(replaced ? { ownerUserId: null } : {}),
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

/**
 * Cancel-at-period-end and pause as Stripe now has them. The app sets both
 * itself (lifecycle.ts) and Stripe echoes them back here; a change made in
 * the Stripe dashboard by support lands the same way. True when the row changed.
 */
async function syncOwnerChoices(business: BusinessRecord, o: Record<string, unknown>): Promise<boolean> {
  const ts = (v: unknown) => (typeof v === "number" ? new Date(v * 1000).toISOString() : null);
  const items = o.items as { data?: { current_period_end?: number }[] } | undefined;
  const periodEnd = ts(o.current_period_end) ?? ts(items?.data?.[0]?.current_period_end);
  const cancelAt = o.cancel_at_period_end === true ? (ts(o.cancel_at) ?? periodEnd) : ts(o.cancel_at);
  const pause = o.pause_collection as { resumes_at?: number | null } | null | undefined;
  const pauseUntil = pause ? ts(pause.resumes_at) : null;
  const same = (a: string | null, b: string | null) => (a && b ? new Date(a).getTime() === new Date(b).getTime() : a === b);
  if (same(cancelAt, business.cancelAt) && same(pauseUntil, business.pauseUntil)) return false;
  await getDb().upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, cancelAt, pauseUntil });
  await getDb().logEvent(business.id, "subscription.synced", { cancelAt, pauseUntil, subscriptionId: o.id });
  return true;
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
  // The domain add-on has its own yearly subscription; its events never touch the business's status.
  if (isDomainObject(business, o)) return applyDomain(business, event);
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
      const synced = await syncOwnerChoices(business, o);
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
      return synced ? "synced" : "ignored";
    }
    case "customer.subscription.deleted":
      await setBusinessStatus(business.id, "churned", { via: "stripe", reason: "subscription.deleted", subscriptionId: o.id });
      return "churned";
    default:
      return "ignored";
  }
}

/**
 * True when a Stripe object belongs to the domain add-on: a checkout or
 * subscription with metadata plan "domain", or an invoice of that
 * subscription (by its metadata, or by the subscription id stored on the business).
 */
function isDomainObject(business: BusinessRecord, o: Record<string, unknown>): boolean {
  type Details = { metadata?: Record<string, string>; subscription?: unknown } | undefined;
  const parent = o.parent as { subscription_details?: Details } | null | undefined;
  const plan = meta(o).plan ?? (o.subscription_details as Details)?.metadata?.plan ?? parent?.subscription_details?.metadata?.plan;
  if (plan === "domain") return true;
  const sub = business.domainRegistration?.stripeSubscriptionId;
  if (!sub) return false;
  const objectSub = String(o.object) === "subscription" ? str(o.id) : (str(o.subscription) ?? str(parent?.subscription_details?.subscription));
  return objectSub === sub;
}

/** True when a subscription or invoice belongs to a domain subscription other than the one on file. */
function foreignSubscription(reg: NonNullable<BusinessRecord["domainRegistration"]>, o: Record<string, unknown>): boolean {
  type Details = { metadata?: Record<string, string>; subscription?: unknown } | undefined;
  const parent = o.parent as { subscription_details?: Details } | null | undefined;
  const sub = String(o.object) === "subscription" ? str(o.id) : (str(o.subscription) ?? str(parent?.subscription_details?.subscription));
  if (reg.stripeSubscriptionId) return Boolean(sub && sub !== reg.stripeSubscriptionId);
  const domain = meta(o).domain ?? parent?.subscription_details?.metadata?.domain;
  return Boolean(domain && domain !== reg.name);
}

async function patchDomain(business: BusinessRecord, patch: Partial<NonNullable<BusinessRecord["domainRegistration"]>>, extra: Partial<BusinessRecord> = {}) {
  await getDb().upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ...extra, domainRegistration: { ...business.domainRegistration!, ...patch } });
}

async function domainPaid(business: BusinessRecord, session: Record<string, unknown>): Promise<BillingOutcome> {
  const db = getDb();
  const reg = business.domainRegistration;
  // A paid session for a name that is not the one on file (a second tab, an old session): support sorts it out.
  if (!reg || reg.name !== meta(session).domain || reg.status === "registered") {
    await db.logEvent(business.id, "domain.paid_unmatched", { sessionId: session.id, domain: meta(session).domain ?? null, onFile: reg?.name ?? null, status: reg?.status ?? null });
    await db.enqueueJob("operator_task", { reason: "domain_paid_unmatched", businessId: business.id, sessionId: session.id, domain: meta(session).domain ?? null });
    return "ignored";
  }
  if (reg.status === "paid") {
    // The same payment reported again is fine; a second paid session for this name is a second subscription nobody tracks.
    if (str(session.subscription) === reg.stripeSubscriptionId || str(session.id) === reg.checkoutSessionId) return "domain_paid";
    await db.logEvent(business.id, "domain.paid_unmatched", { sessionId: session.id, domain: reg.name, second: true });
    await db.enqueueJob("operator_task", { reason: "domain_paid_unmatched", businessId: business.id, sessionId: session.id, domain: reg.name, subscriptionId: str(session.subscription) });
    return "ignored";
  }
  await patchDomain(
    business,
    { status: "paid", paidAt: new Date().toISOString(), checkoutSessionId: str(session.id), stripeSubscriptionId: str(session.subscription) ?? reg.stripeSubscriptionId },
    { stripeCustomerId: business.stripeCustomerId ?? str(session.customer) },
  );
  await db.enqueueJob("domain_register", { businessId: business.id });
  const consent = (session.consent as { terms_of_service?: string } | null | undefined)?.terms_of_service ?? null;
  await db.logEvent(business.id, "domain.paid", { name: reg.name, sessionId: session.id, termsConsent: consent });
  return "domain_paid";
}

async function applyDomain(business: BusinessRecord, event: StripeEventLike): Promise<BillingOutcome> {
  const db = getDb();
  const o = event.data.object;
  const reg = business.domainRegistration;
  // Invoices and subscriptions of another domain subscription (a refused or second one support cancels) never touch this registration.
  if (!event.type.startsWith("checkout.") && reg && foreignSubscription(reg, o)) {
    await db.logEvent(business.id, "domain.foreign_subscription", { type: event.type, objectId: o.id });
    return "ignored";
  }
  switch (event.type) {
    case "checkout.session.completed":
      if (PAID.has(String(o.payment_status))) return domainPaid(business, o);
      await db.logEvent(business.id, "domain.payment_processing", { sessionId: o.id });
      return "payment_processing";
    case "checkout.session.async_payment_succeeded":
      return domainPaid(business, o);
    case "checkout.session.async_payment_failed":
      await db.logEvent(business.id, "domain.payment_failed", { sessionId: o.id });
      return "payment_failed";
    case "invoice.paid": {
      if (!reg || o.billing_reason !== "subscription_cycle") return "ignored";
      // The registrar renews on its own (auto-renew on); the paid year moves the date on.
      const expiresAt = reg.expiresAt ? plusYear(reg.expiresAt) : null;
      await patchDomain(business, { expiresAt, autoRenew: true });
      if (!reg.autoRenew) await db.enqueueJob("domain_autorenew", { businessId: business.id, on: true });
      await db.logEvent(business.id, "domain.renewed", { name: reg.name, expiresAt, invoiceId: o.id });
      return "domain_renewed";
    }
    case "invoice.payment_failed": {
      if (!reg || reg.status !== "registered") return "ignored";
      // Not paid, not renewed: auto-renew goes off at the registrar (the worker does it) and the owner hears once per invoice.
      await db.logEvent(business.id, "domain.invoice_failed", { invoiceId: o.id, attempt: o.attempt_count ?? null });
      if (reg.autoRenew) {
        await patchDomain(business, { autoRenew: false });
        await db.enqueueJob("domain_autorenew", { businessId: business.id, on: false });
      }
      if (Number(o.attempt_count ?? 1) <= 1) await db.enqueueJob("email", { template: "domain", kind: "domain_payment_failed", businessId: business.id });
      return "domain_payment_failed";
    }
    case "customer.subscription.updated": {
      if (!reg) return "ignored";
      if (String(o.status) === "canceled") return domainEnded(business);
      const ts = (v: unknown) => (typeof v === "number" ? new Date(v * 1000).toISOString() : null);
      const items = o.items as { data?: { current_period_end?: number }[] } | undefined;
      const cancelAt = o.cancel_at_period_end === true ? (ts(o.cancel_at) ?? ts(o.current_period_end) ?? ts(items?.data?.[0]?.current_period_end)) : ts(o.cancel_at);
      if ((cancelAt ?? null) === (reg.cancelAt ? new Date(reg.cancelAt).toISOString() : null)) return "ignored";
      await patchDomain(business, { cancelAt });
      await db.logEvent(business.id, "domain.synced", { cancelAt, subscriptionId: o.id });
      return "domain_synced";
    }
    case "customer.subscription.deleted":
      return domainEnded(business);
    default:
      return "ignored";
  }
}

/** The add-on ended: nothing renews any more; the domain stays the owner's until it expires. */
async function domainEnded(business: BusinessRecord): Promise<BillingOutcome> {
  const db = getDb();
  const reg = business.domainRegistration;
  if (!reg || reg.status === "ended") return "ignored";
  const wasRegistered = reg.status === "registered";
  await patchDomain(business, { status: wasRegistered ? "ended" : reg.status, autoRenew: false });
  if (wasRegistered) {
    await db.enqueueJob("domain_autorenew", { businessId: business.id, on: false });
    await db.enqueueJob("email", { template: "domain", kind: "domain_ended", businessId: business.id });
  }
  await db.logEvent(business.id, "domain.ended", { name: reg.name, expiresAt: reg.expiresAt });
  return "domain_ended";
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
