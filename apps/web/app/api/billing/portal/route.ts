import { NextResponse } from "next/server";
import { NO_STORE } from "@/lib/auth-cookies";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { safeOrigin } from "@/lib/origin";
import { localizeHref } from "@/lib/lang-paths";
import { langFromReferer } from "@/lib/request-lang";
import { getSession, getOwnedBusiness } from "@/lib/session";
import { listMyBusinesses } from "@/lib/active-business";
import { log, refuseCrossSite } from "@vidalo/core/shared";

/**
 * POST → Stripe customer portal for invoices, payment method and cancelling;
 * mock mode returns to the dashboard. `return_url` is explicit on every
 * session and follows the host the visitor is on (playbook/STRIPE.md).
 */
async function handle(req: Request): Promise<Response> {
  // A foreign page cannot open a portal session (AC-4e).
  const refused = refuseCrossSite(req, env.baseUrl);
  if (refused) {
    log.info("auth.cross_site_refused", { route: "billing_portal" });
    return refused;
  }
  const lang = langFromReferer(req);
  const page = (path: string) => `${safeOrigin(req)}${localizeHref(path, lang)}`;
  const session = await getSession();
  // The business the form names, when this login is a member of it (F-020); a form without one
  // (lane B's dashboard button until its B-05 change) gets the active business.
  const form = await req.formData().catch(() => null);
  const named = form ? String(form.get("business") ?? "") : "";
  const business = !session ? null : named ? ((await listMyBusinesses(session)).find((b) => b.id === named) ?? null) : await getOwnedBusiness(session);
  // Another login's or an unknown business: the same 404, nothing created at Stripe (SEC-04).
  if (session && named && !business) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!business) return NextResponse.redirect(page("/inloggen?next=/app"), 303);
  const stripe = await getStripe();
  if (!stripe || !business.stripeCustomerId) return NextResponse.redirect(page("/app?facturen=mock"), 303);
  const configuration = env.stripePortalConfiguration;
  const portal = await stripe.billingPortal.sessions.create({ customer: business.stripeCustomerId, return_url: page("/app/abonnement"), locale: lang, ...(configuration ? { configuration } : {}) });
  return NextResponse.redirect(portal.url, 303);
}

/** It reads the session: no answer of it may be stored by a cache (V-SEC-03). */
export async function POST(req: Request) {
  const res = await handle(req);
  res.headers.set("cache-control", NO_STORE);
  return res;
}
