/**
 * Ownership proof by phone, next to the Google Business Profile sign-in
 * (shared/ownership.ts) while Google reviews our Business Profile API access.
 *
 * The number is never typed by the owner: it is the one Google Places lists for
 * the business's place id, so only whoever answers the business's own phone can
 * read the code back. Twilio Verify rings it (landlines) or texts it (mobiles),
 * makes and stores the code, and checks it.
 *
 * Limits on top of Twilio's own: 3 codes per business per 24 hours, 5 tries
 * per business per hour, counted from the event log.
 */
import { normalizePhone } from "../scanner/normalize.js";
import type { EventRow } from "../db/types.js";

export type PhoneChannel = "call" | "sms";

export interface TwilioVerifyConfig {
  accountSid: string;
  authToken: string;
  serviceSid: string;
}

export const PHONE_CODE_SENT = "owner.phone_code_sent";
export const PHONE_CODE_CHECKED = "owner.phone_code_checked";
export const PHONE_SENDS_PER_DAY = 3;
export const PHONE_CHECKS_PER_HOUR = 5;
/** Accepted in mock mode, where nothing is rung or texted. */
export const MOCK_PHONE_CODE = "123456";
const MOCK_PHONE = "+31201234567";

/** Dutch mobiles start with 6 after +31; everything else gets a call. */
export function defaultChannel(phone: string): PhoneChannel {
  return phone.startsWith("+316") ? "sms" : "call";
}

/** "+31201234567" -> "020 ••• ••67": enough to recognise, not enough to copy. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/^\+31/, "0");
  return `${d.slice(0, 3)} ••• ••${d.slice(-2)}`;
}

/** Why a new code may not go out now, or null. */
export function phoneSendBlocked(events: Pick<EventRow, "type" | "at">[], now = new Date()): "too_many_sends" | null {
  const since = now.getTime() - 24 * 3600_000;
  const sent = events.filter((e) => e.type === PHONE_CODE_SENT && Date.parse(e.at) >= since).length;
  return sent >= PHONE_SENDS_PER_DAY ? "too_many_sends" : null;
}

/** Why a code may not be checked now, or null. */
export function phoneCheckBlocked(events: Pick<EventRow, "type" | "at">[], now = new Date()): "too_many_tries" | null {
  const since = now.getTime() - 3600_000;
  const tries = events.filter((e) => e.type === PHONE_CODE_CHECKED && Date.parse(e.at) >= since).length;
  return tries >= PHONE_CHECKS_PER_HOUR ? "too_many_tries" : null;
}

/** The business's phone number as Google lists it, normalised; null when Google has none. */
export async function placePhone(placeId: string | null, o: { apiKey?: string; mock: boolean; fetchFn?: typeof fetch }): Promise<string | null> {
  if (!placeId) return null;
  if (!o.apiKey) return o.mock ? MOCK_PHONE : null;
  const res = await (o.fetchFn ?? fetch)(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: { "x-goog-api-key": o.apiKey, "x-goog-fieldmask": "internationalPhoneNumber,nationalPhoneNumber" },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`google places ${res.status}`);
  const p = (await res.json()) as { internationalPhoneNumber?: string; nationalPhoneNumber?: string };
  return normalizePhone(p.internationalPhoneNumber ?? p.nationalPhoneNumber);
}

function twilio(cfg: TwilioVerifyConfig, path: string, body: Record<string, string>, fetchFn: typeof fetch) {
  return fetchFn(`https://verify.twilio.com/v2/Services/${cfg.serviceSid}/${path}`, {
    method: "POST",
    headers: { authorization: `Basic ${btoa(`${cfg.accountSid}:${cfg.authToken}`)}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(10000),
  });
}

/**
 * Rings or texts a code to the number. Without Twilio only a mock build goes
 * on (nothing goes out and MOCK_PHONE_CODE works); a real build refuses.
 */
export async function sendPhoneCode(phone: string, channel: PhoneChannel, lang: "nl" | "en", o: { twilio?: TwilioVerifyConfig; mock: boolean; fetchFn?: typeof fetch }): Promise<boolean> {
  if (!o.twilio) return o.mock;
  const res = await twilio(o.twilio, "Verifications", { To: phone, Channel: channel, Locale: lang }, o.fetchFn ?? fetch);
  return res.ok;
}

/** True only when Twilio says the code for this number is approved. Any failure is a no. */
export async function checkPhoneCode(phone: string, code: string, o: { twilio?: TwilioVerifyConfig; mock: boolean; fetchFn?: typeof fetch }): Promise<boolean> {
  const c = code.replace(/\s/g, "");
  if (!/^\d{4,10}$/.test(c)) return false;
  if (!o.twilio) return o.mock && c === MOCK_PHONE_CODE;
  try {
    const res = await twilio(o.twilio, "VerificationCheck", { To: phone, Code: c }, o.fetchFn ?? fetch);
    if (!res.ok) return false;
    return ((await res.json()) as { status?: string }).status === "approved";
  } catch {
    return false;
  }
}
