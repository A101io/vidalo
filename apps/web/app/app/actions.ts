"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ready } from "@/lib/db";
import { getI18n } from "@/lib/i18n";
import { requireOwner, requireVerifiedOwner } from "@/lib/owner";
import { LANGS, localizeHref, type Lang } from "@/lib/lang-paths";
import { MOCK_SESSION_COOKIE } from "@/lib/session";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase";
import { canDeleteMyData } from "@vidalo/core/shared";

/** The language row on the account page: save it, then show the account in that language. */
export async function setLanguage(formData: FormData) {
  const { business } = await requireOwner("/app/account");
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

/** "Controleer nu": enqueue an on-demand scan for the owner's business. */
export async function checkNow() {
  const { business } = await requireVerifiedOwner();
  const db = await ready();
  await db.enqueueJob("scan", { businessId: business.id, kind: "ondemand", then: ["fixes"] });
  await db.logEvent(business.id, "scan.ondemand_requested", {});
  revalidatePath("/app");
  redirect((await getI18n()).href("/app?controle=ingepland"));
}

/** Option B on the domain page: let Vidalo register a domain. */
export async function registerDomain() {
  const { business } = await requireVerifiedOwner("/app/domein");
  const db = await ready();
  await db.enqueueJob("operator_task", { reason: "domain_register", businessId: business.id, suggestion: `${business.slug}.nl` });
  await db.logEvent(business.id, "domain.register_requested", {});
  revalidatePath("/app/domein");
  redirect((await getI18n()).href("/app/domein?registreren=ingepland"));
}

/**
 * "Verwijder alles" on the account page (AVG art. 17, core/shared/my-data.ts):
 * the business and everything under it, then the login, then the session.
 * Waits until no subscription runs.
 */
export async function deleteMyData(formData: FormData) {
  const { business, session } = await requireOwner("/app/account");
  const { href } = await getI18n();
  if (String(formData.get("confirm") ?? "") !== "ja") redirect(href("/app/account#gegevens"));
  if (!canDeleteMyData(business.status)) redirect(href("/app/account?gegevens=abonnement#gegevens"));
  const db = await ready();
  await db.deleteBusiness(business.id);
  // No business id and no address: only that a deletion happened.
  await db.logEvent(null, "account.deleted", {});
  const admin = await createAdminSupabase();
  if (admin && !session.userId.startsWith("mock-")) await admin.auth.admin.deleteUser(session.userId);
  const supabase = await createServerSupabase();
  if (supabase) await supabase.auth.signOut();
  (await cookies()).delete(MOCK_SESSION_COOKIE);
  redirect(href("/inloggen?verwijderd=1"));
}
