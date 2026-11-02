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
