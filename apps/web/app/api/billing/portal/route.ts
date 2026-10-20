import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { safeOrigin } from "@/lib/origin";
import { localizeHref } from "@/lib/lang-paths";
import { langFromReferer } from "@/lib/request-lang";
import { getSession, getOwnedBusiness } from "@/lib/session";

/**
 * POST → Stripe customer portal for invoices, payment method and cancelling;
 * mock mode returns to the dashboard. `return_url` is explicit on every
 * session and follows the host the visitor is on (playbook/STRIPE.md).
 */
export async function POST(req: Request) {
  const lang = langFromReferer(req);
  const page = (path: string) => `${safeOrigin(req)}${localizeHref(path, lang)}`;
  const session = await getSession();
  const business = session ? await getOwnedBusiness(session) : null;
  if (!business) return NextResponse.redirect(page("/inloggen?next=/app"), 303);
  const stripe = await getStripe();
  if (!stripe || !business.stripeCustomerId) return NextResponse.redirect(page("/app?facturen=mock"), 303);
  const configuration = env.stripePortalConfiguration;
  const portal = await stripe.billingPortal.sessions.create({ customer: business.stripeCustomerId, return_url: page("/app/abonnement"), locale: lang, ...(configuration ? { configuration } : {}) });
  return NextResponse.redirect(portal.url, 303);
}
