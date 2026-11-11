"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ready } from "@/lib/db";
import { getI18n } from "@/lib/i18n";
import { businessFromForm, requireOwnerOf, requireVerifiedOwnerOf } from "@/lib/owner";
import { disputeFinding, markFixedByOwner } from "@vidalo/core/fixer";
import { decideChannelDiff } from "@vidalo/core/publisher";
import { ondemandRefusal, ONDEMAND_EVENT } from "@vidalo/core/shared";

// Every action below names its business in the form (<input type="hidden" name="business">, F-020): it is read with
// businessFromForm and passed to requireOwnerOf / requireVerifiedOwnerOf FIRST, before anything is read or written. No
// business, a business of another login and an unknown id all end at /app with nothing changed. The cookie is never
// consulted, so a switch in another tab cannot send a form rendered for one business to another.

/** The finding named in a form, if it belongs to the business the form named. */
async function ownFinding(formData: FormData, businessId: string) {
  const db = await ready();
  const id = String(formData.get("finding") ?? "");
  const finding = id ? await db.getFinding(id) : null;
  return finding && finding.businessId === businessId ? finding : null;
}

/** "Ik heb dit aangepast" on a finding: the recheck runs now instead of on the planned date. */
export async function markFixed(formData: FormData) {
  const { business } = await requireVerifiedOwnerOf(businessFromForm(formData));
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
  const { business } = await requireOwnerOf(businessFromForm(formData));
  const finding = await ownFinding(formData, business.id);
  const { href } = await getI18n();
  if (!finding) redirect(href("/app"));
  await disputeFinding(finding);
  revalidatePath(`/app/fouten/${finding.id}`);
  redirect(href(`/app/gegevens?betwist=${finding.id}#${finding.factKey}`));
}

/** The channel named in a form, if it belongs to the business the form named. */
async function ownChannel(formData: FormData, businessId: string) {
  const db = await ready();
  const id = String(formData.get("channel") ?? "");
  return (await db.listChannels(businessId)).find((c) => c.id === id) ?? null;
}

/** "Doorvoeren op Google": the held change is approved and a sync of that channel applies it. */
export async function approveChannelDiff(formData: FormData) {
  const { business } = await requireVerifiedOwnerOf(businessFromForm(formData));
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
  const { business } = await requireVerifiedOwnerOf(businessFromForm(formData));
  const channel = await ownChannel(formData, business.id);
  const { href } = await getI18n();
  if (!channel) redirect(href("/app"));
  const decided = await decideChannelDiff(channel, "declined");
  revalidatePath("/app");
  revalidatePath(`/app/vermeldingen/${channel.id}`);
  redirect(href(`/app/vermeldingen/${channel.id}?besluit=${decided ? "niet" : "niets"}`));
}

/** "Controleer nu": enqueue an on-demand scan for the owner's business. */
export async function checkNow(formData: FormData) {
  const { business } = await requireVerifiedOwnerOf(businessFromForm(formData));
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
