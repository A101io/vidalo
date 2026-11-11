"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ready } from "@/lib/db";
import { getI18n } from "@/lib/i18n";
import { requireOwner } from "@/lib/owner";
import { MOCK_SESSION_COOKIE } from "@/lib/session";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase";
import { canDeleteMyData } from "@vidalo/core/shared";

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
