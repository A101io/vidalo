/**
 * The order confirmation (feature 003, ADR-0008): one mail per Checkout
 * session, queued when Stripe reports `checkout.session.completed`, for every
 * plan, paid or still processing. Between businesses art. 6:227c BW asks that
 * an electronic order is confirmed without delay; the welcome mail cannot do
 * that, it waits for proven ownership and never comes for an add-on.
 *
 * The payer's address comes from the verified event only and travels in the
 * job payload; no log line or event carries it.
 */
import { randomBytes } from "node:crypto";
import type { BusinessRecord } from "../db/types.js";
import { PRICES } from "../copy/prices.js";
import { getDb } from "../shared/db.js";
import { parseFreeCheckRequest } from "../shared/free-check.js";
import { log } from "../shared/log.js";

export type OrderPlan = "setup" | "monitor" | "monitor_addon";
export type OrderLang = "nl" | "en";
export interface OrderAmounts {
  subtotal: number;
  tax: number;
  total: number;
  currency: "eur";
}

/** The `email` job the webhook queues (apps/worker/src/jobs/types.ts carries the same member). */
export interface OrderConfirmationJob {
  template: "order_confirmation";
  businessId: string;
  sessionId: string;
  /** the payer, from the verified webhook only (customer_details.email) */
  to: string;
  lang: OrderLang;
  plan: OrderPlan;
  /** minor units, as Stripe charged them */
  amounts: OrderAmounts;
  paid: boolean;
  /** ISO, session.created */
  orderedAt: string;
}

/** Payment states in which Stripe has the money (or needs none). */
export const PAID_STATUSES = new Set(["paid", "no_payment_required"]);

export const ORDER_QUEUED_EVENT = "order_confirmation.queued";

/** What a plan costs excl. btw, in cents, per line, from PRICES. */
export function orderLines(plan: OrderPlan): { setup?: number; monthly?: number } {
  const setup = PRICES.setupEur * 100;
  const monthly = PRICES.monitorEurPerMonth * 100;
  return plan === "setup" ? { setup } : plan === "monitor" ? { setup, monthly } : { monthly };
}

export function orderSubtotal(plan: OrderPlan): number {
  const l = orderLines(plan);
  return (l.setup ?? 0) + (l.monthly ?? 0);
}

function planOf(session: Record<string, unknown>): OrderPlan {
  const p = (session.metadata as Record<string, string> | undefined)?.plan;
  return p === "setup" ? "setup" : p === "monitor_addon" ? "monitor_addon" : "monitor";
}

const cents = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

export async function queueOrderConfirmation(business: BusinessRecord, session: Record<string, unknown>): Promise<"queued" | "duplicate" | "no_address"> {
  const db = getDb();
  const sessionId = typeof session.id === "string" ? session.id : "";
  const plan = planOf(session);
  if (sessionId) {
    const events = await db.listEvents(business.id, 1000);
    if (events.some((e) => e.type === ORDER_QUEUED_EVENT && e.payload.sessionId === sessionId)) return "duplicate";
  }
  const address = parseFreeCheckRequest({ email: (session.customer_details as { email?: unknown } | null | undefined)?.email });
  if (!address.ok || !sessionId) {
    log.warn("order_mail.no_address", { businessId: business.id, sessionId: sessionId || null });
    return "no_address";
  }
  const subtotal = cents(session.amount_subtotal) ?? 0;
  const tax = cents((session.total_details as { amount_tax?: unknown } | null | undefined)?.amount_tax) ?? 0;
  const total = cents(session.amount_total) ?? subtotal + tax;
  const locale = session.locale;
  const lang: OrderLang = locale === "nl" || locale === "en" ? locale : business.language === "en" ? "en" : "nl";
  const created = cents(session.created);
  const paid = PAID_STATUSES.has(String(session.payment_status));
  const payload: OrderConfirmationJob = {
    template: "order_confirmation",
    businessId: business.id,
    sessionId,
    to: address.email,
    lang,
    plan,
    amounts: { subtotal, tax, total, currency: "eur" },
    paid,
    orderedAt: (created ? new Date(created * 1000) : new Date()).toISOString(),
  };
  const job = await db.enqueueJob("email", payload as unknown as Record<string, unknown>);
  await db.logEvent(business.id, ORDER_QUEUED_EVENT, { sessionId, plan, paid, jobId: job.id });
  log.info(ORDER_QUEUED_EVENT, { businessId: business.id, sessionId, plan, paid, jobId: job.id });
  return "queued";
}

/** A session-shaped object for mock mode only (no Stripe key): PRICES with 21% btw, paid. */
export function mockCheckoutSession(plan: OrderPlan, lang: OrderLang, email: string | null): Record<string, unknown> {
  const subtotal = orderSubtotal(plan);
  const tax = Math.round(subtotal * 0.21);
  return {
    id: `mock_${randomBytes(8).toString("hex")}`,
    payment_status: "paid",
    metadata: { plan },
    customer_details: { email },
    amount_subtotal: subtotal,
    amount_total: subtotal + tax,
    total_details: { amount_tax: tax },
    currency: "eur",
    locale: lang,
    created: Math.floor(Date.now() / 1000),
  };
}
