"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { isEmail } from "@/lib/format";
import { getI18n } from "@/lib/i18n";
import { businessFromForm, requireOwner, requireOwnerOf } from "@/lib/owner";
import { LANGS, localizeHref, type Lang } from "@/lib/lang-paths";
import { getSession, MOCK_SESSION_COOKIE } from "@/lib/session";
import { authCookieOptions } from "@/lib/auth-cookies";
import { requireFreshSignIn } from "@/lib/fresh-sign-in";
import { listMyBusinesses } from "@/lib/active-business";
import { createServerSupabase } from "@/lib/supabase";
import { log, MAIL_PREF_KEYS, setMailPrefs, type MailPrefs } from "@vidalo/core/shared";

/**
 * "E-mailadres wijzigen". With Supabase the change waits for the link in the
 * confirmation mail (and, with secure e-mail change on, one to the old address
 * too); the business's owner address follows on the next visit (lib/session.ts).
 * Mock auth changes it at once. The event carries no addresses.
 */
export async function changeEmail(formData: FormData) {
  // A new sign-in address is the key to the account: only right after signing in (AC-5c).
  await requireFreshSignIn("/app/account?stap=email#inlog");
  const { business, session } = await requireOwner("/app/account");
  const { href } = await getI18n();
  const back = (q: string) => href(`/app/account?email=${q}#inlog`);
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!isEmail(email)) redirect(back("fout"));
  if (email === session.email.toLowerCase()) redirect(back("zelfde"));
  const db = await ready();
  // Taken when the address is the owner address of any business this login is not a member of (SEC-38).
  const mine = new Set((await listMyBusinesses(session)).map((b) => b.id));
  const other = await db.getBusinessByOwner({ email });
  if (other && !mine.has(other.id)) redirect(back("bezet"));

  const supabase = await createServerSupabase();
  if (supabase) {
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: `${env.baseUrl}/auth/confirm?next=${encodeURIComponent(href("/app/account?email=bevestigd#inlog"))}` },
    );
    if (error) redirect(back("fout"));
    await db.logEvent(business.id, "account.email_change_requested", {});
    redirect(back("verstuurd"));
  }

  await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ownerEmail: email });
  await db.logEvent(business.id, "account.email_changed", { via: "mock" });
  (await cookies()).set(MOCK_SESSION_COOKIE, JSON.stringify({ userId: session.userId, email, sid: session.sessionId }), authCookieOptions());
  revalidatePath("/app/account");
  redirect(back("gewijzigd"));
}

/** "Mails die je krijgt": a ticked box is on, an unticked one off. Required mails have no box. */
export async function saveMailPrefs(formData: FormData) {
  const { business } = await requireOwnerOf(businessFromForm(formData), "/app/account");
  const prefs: MailPrefs = Object.fromEntries(MAIL_PREF_KEYS.map((k) => [k, formData.get(k) === "aan"]));
  const db = await ready();
  await setMailPrefs(db, business.id, prefs);
  await db.logEvent(business.id, "account.mail_prefs_set", { off: MAIL_PREF_KEYS.filter((k) => !prefs[k]) });
  revalidatePath("/app/account");
  redirect((await getI18n()).href("/app/account?mails=opgeslagen#mails"));
}

/** The language row on the account page: save it, then show the account in that language. */
export async function setLanguage(formData: FormData) {
  const { business } = await requireOwnerOf(businessFromForm(formData), "/app/account");
  const to = String(formData.get("language") ?? "") as Lang;
  if (!LANGS.includes(to)) redirect((await getI18n()).href("/app/account"));
  if (business.language !== to) {
    const db = await ready();
    await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, language: to });
    await db.logEvent(business.id, "account.language_set", { language: to });
  }
  revalidatePath("/app/account");
  redirect(localizeHref("/app/account?taal=opgeslagen", to));
}

/**
 * "Overal uitloggen" (feature 002, AC-3e): ends every sign-in of this login, here and on every
 * other device. Supabase revokes every refresh token (scope global); each other browser fails
 * its auth_session check on its next page, even while its access token is still valid.
 * About the login, not a business, so it takes no business field.
 */
export async function signOutEverywhere() {
  const { href } = await getI18n();
  const session = await getSession();
  if (session) {
    const supabase = await createServerSupabase();
    if (supabase) await supabase.auth.signOut({ scope: "global" });
    const ended = await (await ready()).endSignIns(session.userId, "signed_out_everywhere");
    log.info("auth.signed_out_everywhere", { ended });
  }
  (await cookies()).delete(MOCK_SESSION_COOKIE);
  redirect(href("/inloggen?uitgelogd=overal"));
}
