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
import { claimPaidBusiness, clientIp, LINK_LIMITS, log, overLimit, safeNext, throttleIp, throttleKeys, uaFamily } from "@vidalo/core/shared";
import { authCookieOptions } from "@/lib/auth-cookies";
import { createHash, randomUUID } from "node:crypto";
import { checkoutLoader } from "@/lib/stripe";

export async function sendMagicLink(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  // Only same-site paths: "next" comes from the query string (core/shared/safe-next.ts).
  const next = safeNext(String(form.get("next") ?? ""));
  const businessId = String(form.get("business") ?? "");
  const checkoutSessionId = String(form.get("session_id") ?? "");
  // Errors come back here with the checkout link intact, or the payer cannot link the business afterwards.
  const q = `next=${encodeURIComponent(next)}${businessId ? `&business=${encodeURIComponent(businessId)}` : ""}${checkoutSessionId ? `&session_id=${encodeURIComponent(checkoutSessionId)}` : ""}`;
  const { href } = await getI18n();
  if (!isEmail(email)) redirect(href(`/inloggen?fout=1&${q}`));
  // Bot check before anything is stored or mailed.
  const h = await headers();
  if (!(await passesTurnstile(form, clientIp({ headers: h })))) redirect(href(`/inloggen?fout=check&${q}`));

  // Coming from /welkom after checkout: the link lands back on this page signed
  // in, where one button links the business if the checkout session is paid
  // (claimBusiness). Nothing is stored before that: anyone can post this form (review R-03).
  const db = await ready();
  const after = businessId ? `/inloggen?${q}` : next;

  const supabase = await createServerSupabase();
  if (supabase) {
    // 5 links per address and 20 per IP per hour (ADR-0004), before anything is mailed. No count, no mail.
    let counts: number[];
    try {
      const ip = throttleIp(h, false);
      if (ip === "unknown") log.info("auth.throttle_no_ip", {});
      const keys = await throttleKeys(email, ip, env.authSecret);
      counts = await db.throttleAuth(keys, new Date(Date.now() - LINK_LIMITS.windowMs));
    } catch (err) {
      log.warn("auth.throttle_failed", { error: err instanceof Error ? err.name : "unknown" });
      redirect(href(`/inloggen?fout=1&${q}`));
    }
    if (overLimit(counts)) {
      log.info("auth.link_throttled", { which: (counts[0] ?? 0) > LINK_LIMITS.perAddress ? "address" : "ip" });
      redirect(href(`/inloggen?fout=wacht&${q}`));
    }
    const { error } = await supabase.auth.signInWithOtp({
      email,
      // The Vidalo template appends token_hash and type to this (docs/auth-email/README.md).
      options: { emailRedirectTo: `${env.baseUrl}/auth/confirm?next=${encodeURIComponent(href(after))}` },
    });
    if (error) {
      // Status and code only: GoTrue's message can carry the address (SEC-34).
      log.warn("auth.link_refused", { status: error.status ?? null, code: error.code ?? null });
      // Supabase sends a few links per hour; say so instead of a generic error.
      const limited = error.status === 429 || error.code === "over_email_send_rate_limit";
      redirect(href(`/inloggen?fout=${limited ? "wacht" : "1"}&${q}`));
    }
    // The same answer for every address: whether it has an account or a business never shows (AC-4a).
    redirect(href(`/inloggen?sent=1`));
  }

  // Mock auth: sign in immediately as this e-mail. Never on real data (env.allowMockAuth).
  if (!env.allowMockAuth) redirect(href(`/inloggen?fout=1&${q}`));
  const store = await cookies();
  const owned = await db.getBusinessByOwner({ email });
  // A sign-in like any other: its own session id and an auth_session row (feature 002, A-02).
  const userId = owned?.ownerUserId ?? mockUserId(email);
  const sid = randomUUID();
  await db.recordSignIn({ sessionId: sid, userId, ...uaFamily(h.get("user-agent")), at: new Date() });
  store.set(MOCK_SESSION_COOKIE, JSON.stringify({ userId, email, sid }), authCookieOptions());
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
  const next = safeNext(String(form.get("next") ?? ""));
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

/** Mock auth only: a stable user id for an address, shaped as a uuid so the same rows work on Postgres. */
function mockUserId(email: string): string {
  const h = createHash("sha256").update(`vidalo-mock:${email}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
