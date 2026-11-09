import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { getStripe } from "@/lib/stripe";
import { safeOrigin } from "@/lib/origin";
import { getSession, getOwnedBusiness } from "@/lib/session";
import { localizeHref } from "@/lib/lang-paths";
import { langFromReferer } from "@/lib/request-lang";
import { HOME_COUNTRY, isVerifiedOwner } from "@vidalo/core/shared";
import { copyFor } from "@vidalo/core/copy";
import { DOMAIN_PRICE_EUR_PER_YEAR, domainBuyRefusal } from "@vidalo/core/billing";
import { getRegistrar, parseDomain, parseHolder, type DomainRegistration } from "@vidalo/core/registrar";

export const runtime = "nodejs";

/**
 * POST domain + holder details + accept → Stripe Checkout for the domain
 * add-on: its own yearly subscription (metadata plan "domain"), so it never
 * mixes with Vidalo Monthly. The webhook (core/billing) marks it paid and
 * queues domain_register. Same checkout rules as /api/checkout: terms
 * checkbox, B2B text with the legal links, billing address, btw-nummer,
 * prices excl. btw with the 21% rate or Stripe Tax.
 * Mock mode (no STRIPE_SECRET_KEY): marked paid at once and the job queued.
 */
export async function POST(req: Request) {
  const lang = langFromReferer(req);
  const copy = copyFor(lang);
  const origin = safeOrigin(req);
  const page = (path: string) => `${origin}${localizeHref(path, lang)}`;
  const back = (q: string) => NextResponse.redirect(page(`/app/domein?${q}#registreren`), 303);

  const session = await getSession();
  const business = session ? await getOwnedBusiness(session) : null;
  if (!business) return NextResponse.redirect(page("/inloggen?next=/app/domein"), 303);
  if (!isVerifiedOwner(business, session!.userId)) return NextResponse.redirect(page("/app/google?eerst=1"), 303);
  if (domainBuyRefusal(business)) return back("domein=niet");
  const registrar = getRegistrar();
  if (!registrar) return back("domein=niet");

  const form = await req.formData();
  const domain = parseDomain(String(form.get("domain") ?? ""));
  if (!domain) return back("fout=ongeldig");
  const q = `naam=${encodeURIComponent(domain.name)}`;
  if (form.get("accept") !== "ja") return back(`${q}&fout=accept`);
  const holder = parseHolder(Object.fromEntries(form.entries()), business.country, business.kvk);
  if (!holder.ok) return back(`${q}&fout=${holder.error}`);

  const db = await ready();
  // Checked again right before money changes hands: the page may be old.
  const [free] = await registrar.check([domain.name]);
  if (!free?.available) {
    await db.logEvent(business.id, "domain.checkout_refused", { name: domain.name, reason: free?.reason ?? "unknown" });
    return back(`${q}&fout=taken`);
  }

  const now = new Date().toISOString();
  const reg: DomainRegistration = {
    name: domain.name,
    status: "checkout",
    holder: holder.holder,
    registrar: registrar.name,
    acceptedAt: now,
    checkoutSessionId: null,
    stripeSubscriptionId: null,
    holderHandle: null,
    registrarId: null,
    paidAt: null,
    registeredAt: null,
    expiresAt: null,
    autoRenew: true,
    cancelAt: null,
    lastError: null,
  };
  const save = (r: DomainRegistration) => db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, domainRegistration: r });

  const stripe = await getStripe();
  if (!stripe) {
    await save({ ...reg, status: "paid", paidAt: now });
    await db.enqueueJob("domain_register", { businessId: business.id });
    await db.logEvent(business.id, "domain.paid", { name: domain.name, mock: true });
    return back("domein=betaald");
  }

  const automaticTax = env.stripeAutomaticTax;
  if (!automaticTax && business.country !== HOME_COUNTRY) return back(`${q}&fout=checkout`);
  const taxRate = env.stripeTaxRateId;
  if (!automaticTax && !taxRate) {
    console.error("domain checkout refused: STRIPE_TAX_RATE_ID is not set; prices are excl. btw");
    return back(`${q}&fout=checkout`);
  }
  const tax = automaticTax ? {} : { tax_rates: [taxRate!] };
  const line = env.stripePriceDomain
    ? { price: env.stripePriceDomain, quantity: 1, ...tax }
    : {
        price_data: { currency: "eur", unit_amount: DOMAIN_PRICE_EUR_PER_YEAR * 100, recurring: { interval: "year" as const }, product_data: { name: copy.checkout.productDomain(domain.name) }, tax_behavior: "exclusive" as const },
        quantity: 1,
        ...tax,
      };
  const terms = page("/voorwaarden");
  const privacy = page("/privacy");
  const metadata = { businessId: business.id, plan: "domain", domain: domain.name };
  const params: Stripe.Checkout.SessionCreateParams & { managed_payments?: { enabled: boolean } } = {
    managed_payments: { enabled: false },
    mode: "subscription",
    line_items: [line],
    payment_method_types: ["ideal", "card", "sepa_debit"],
    payment_method_collection: "always",
    locale: lang,
    ...(automaticTax ? { automatic_tax: { enabled: true } } : {}),
    tax_id_collection: { enabled: true, required: "if_supported" },
    billing_address_collection: "required",
    allow_promotion_codes: false,
    consent_collection: { terms_of_service: "required" },
    custom_text: {
      submit: { message: copy.checkout.domainSubmit(domain.name, terms, privacy) },
      terms_of_service_acceptance: { message: copy.checkout.consentAccept(terms, privacy) },
    },
    ...(business.stripeCustomerId ? { customer: business.stripeCustomerId, customer_update: { name: "auto" as const, address: "auto" as const } } : { customer_email: business.ownerEmail ?? undefined }),
    metadata,
    subscription_data: { metadata, description: copy.checkout.productDomain(domain.name) },
    success_url: page("/app/domein?domein=betaald"),
    cancel_url: page(`/app/domein?${q}&domein=geannuleerd`),
  };
  try {
    const cs = await stripe.checkout.sessions.create(params);
    await save({ ...reg, checkoutSessionId: cs.id });
    await db.logEvent(business.id, "domain.checkout_started", { name: domain.name, sessionId: cs.id, origin });
    return NextResponse.redirect(cs.url ?? page("/app/domein"), 303);
  } catch (err) {
    console.error("domain checkout failed", err);
    return back(`${q}&fout=checkout`);
  }
}
