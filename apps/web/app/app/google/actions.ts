"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  PHONE_CODE_CHECKED,
  PHONE_CODE_SENT,
  checkPhoneCode,
  PHONE_CHANNELS,
  defaultChannel,
  isMobile,
  isVerifiedOwner,
  maskPhone,
  phoneCheckBlocked,
  phoneSendBlocked,
  placePhone,
  sendPhoneCode,
  type PhoneChannel,
} from "@vidalo/core/shared";
import { ready } from "@/lib/db";
import { env } from "@/lib/env";
import { getI18n } from "@/lib/i18n";
import { requireOwner } from "@/lib/owner";

const back = async (q: string) => redirect((await getI18n()).href(`/app/google?${q}`));
/** Only an explicit mock build (VIDALO_MOCK=1) may go without Twilio. */
const phoneOpts = () => ({ twilio: env.twilioVerify, mock: !env.realEngines });

async function businessPhone(placeId: string | null): Promise<string | null> {
  try {
    return await placePhone(placeId, { apiKey: env.googlePlacesKey, mock: !env.realEngines });
  } catch {
    return null;
  }
}

/** "Bel me" / "Stuur een sms": a code to the number Google lists for the business. */
export async function sendOwnerPhoneCode(formData: FormData) {
  const { business, session } = await requireOwner("/app/google");
  if (isVerifiedOwner(business, session.userId)) return back("gekoppeld=1");
  const db = await ready();
  if (phoneSendBlocked(await db.listEvents(business.id, 200))) return back("telefoon=fout&reden=too_many_sends");
  const phone = await businessPhone(business.googlePlaceId);
  if (!phone) return back("telefoon=fout&reden=no_phone");
  const asked = String(formData.get("channel") ?? "") as PhoneChannel;
  const channel: PhoneChannel = PHONE_CHANNELS.includes(asked) && (asked !== "whatsapp" || env.whatsappCodes || !env.realEngines) ? asked : defaultChannel(phone);
  // SMS and WhatsApp reach mobiles only; a landline gets the call.
  if (channel !== "call" && !isMobile(phone)) return back("telefoon=fout&reden=no_mobile");
  const ok = await sendPhoneCode(phone, channel, (await getI18n()).lang, phoneOpts()).catch(() => false);
  await db.logEvent(business.id, PHONE_CODE_SENT, { channel, ok, phone: maskPhone(phone), userId: session.userId });
  return back(ok ? `telefoon=verstuurd&via=${channel}` : "telefoon=fout&reden=send_failed");
}

/** The code read back: proves ownership the same way the Google sign-in does (api/google/callback). */
export async function checkOwnerPhoneCode(formData: FormData) {
  const { business, session } = await requireOwner("/app/google");
  if (isVerifiedOwner(business, session.userId)) return back("gekoppeld=1");
  const db = await ready();
  if (phoneCheckBlocked(await db.listEvents(business.id, 200))) return back("telefoon=fout&reden=too_many_tries");
  const phone = await businessPhone(business.googlePlaceId);
  if (!phone) return back("telefoon=fout&reden=no_phone");
  const ok = await checkPhoneCode(phone, String(formData.get("code") ?? ""), phoneOpts());
  await db.logEvent(business.id, PHONE_CODE_CHECKED, { ok, userId: session.userId });
  if (!ok) return back("telefoon=verstuurd&reden=wrong_code");

  const previous = { ownerEmail: business.ownerEmail, ownerUserId: business.ownerUserId };
  await db.upsertBusiness({
    id: business.id,
    slug: business.slug,
    name: business.name,
    place: business.place,
    ownerUserId: session.userId,
    ownerEmail: session.email,
    ownerVerifiedAt: new Date().toISOString(),
    ownerVerifiedVia: "phone_code",
  });
  await db.logEvent(business.id, "owner.verified", { via: "phone_code", phone: maskPhone(phone), userId: session.userId, email: session.email, previous });
  // A paying business waited for this: setup was skipped until now.
  if (business.status === "trial" || business.status === "active") await db.enqueueJob("setup", { businessId: business.id });
  revalidatePath("/app");
  return back("gekoppeld=1");
}
