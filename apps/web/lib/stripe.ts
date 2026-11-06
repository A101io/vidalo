import type { LoadCheckout } from "@vidalo/core/shared";
import { env } from "./env";

type StripeClient = import("stripe").default;

/**
 * Stripe client or null in mock mode (no STRIPE_SECRET_KEY).
 *
 * Always the fetch HTTP client: the bundle carries Stripe's Node build, whose
 * default client goes through Node's http module. On Workers that hung every
 * outbound call ("This socket has been closed"; vidalo.io checkout, 2 Nov 2026).
 */
export async function getStripe(): Promise<StripeClient | null> {
  if (!env.hasStripe) return null;
  const { default: Stripe } = await import("stripe");
  return new Stripe(env.stripeSecretKey!, { httpClient: Stripe.createFetchHttpClient() });
}

/**
 * The Checkout session check behind claimBusiness (core/shared/claim.ts), or
 * null in mock mode. An id Stripe does not know reads as no proof.
 */
export async function checkoutLoader(): Promise<LoadCheckout> {
  const stripe = await getStripe();
  // No Stripe outside mock mode is a broken setup, not a free pass: no proof at all.
  if (!stripe) return env.mock ? null : async () => null;
  return async (sessionId) => {
    try {
      const s = await stripe.checkout.sessions.retrieve(sessionId);
      return { paid: s.payment_status === "paid" || s.payment_status === "no_payment_required", businessId: s.metadata?.businessId ?? null };
    } catch {
      return null;
    }
  };
}
