import type { SubscriptionApi } from "@vidalo/core/billing";
import { getStripe } from "./stripe";

/** core/billing/lifecycle.ts's SubscriptionApi on the Stripe SDK; null in mock mode (no key). */
export async function subscriptionApi(): Promise<SubscriptionApi | null> {
  const stripe = await getStripe();
  if (!stripe) return null;
  const periodEnd = (sub: unknown): Date | null => {
    // cancel_at, then the period end, which moved from the subscription to its items in newer API versions.
    const s = sub as { cancel_at?: number | null; current_period_end?: number; items?: { data?: { current_period_end?: number }[] } };
    const t = s.cancel_at ?? s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
    return t ? new Date(t * 1000) : null;
  };
  return {
    async setCancelAtPeriodEnd(id, cancel, feedback, comment) {
      const sub = await stripe.subscriptions.update(id, {
        cancel_at_period_end: cancel,
        ...(cancel ? { cancellation_details: { ...(feedback ? { feedback } : {}), ...(comment ? { comment } : {}) } } : {}),
      });
      return { periodEnd: periodEnd(sub) };
    },
    async pause(id, until) {
      // "void": invoices that fall in the pause are voided, so nothing is owed for it.
      await stripe.subscriptions.update(id, { pause_collection: { behavior: "void", resumes_at: Math.floor(until.getTime() / 1000) } });
    },
    async resume(id) {
      await stripe.subscriptions.update(id, { pause_collection: "" });
    },
  };
}

/** When the paid period ends, as Stripe has it; a month from now without Stripe (mock), as lifecycle.ts assumes. */
export async function currentPeriodEnd(subscriptionId: string | null): Promise<Date> {
  const stripe = subscriptionId ? await getStripe() : null;
  if (stripe && subscriptionId) {
    try {
      const s = (await stripe.subscriptions.retrieve(subscriptionId)) as unknown as { current_period_end?: number; items?: { data?: { current_period_end?: number }[] } };
      const t = s.current_period_end ?? s.items?.data?.[0]?.current_period_end;
      if (t) return new Date(t * 1000);
    } catch {
      // fall through to the estimate; the cancel itself reads the real date from Stripe
    }
  }
  return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
}
