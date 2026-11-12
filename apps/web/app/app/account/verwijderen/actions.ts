"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { getI18n } from "@/lib/i18n";
import { businessFromForm, requireOwnerOf } from "@/lib/owner";
import { MOCK_SESSION_COOKIE, type Session } from "@/lib/session";
import { ACTIVE_BUSINESS_COOKIE } from "@/lib/active-business";
import { requireFreshSignIn } from "@/lib/fresh-sign-in";
import { getStripe } from "@/lib/stripe";
import { subscriptionApi } from "@/lib/subscription";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase";
import { cancelSubscription } from "@vidalo/core/billing";
import { deleteCustomHostname, isOwnFactsHost } from "@vidalo/core/publisher";
import { sendDeletedMail, sendDeletionScheduledMail } from "@vidalo/core/reporter";
import { deletionPlan, log, purgeBusiness, revokeGoogleToken, type PurgeDeps } from "@vidalo/core/shared";

/** The web's access to Stripe, Google, Cloudflare and Supabase Admin for one purge (ADR-0005). */
async function webPurgeDeps(session: Session): Promise<PurgeDeps> {
  const stripe = await getStripe();
  const admin = await createAdminSupabase();
  return {
    db: await ready(),
    now: new Date(),
    // The owner asked: never held back (F-010). Only retention purges read VIDALO_PURGE, in the worker.
    dryRunRetention: false,
    stripeLive: async (customerId) => {
      if (!stripe) {
        if (env.mock) return false;
        throw new Error("no Stripe key: cannot confirm that nothing bills");
      }
      const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });
      return subs.data.some((s) => s.status !== "canceled" && s.status !== "incomplete_expired");
    },
    revokeGoogle: async (token) => (env.hasGoogle ? revokeGoogleToken(token) : void log.info("google.revoke_mock", {})),
    deleteCustomHostname,
    deleteLogin: async (userId) => {
      if (!admin) {
        // Fail closed (V-COMP-01): only mock mode goes without the Admin key.
        if (!env.mock) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set: cannot delete the login");
        return void log.info("account.login_delete_mock", {});
      }
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error && error.status !== 404) throw new Error(`supabase admin ${error.status ?? "error"}`);
    },
    sendDeletedMail,
    isOwnFactsHost: (h, b) => isOwnFactsHost(h, b),
    // The confirmation goes to the login that asked.
    mailTo: session.email,
  };
}

/**
 * "Verwijder alles" (feature 002, AC-5b/c, ADR-0005), for every plan. Order (SEC-52): the business
 * named in the form, a sign-in from the last 15 minutes, the box ticked, then the plan. Without a
 * running subscription everything goes now; a running Vidalo Monthly is cancelled at the end of its
 * period and deleted on that date, with a mail straight away (F-013).
 */
export async function deleteMyData(formData: FormData) {
  const { business } = await requireOwnerOf(businessFromForm(formData), "/app/account/verwijderen");
  const session = await requireFreshSignIn("/app/account/verwijderen");
  const { href } = await getI18n();
  if (String(formData.get("confirm") ?? "") !== "ja") redirect(href("/app/account/verwijderen"));
  const db = await ready();
  const plan = deletionPlan(business);

  if (plan.kind === "now") {
    let outcome: "done" | "stripe_live" | "queued" = "queued";
    try {
      const out = await purgeBusiness(await webPurgeDeps(session), business.id, "no_subscription");
      outcome = out.done || out.reason === "not_found" ? "done" : out.reason === "stripe_live" ? "stripe_live" : "queued";
    } catch (err) {
      // A step before the delete failed (Cloudflare, Stripe unreachable): the worker finishes it.
      log.warn("account.delete_step_failed", { error: err instanceof Error ? err.name : "unknown" });
    }
    if (outcome === "stripe_live") redirect(href("/app/account?gegevens=fout#gegevens"));
    if (outcome === "queued") {
      await db.enqueueJob("purge", { businessId: business.id, guard: "no_subscription" });
      log.warn("account.delete_queued", { businessId: business.id });
    }
    const done = outcome === "done";
    if (!done) redirect(href("/app/account?gegevens=bezig#gegevens"));
    const supabase = await createServerSupabase();
    if (supabase) await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    const store = await cookies();
    store.delete(MOCK_SESSION_COOKIE);
    store.delete(ACTIVE_BUSINESS_COOKIE);
    redirect(href("/inloggen?verwijderd=1"));
  }

  let at = plan.at;
  if (plan.needsCancel) {
    const r = await cancelSubscription(db, await subscriptionApi(), business, { reason: null });
    if (!r.ok) redirect(href("/app/account?gegevens=fout#gegevens"));
    at = r.at;
  }
  // `at` is Stripe's end of period (or the one already on record), never a value from the form.
  await db.setDeletion(business.id, { at: at!, reason: "owner" });
  await db.logEvent(business.id, "account.deletion_scheduled", { at });
  await sendDeletionScheduledMail(business, at!, business.ownerEmail ?? session.email);
  revalidatePath("/app/account");
  redirect(href("/app/account?gegevens=gepland#gegevens"));
}

/** "Toch bewaren": calls the owner's scheduled deletion off. The cancel stays (undo it under Abonnement). */
export async function callOffDeletion(formData: FormData) {
  const { business } = await requireOwnerOf(businessFromForm(formData), "/app/account");
  const { href } = await getI18n();
  if (business.deleteReason === "owner") {
    const db = await ready();
    await db.setDeletion(business.id, null);
    await db.logEvent(business.id, "account.deletion_called_off", {});
  }
  revalidatePath("/app/account");
  redirect(href("/app/account?gegevens=bewaard#gegevens"));
}
