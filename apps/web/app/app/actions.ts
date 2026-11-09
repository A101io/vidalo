"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ready } from "@/lib/db";
import { getI18n } from "@/lib/i18n";
import { requireOwner, requireVerifiedOwner } from "@/lib/owner";
import { LANGS, localizeHref, type Lang } from "@/lib/lang-paths";
import { disputeFinding, markFixedByOwner } from "@vidalo/core/fixer";
import { decideChannelDiff } from "@vidalo/core/publisher";
import { MOCK_SESSION_COOKIE } from "@/lib/session";
import { createAdminSupabase, createServerSupabase } from "@/lib/supabase";
import { canDeleteMyData, ondemandRefusal, ONDEMAND_EVENT } from "@vidalo/core/shared";
import { cancelDomain, domainOptions, undoDomainCancel } from "@vidalo/core/billing";
import { mailDomainAuthCode } from "@vidalo/core/registrar";
import { sendDomainMail } from "@vidalo/core/reporter";
import { subscriptionApi } from "@/lib/subscription";

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

/** The finding named in a form, if it belongs to the signed-in owner's business. */
async function ownFinding(formData: FormData, businessId: string) {
  const db = await ready();
  const id = String(formData.get("finding") ?? "");
  const finding = id ? await db.getFinding(id) : null;
  return finding && finding.businessId === businessId ? finding : null;
}

/** "Ik heb dit aangepast" on a finding: the recheck runs now instead of on the planned date. */
export async function markFixed(formData: FormData) {
  const { business } = await requireVerifiedOwner();
  const finding = await ownFinding(formData, business.id);
  const { href } = await getI18n();
  if (!finding) redirect(href("/app"));
  const fix = await markFixedByOwner(finding);
  revalidatePath("/app");
  revalidatePath(`/app/fouten/${finding.id}`);
  redirect(href(`/app/fouten/${finding.id}?${fix ? "hercontrole=ingepland" : "hercontrole=geen"}`));
}

/** "Dit klopt wél" on a finding: recorded, then the facts form opens on that fact so the owner corrects it. */
export async function dispute(formData: FormData) {
  const { business } = await requireOwner();
  const finding = await ownFinding(formData, business.id);
  const { href } = await getI18n();
  if (!finding) redirect(href("/app"));
  await disputeFinding(finding);
  revalidatePath(`/app/fouten/${finding.id}`);
  redirect(href(`/app/gegevens?betwist=${finding.id}#${finding.factKey}`));
}

/** The channel named in a form, if it belongs to the signed-in owner's business. */
async function ownChannel(formData: FormData, businessId: string) {
  const db = await ready();
  const id = String(formData.get("channel") ?? "");
  return (await db.listChannels(businessId)).find((c) => c.id === id) ?? null;
}

/** "Doorvoeren op Google": the held change is approved and a sync of that channel applies it. */
export async function approveChannelDiff(formData: FormData) {
  const { business } = await requireVerifiedOwner();
  const channel = await ownChannel(formData, business.id);
  const { href } = await getI18n();
  if (!channel) redirect(href("/app"));
  const decided = await decideChannelDiff(channel, "approved");
  revalidatePath("/app");
  revalidatePath(`/app/vermeldingen/${channel.id}`);
  redirect(href(`/app/vermeldingen/${channel.id}?besluit=${decided ? "doorgevoerd" : "niets"}`));
}

/** "Niet doorvoeren": the held change is declined; the profile stays as it is. */
export async function declineChannelDiff(formData: FormData) {
  const { business } = await requireVerifiedOwner();
  const channel = await ownChannel(formData, business.id);
  const { href } = await getI18n();
  if (!channel) redirect(href("/app"));
  const decided = await decideChannelDiff(channel, "declined");
  revalidatePath("/app");
  revalidatePath(`/app/vermeldingen/${channel.id}`);
  redirect(href(`/app/vermeldingen/${channel.id}?besluit=${decided ? "niet" : "niets"}`));
}

/** "Controleer nu": enqueue an on-demand scan for the owner's business. */
export async function checkNow() {
  const { business } = await requireVerifiedOwner();
  const db = await ready();
  const { href } = await getI18n();
  // The last check that ran, or one asked for and not started yet; the worker checks the runs again.
  const ran = await db.lastScanRunStartedAt(business.id, "ondemand");
  const asked = (await db.listEvents(business.id, 50)).find((e) => e.type === ONDEMAND_EVENT)?.at ?? null;
  const refused = ondemandRefusal(business, [ran, asked].filter(Boolean).sort().at(-1) ?? null);
  if (refused) redirect(href(`/app?controle=${refused}`));
  await db.enqueueJob("scan", { businessId: business.id, kind: "ondemand", then: ["fixes"] });
  await db.logEvent(business.id, ONDEMAND_EVENT, {});
  revalidatePath("/app");
  redirect(href("/app?controle=ingepland"));
}

/**
 * The domain add-on on /app/domein (core/billing/domain.ts). Buying goes
 * through POST /api/domain/checkout; these are what an owner does after.
 * Signed-in owner, not only a Google-verified one: stopping what you pay for
 * never waits for a proof step. Each change is confirmed by mail.
 */
async function domainOwner() {
  const { business } = await requireOwner("/app/domein");
  return { business, db: await ready(), api: await subscriptionApi(), href: (await getI18n()).href };
}

export async function cancelDomainAction() {
  const { business, db, api, href } = await domainOwner();
  const r = await cancelDomain(db, api, business);
  if (!r.ok) redirect(href("/app/domein?domein=nee#registreren"));
  const after = await db.getBusiness(business.id);
  if (after) await sendDomainMail(after, "domain_cancelled");
  revalidatePath("/app/domein");
  redirect(href("/app/domein?domein=opgezegd#registreren"));
}

export async function undoDomainCancelAction() {
  const { business, db, api, href } = await domainOwner();
  const r = await undoDomainCancel(db, api, business);
  if (!r.ok) redirect(href("/app/domein?domein=nee#registreren"));
  revalidatePath("/app/domein");
  redirect(href("/app/domein?domein=verlengd#registreren"));
}

/** The transfer code goes only to the owner's address on record, by mail; it is never shown on the page. */
export async function mailAuthCodeAction() {
  const { business, href } = await domainOwner();
  if (!domainOptions(business.domainRegistration).canGetAuthCode || !(await mailDomainAuthCode(business))) redirect(href("/app/domein?domein=nee#registreren"));
  redirect(href("/app/domein?domein=code#registreren"));
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
  // The domain add-on bills on its own: it is stopped first ("Niet verlengen" on /app/domein), like the subscription.
  const reg = business.domainRegistration;
  if (reg && (reg.status === "paid" || (reg.status === "registered" && !reg.cancelAt))) redirect(href("/app/account?gegevens=abonnement#gegevens"));
  // A domain that is still theirs keeps its way out: the transfer code goes to them before the record is gone.
  if (reg && domainOptions(reg).canGetAuthCode) await mailDomainAuthCode(business).catch(() => false);
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
