"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { isEmail } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase";
import { MOCK_SESSION_COOKIE } from "@/lib/session";
import { ready } from "@/lib/db";
import { getSession } from "@/lib/session";
import { getI18n } from "@/lib/i18n";
import { passesTurnstile } from "@/lib/turnstile";
import { claimPaidBusiness, clientIp } from "@vidalo/core/shared";
import { checkoutLoader } from "@/lib/stripe";

export async function sendMagicLink(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const rawNext = String(form.get("next") ?? "/app");
  // Only same-site paths: "next" comes from the query string.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\") ? rawNext : "/app";
  const businessId = String(form.get("business") ?? "");
  const checkoutSessionId = String(form.get("session_id") ?? "");
  // Errors come back here with the checkout link intact, or the payer cannot link the business afterwards.
  const q = `next=${encodeURIComponent(next)}${businessId ? `&business=${encodeURIComponent(businessId)}` : ""}${checkoutSessionId ? `&session_id=${encodeURIComponent(checkoutSessionId)}` : ""}`;
  const { href } = await getI18n();
  if (!isEmail(email)) redirect(href(`/inloggen?fout=1&${q}`));
  // Bot check before anything is stored or mailed.
  if (!(await passesTurnstile(form, clientIp({ headers: await headers() })))) redirect(href(`/inloggen?fout=check&${q}`));

  // Coming from /welkom after checkout: the link lands back on this page signed
  // in, where one button links the business if the checkout session is paid
  // (claimBusiness). Nothing is stored before that: anyone can post this form.
  const db = await ready();
  const after = businessId ? `/inloggen?${q}` : next;

  const supabase = await createServerSupabase();
  if (supabase) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // The Vidalo template appends token_hash and type to this (docs/auth-email/README.md).
      options: { emailRedirectTo: `${env.baseUrl}/auth/confirm?next=${encodeURIComponent(href(after))}` },
    });
    if (error) {
      console.error("sign-in link refused", error.status, error.code, error.message);
      // Supabase sends a few links per hour; say so instead of a generic error.
      const limited = error.status === 429 || error.code === "over_email_send_rate_limit";
      redirect(href(`/inloggen?fout=${limited ? "wacht" : "1"}&${q}`));
    }
    redirect(href(`/inloggen?sent=1`));
  }

  // Mock auth: sign in immediately as this e-mail. Never on real data (env.allowMockAuth).
  if (!env.allowMockAuth) redirect(href(`/inloggen?fout=1&${q}`));
  const store = await cookies();
  const owned = await db.getBusinessByOwner({ email });
  store.set(MOCK_SESSION_COOKIE, JSON.stringify({ userId: owned?.ownerUserId ?? `mock-${email}`, email }), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect(href(after));
}

/**
 * From /welkom after checkout, for a visitor who is already signed in: link
 * the business to this account and continue. Only with the paid Stripe
 * Checkout session for this business (session_id from /welkom), checked with
 * Stripe (core/shared/claim.ts, review SEC-01); ownership is proven by Google
 * afterwards (shared/ownership.ts).
 */
export async function claimBusiness(form: FormData): Promise<void> {
  const { href } = await getI18n();
  const rawNext = String(form.get("next") ?? "/app");
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\") ? rawNext : "/app";
  const businessId = String(form.get("business") ?? "");
  const checkoutSessionId = String(form.get("session_id") ?? "") || null;
  const session = await getSession();
  if (!session) redirect(href(`/inloggen?next=${encodeURIComponent(next)}&business=${encodeURIComponent(businessId)}${checkoutSessionId ? `&session_id=${encodeURIComponent(checkoutSessionId)}` : ""}`));
  const db = await ready();
  const out = await claimPaidBusiness(db, { businessId, userId: session.userId, email: session.email, checkoutSessionId, loadCheckout: await checkoutLoader() });
  if (!out.ok) {
    const fout = out.reason === "not_found" ? "geen" : out.reason === "taken" ? "bezet" : "betaling";
    redirect(href(`/inloggen?fout=${fout}&next=${encodeURIComponent(next)}`));
  }
  redirect(href(next));
}
