#!/usr/bin/env node
/**
 * Twilio Verify for the phone ownership proof (core/shared/phone-proof.ts),
 * from the two account keys in the root .env, without printing a value.
 *
 *   pnpm twilio:setup            what the account has: type, Verify service, WhatsApp senders, NL permissions
 *   pnpm twilio:setup --apply    create the Verify service "Vidalo" (SMS, voice, WhatsApp) when none is set,
 *                                and write TWILIO_VERIFY_SERVICE_SID to .env
 *
 * Needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env. Geo permissions and
 * the WhatsApp sender have no API for a fresh account: the script says what is
 * missing and where to click. Then: pnpm secrets:push --apply --allow-spending
 * --only TWILIO_ACCOUNT_SID,TWILIO_AUTH_TOKEN,TWILIO_VERIFY_SERVICE_SID
 */
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const envFile = path.join(root, ".env");
const apply = process.argv.includes("--apply");
const env = parseEnv(readFileSync(envFile, "utf8"));
const sid = env.TWILIO_ACCOUNT_SID?.trim();
const token = env.TWILIO_AUTH_TOKEN?.trim();
if (!sid || !token) {
  console.error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be in .env first (https://console.twilio.com, Account Info).");
  process.exit(2);
}
const auth = `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;

async function call(url, body) {
  const res = await fetch(url, body ? { method: "POST", headers: { authorization: auth, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body) } : { headers: { authorization: auth } });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url.replace(/https:\/\/[^/]+/, "")} ${res.status}: ${json.message ?? ""}`);
  return json;
}

const account = await call(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`);
console.log(`Account: ${account.friendly_name} (${account.type}, ${account.status})`);
if (account.type === "Trial") console.log("  trial: only verified numbers can be reached. Upgrade: https://console.twilio.com/us1/billing/manage-billing/upgrade");

const services = (await call("https://verify.twilio.com/v2/Services?PageSize=50")).services ?? [];
let service = services.find((s) => s.sid === env.TWILIO_VERIFY_SERVICE_SID?.trim()) ?? services.find((s) => s.friendly_name === "Vidalo");
if (!service && apply) {
  service = await call("https://verify.twilio.com/v2/Services", { FriendlyName: "Vidalo", CodeLength: "6", DoNotShareWarningEnabled: "true" });
  console.log(`Verify service created: ${service.sid}`);
}
if (service) {
  console.log(`Verify service: ${service.friendly_name} ${service.sid}`);
  if (env.TWILIO_VERIFY_SERVICE_SID?.trim() !== service.sid) {
    if (apply) {
      appendFileSync(envFile, `\nTWILIO_VERIFY_SERVICE_SID=${service.sid}\n`);
      console.log("  written to .env as TWILIO_VERIFY_SERVICE_SID (remove any older empty line)");
    } else console.log(`  not in .env yet: TWILIO_VERIFY_SERVICE_SID=${service.sid}`);
  }
} else console.log("Verify service: none named Vidalo (add --apply to create it)");

const senders = (await call("https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&PageSize=20")).senders ?? [];
console.log(`WhatsApp senders: ${senders.length ? senders.map((s) => `${s.sender_id} ${s.status}`).join(", ") : "none"}`);
if (!senders.some((s) => s.status === "ONLINE")) console.log("  create one: https://console.twilio.com/us1/develop/sms/senders/whatsapp-senders (Continue with Facebook, display name Vidalo)");

const voice = await call("https://voice.twilio.com/v1/DialingPermissions/Countries/NL");
console.log(`Voice to NL: landlines ${voice.low_risk_numbers_enabled ? "on" : "OFF"}, high-risk ${voice.high_risk_special_numbers_enabled ? "on" : "off"}`);
if (!voice.low_risk_numbers_enabled) console.log("  switch on Netherlands: https://console.twilio.com/us1/develop/voice/settings/geo-permissions");
console.log("SMS geo permissions have no read API: check Netherlands at https://console.twilio.com/us1/develop/sms/settings/geo-permissions");
