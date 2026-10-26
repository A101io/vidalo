import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { ready } from "@/lib/db";
import { transitionStatus } from "@/lib/core";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { safeOrigin } from "@/lib/origin";
import { getSession, getOwnedBusiness } from "@/lib/session";
import { HOME_COUNTRY, isVerifiedOwner } from "@vidalo/core/shared";
import { copyFor, PRICES } from "@vidalo/core/copy";
import { localizeHref } from "@/lib/lang-paths";
import { langFromReferer } from "@/lib/request-lang";

export const runtime = "nodejs";

/**
 * POST business, scan, plan → Stripe Checkout.
 *   setup          one-off €149 (mode=payment, with an invoice)
 *   monitor        €49/month with the €149 setup as a one-time first line
 *   monitor_addon  €49/month only, for a verified owner who already paid setup
 * Prices are excl. btw. With VIDALO_STRIPE_TAX=1 Stripe Tax works out the VAT
 * per customer from the billing address and VAT number (Dutch 21%, EU reverse
 * charge, none outside the EU). Without it every line carries the 21% NL tax
 * rate, a live checkout without one refuses rather than undercharge by 21%,
 * and a business outside the Netherlands cannot pay yet: 21% would be wrong.
 * Mock mode (no STRIPE_SECRET_KEY): marks the business paid and goes to /welkom.
 *
 * The session is set up as for Sonable (playbook/STRIPE.md): the customer
 * ticks the terms (consent_collection; this needs the Terms URL set on the
 * Stripe account, or session creation fails), the B2B confirmation with the
 * terms and privacy links sits above the pay button, the billing address and
 * the btw-nummer are collected, and the return URLs follow the host the
 * visitor is on (lib/origin.ts), never a hostname baked in at deploy time.
 */
export async function POST(req: Request) {
  const lang = langFromReferer(req);
  const copy = copyFor(lang);
  // Pages we send people to, in the language they posted from, on the host they are on.
  const origin = safeOrigin(req);
  const page = (path: string) => `${origin}${localizeHref(path, lang)}`;
  const form = await req.formData();
  const businessId = String(form.get("business") ?? "");
  const scanRunId = String(form.get("scan") ?? "");
  const raw = String(form.get("plan") ?? "");
  const plan = raw === "setup" ? "setup" : raw === "monitor_addon" ? "monitor_addon" : "monitor";
  const db = await ready();
  const business = await db.getBusiness(businessId);
  const back = plan === "monitor_addon" ? page(`/app/abonnement`) : page(`/r/${encodeURIComponent(scanRunId)}`);
  if (!business) return NextResponse.redirect(page(`/`), 303);

  if (plan === "monitor_addon") {
    // Adding monitoring changes an existing customer's bill: owner only.
    const session = await getSession();
    if (!session || !isVerifiedOwner(business, session.userId)) return NextResponse.redirect(page(`/app/google?eerst=1`), 303);
  }

  const stripe = await getStripe();
  if (!stripe) {
    const storedPlan = plan === "setup" ? "setup" : "monitor";
    await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, plan: storedPlan });
    if (plan !== "monitor_addon") {
      await transitionStatus(business.id, "trial", { via: "checkout.mock", plan });
      await db.enqueueJob("setup", { businessId: business.id });
    }
    await db.logEvent(business.id, "checkout.mock", { plan });
    return NextResponse.redirect(plan === "monitor_addon" ? page(`/app/abonnement?toegevoegd=1`) : page(`/welkom?mock=1&business=${business.id}`), 303);
  }

  const automaticTax = env.stripeAutomaticTax;
  if (!automaticTax && business.country !== HOME_COUNTRY) {
    console.error("checkout refused: business abroad and VIDALO_STRIPE_TAX is off; the fixed 21% rate would be wrong");
    await db.logEvent(business.id, "checkout.refused", { reason: "abroad_no_tax", plan, country: business.country });
    return NextResponse.redirect(`${back}?betaling=buitenland`, 303);
  }
  const taxRate = env.stripeTaxRateId;
  if (!automaticTax && !taxRate) {
    console.error("checkout refused: STRIPE_TAX_RATE_ID is not set; prices are excl. btw");
    await db.logEvent(business.id, "checkout.refused", { reason: "no_tax_rate", plan });
    return NextResponse.redirect(`${back}?betaling=fout`, 303);
  }
  // Stripe Tax needs no rate on the lines, only prices that say they are excl. tax.
  const tax = automaticTax ? {} : { tax_rates: [taxRate!] };
  const exclusive = { tax_behavior: "exclusive" as const };
  const setupLine = env.stripePriceSetup
    ? { price: env.stripePriceSetup, quantity: 1, ...tax }
    : { price_data: { currency: "eur", unit_amount: PRICES.setupEur * 100, product_data: { name: copy.checkout.productSetup }, ...exclusive }, quantity: 1, ...tax };
  const monitorLine = env.stripePriceMonitor
    ? { price: env.stripePriceMonitor, quantity: 1, ...tax }
    : { price_data: { currency: "eur", unit_amount: PRICES.monitorEurPerMonth * 100, recurring: { interval: "month" as const }, product_data: { name: copy.checkout.productMonitor }, ...exclusive }, quantity: 1, ...tax };

  const payment = plan === "setup";
  const terms = page("/voorwaarden");
  const privacy = page("/privacy");
  // `managed_payments` is newer than the stripe@17 types; it is off because it
  // cannot be combined with custom_text, and the custom text carries the B2B
  // confirmation and the legal links the Dutch information duty asks for.
  const params: Stripe.Checkout.SessionCreateParams & { managed_payments?: { enabled: boolean } } = {
    managed_payments: { enabled: false },
    mode: payment ? "payment" : "subscription",
    line_items: plan === "setup" ? [setupLine] : plan === "monitor" ? [monitorLine, setupLine] : [monitorLine],
    payment_method_types: payment ? ["ideal", "card"] : ["ideal", "card", "sepa_debit"],
    ...(payment ? {} : { payment_method_collection: "always" as const }),
    locale: lang,
    ...(automaticTax ? { automatic_tax: { enabled: true } } : {}),
    // Business customers enter their btw-nummer; it goes on the invoice (and decides reverse charge with Stripe Tax).
    tax_id_collection: { enabled: true, required: "if_supported" },
    billing_address_collection: "required",
    allow_promotion_codes: false,
    // An explicit checkbox for the terms, not passive text. Needs the Terms
    // URL on the Stripe account (dashboard → Settings → Public details).
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      submit: { message: copy.checkout.consentSubmit(terms, privacy) },
      terms_of_service_acceptance: { message: copy.checkout.consentAccept(terms, privacy) },
    },
    ...(business.stripeCustomerId ? { customer: business.stripeCustomerId, customer_update: { name: "auto" as const, address: "auto" as const } } : { customer_email: business.ownerEmail ?? undefined }),
    ...(payment ? { customer_creation: business.stripeCustomerId ? undefined : ("always" as const), invoice_creation: { enabled: true } } : {}),
    metadata: { businessId: business.id, plan, scanRunId },
    subscription_data: payment ? undefined : { metadata: { businessId: business.id } },
    success_url: plan === "monitor_addon" ? page(`/app/abonnement?toegevoegd=1`) : page(`/welkom?session_id={CHECKOUT_SESSION_ID}&business=${business.id}`),
    cancel_url: `${back}?betaling=geannuleerd`,
  };
  const session = await stripe.checkout.sessions.create(params);
  await db.logEvent(business.id, "checkout.started", { plan, sessionId: session.id, origin });
  return NextResponse.redirect(session.url ?? back, 303);
}
