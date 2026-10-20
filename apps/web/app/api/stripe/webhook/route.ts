import { NextResponse } from "next/server";
import { handleStripeEvent } from "@vidalo/core/billing";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

/**
 * Stripe webhook: verify the signature, then let core/billing decide what
 * the event means (packages/core/src/billing, tested there). Answers 200 for
 * events it does not act on, so Stripe stops retrying them.
 */
export async function POST(req: Request) {
  const stripe = await getStripe();
  if (!stripe || !env.stripeWebhookSecret) return NextResponse.json({ ok: false, reason: "stripe not configured" }, { status: 503 });
  const sig = req.headers.get("stripe-signature");
  if (!sig) return NextResponse.json({ ok: false }, { status: 400 });
  const payload = await req.text();
  let event;
  try {
    // Async: on Workers the Stripe SDK verifies with Web Crypto, and the
    // synchronous constructEvent throws there, which read as "bad signature"
    // on every event. The async form works on Node as well.
    event = await stripe.webhooks.constructEventAsync(payload, sig, env.stripeWebhookSecret);
  } catch {
    return NextResponse.json({ ok: false, error: "bad signature" }, { status: 400 });
  }
  await ready();
  const outcome = await handleStripeEvent(event as unknown as Parameters<typeof handleStripeEvent>[0]);
  return NextResponse.json({ received: true, outcome });
}
