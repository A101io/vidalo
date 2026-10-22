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
      // The Vidalo template appends token_hash and type to this (docs/auth-email/README.md).
      options: { emailRedirectTo: `${env.baseUrl}/auth/confirm?next=${encodeURIComponent(href(next))}` },
    });
    if (error) redirect(href(`/inloggen?fout=1&${q}`));
    redirect(href(`/inloggen?sent=1`));
  }

  // Mock auth: sign in immediately as this e-mail.
  const store = await cookies();
  if (next.startsWith("/eigenaar/bevestigen")) {
    // Claiming a business: ownership is proven by Google next, not by owning one already.
    store.set(MOCK_SESSION_COOKIE, JSON.stringify({ userId: `mock-${email}`, email }), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
    redirect(href(next));
  }
  const owned = await db.getBusinessByOwner({ email });
  if (!owned) {
    store.delete(MOCK_SESSION_COOKIE);
    redirect(href(`/inloggen?fout=geen&${q}`));
  }
  store.set(MOCK_SESSION_COOKIE, JSON.stringify({ userId: owned.ownerUserId ?? `mock-${email}`, email }), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  redirect(href(next));
}
