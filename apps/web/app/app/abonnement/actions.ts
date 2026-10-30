"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CANCEL_REASONS, PAUSE_MONTHS, cancelSubscription, pauseSubscription, resumeSubscription, undoCancel, type CancelReason, type PauseMonths } from "@vidalo/core/billing";
import { sendSubscriptionMail } from "@vidalo/core/reporter";
import type { BusinessRecord } from "@vidalo/core/db";
import { ready } from "@/lib/db";
import { getI18n } from "@/lib/i18n";
import { requireOwner } from "@/lib/owner";
import { subscriptionApi } from "@/lib/subscription";

/**
 * Cancel, undo, pause and resume (core/billing/lifecycle.ts). Signed-in owner
 * only, not only a Google-verified one: ending what you pay for must never
 * wait for a proof step. Each change is confirmed by mail straight away.
 */
async function owner() {
  const { business, session } = await requireOwner("/app/abonnement");
  // The confirmation goes to the owner on record, else to whoever is signed in.
  const to: BusinessRecord = { ...business, ownerEmail: business.ownerEmail ?? session.email };
  return { business, to, db: await ready(), api: await subscriptionApi(), href: (await getI18n()).href };
}

export async function cancelAction(form: FormData) {
  const { business, to, db, api, href } = await owner();
  const raw = String(form.get("reason") ?? "");
  const reason = (CANCEL_REASONS as readonly string[]).includes(raw) ? (raw as CancelReason) : null;
  const r = await cancelSubscription(db, api, business, { reason, comment: String(form.get("comment") ?? "") });
  if (!r.ok) redirect(href("/app/abonnement?fout=1"));
  await sendSubscriptionMail(to, "cancel_confirmed", r.at);
  revalidatePath("/app/abonnement");
  redirect(href("/app/abonnement?gewijzigd=opgezegd"));
}

export async function undoCancelAction() {
  const { business, to, db, api, href } = await owner();
  const r = await undoCancel(db, api, business);
  if (!r.ok) redirect(href("/app/abonnement?fout=1"));
  await sendSubscriptionMail(to, "cancel_undone");
  revalidatePath("/app/abonnement");
  redirect(href("/app/abonnement?gewijzigd=doorgaan"));
}

export async function pauseAction(form: FormData) {
  const { business, to, db, api, href } = await owner();
  const months = Number(form.get("months")) as PauseMonths;
  if (!PAUSE_MONTHS.includes(months)) redirect(href("/app/abonnement/pauzeren?fout=1"));
  const r = await pauseSubscription(db, api, business, months);
  if (!r.ok) redirect(href("/app/abonnement?fout=1"));
  await sendSubscriptionMail(to, "pause_confirmed", r.at);
  revalidatePath("/app/abonnement");
  redirect(href("/app/abonnement?gewijzigd=gepauzeerd"));
}

export async function resumeAction() {
  const { business, to, db, api, href } = await owner();
  const r = await resumeSubscription(db, api, business);
  if (!r.ok) redirect(href("/app/abonnement?fout=1"));
  await sendSubscriptionMail(to, "pause_ended");
  revalidatePath("/app/abonnement");
  redirect(href("/app/abonnement?gewijzigd=hervat"));
}
