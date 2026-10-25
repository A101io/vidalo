"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { isEmail } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { requireOwner } from "@/lib/owner";
import { MOCK_SESSION_COOKIE } from "@/lib/session";
import { createServerSupabase } from "@/lib/supabase";
import { MAIL_PREF_KEYS, setMailPrefs, type MailPrefs } from "@vidalo/core/shared";

/**
 * "E-mailadres wijzigen". With Supabase the change waits for the link in the
 * confirmation mail (and, with secure e-mail change on, one to the old address
 * too); the business's owner address follows on the next visit (lib/session.ts).
 * Mock auth changes it at once. The event carries no addresses.
 */
export async function changeEmail(formData: FormData) {
  const { business, session } = await requireOwner("/app/account");
  const { href } = await getI18n();
  const back = (q: string) => href(`/app/account?email=${q}#inlog`);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!isEmail(email)) redirect(back("fout"));
  if (email === session.email.toLowerCase()) redirect(back("zelfde"));
  const db = await ready();
  const other = await db.getBusinessByOwner({ email });
  if (other && other.id !== business.id) redirect(back("bezet"));

  const supabase = await createServerSupabase();
  if (supabase) {
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: `${env.baseUrl}/auth/callback?next=${encodeURIComponent(href("/app/account?email=bevestigd#inlog"))}` },
    );
    if (error) redirect(back("fout"));
    await db.logEvent(business.id, "account.email_change_requested", {});
    redirect(back("verstuurd"));
  }

  await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ownerEmail: email });
  await db.logEvent(business.id, "account.email_changed", { via: "mock" });
  (await cookies()).set(MOCK_SESSION_COOKIE, JSON.stringify({ userId: session.userId, email }), { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  revalidatePath("/app/account");
  redirect(back("gewijzigd"));
}

/** "Mails die je krijgt": a ticked box is on, an unticked one off. Required mails have no box. */
export async function saveMailPrefs(formData: FormData) {
  const { business } = await requireOwner("/app/account");
  const prefs: MailPrefs = Object.fromEntries(MAIL_PREF_KEYS.map((k) => [k, formData.get(k) === "aan"]));
  const db = await ready();
  await setMailPrefs(db, business.id, prefs);
  await db.logEvent(business.id, "account.mail_prefs_set", { off: MAIL_PREF_KEYS.filter((k) => !prefs[k]) });
  revalidatePath("/app/account");
  redirect((await getI18n()).href("/app/account?mails=opgeslagen#mails"));
}
