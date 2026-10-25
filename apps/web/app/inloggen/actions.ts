"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { env } from "@/lib/env";
import { isEmail } from "@/lib/format";
import { createServerSupabase } from "@/lib/supabase";
import { MOCK_SESSION_COOKIE } from "@/lib/session";
import { ready } from "@/lib/db";
import { getI18n } from "@/lib/i18n";

export async function sendMagicLink(form: FormData) {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const rawNext = String(form.get("next") ?? "/app");
  // Only same-site paths: "next" comes from the query string.
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\") ? rawNext : "/app";
  const businessId = String(form.get("business") ?? "");
  const q = `next=${encodeURIComponent(next)}`;
  const { href } = await getI18n();
  if (!isEmail(email)) redirect(href(`/inloggen?fout=1&${q}`));

  // Coming from /welkom after checkout: remember who asked for this business,
  // so the first sign-in finds it. A claim, not proof: ownership is proven by
  // Google later (shared/ownership.ts), and a verified owner replaces any claim.
  const db = await ready();
  if (businessId) {
    const b = await db.getBusiness(businessId);
    if (b && !b.ownerEmail) await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ownerEmail: email });
  }

  const supabase = await createServerSupabase();
  if (supabase) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${env.baseUrl}/auth/callback?next=${encodeURIComponent(href(next))}` },
    });
    if (error) {
      console.error("sign-in link refused", error.status, error.code, error.message);
      // Supabase sends a few links per hour; say so instead of a generic error.
      const limited = error.status === 429 || error.code === "over_email_send_rate_limit";
      redirect(href(`/inloggen?fout=${limited ? "wacht" : "1"}&${q}`));
    }
    redirect(href(`/inloggen?sent=1`));
  }

  // Mock auth: sign in immediately as this e-mail, like a clicked magic link.
  // Without a business, requireOwner sends them to the signed-in "no business yet" state.
  const store = await cookies();
  const owned = await db.getBusinessByOwner({ email });
  store.set(MOCK_SESSION_COOKIE, JSON.stringify({ userId: owned?.ownerUserId ?? `mock-${email}`, email }), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect(href(next));
}
