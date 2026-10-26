import { describe, expect, it } from "vitest";
import {
  MOCK_PHONE_CODE,
  PHONE_CODE_CHECKED,
  PHONE_CODE_SENT,
  checkPhoneCode,
  defaultChannel,
  maskPhone,
  phoneCheckBlocked,
  phoneSendBlocked,
  placePhone,
  sendPhoneCode,
} from "../src/shared/phone-proof";

const twilio = { accountSid: "AC1", authToken: "tok", serviceSid: "VA1" };
const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("ownership by phone code", () => {
  it("calls landlines and texts mobiles", () => {
    expect(defaultChannel("+31201234567")).toBe("call");
    expect(defaultChannel("+31612345678")).toBe("sms");
  });

  it("masks all but the area code and the last two digits", () => {
    expect(maskPhone("+31201234567")).toBe("020 ••• ••67");
  });

  it("allows three codes per day and five tries per hour", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const at = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
    const sent = [at(1), at(2), at(3)].map((a) => ({ type: PHONE_CODE_SENT, at: a }));
    expect(phoneSendBlocked(sent.slice(0, 2), now)).toBeNull();
    expect(phoneSendBlocked(sent, now)).toBe("too_many_sends");
    expect(phoneSendBlocked([...sent.slice(0, 2), { type: PHONE_CODE_SENT, at: at(25) }], now)).toBeNull();
    const tries = Array.from({ length: 5 }, () => ({ type: PHONE_CODE_CHECKED, at: at(0.5) }));
    expect(phoneCheckBlocked(tries.slice(0, 4), now)).toBeNull();
    expect(phoneCheckBlocked(tries, now)).toBe("too_many_tries");
  });

  it("takes the number from Google, never from the owner", async () => {
    expect(await placePhone("p1", { apiKey: "k", mock: false, fetchFn: reply(200, { nationalPhoneNumber: "023 123 4567" }) })).toBe("+31231234567");
    expect(await placePhone("p1", { apiKey: "k", mock: false, fetchFn: reply(200, {}) })).toBeNull();
    expect(await placePhone(null, { apiKey: "k", mock: true })).toBeNull();
    expect(await placePhone("p1", { mock: false })).toBeNull();
  });

  it("accepts only an approved check from Twilio", async () => {
    expect(await checkPhoneCode("+31201234567", "123 456", { twilio, mock: false, fetchFn: reply(200, { status: "approved" }) })).toBe(true);
    expect(await checkPhoneCode("+31201234567", "123456", { twilio, mock: false, fetchFn: reply(200, { status: "pending" }) })).toBe(false);
    expect(await checkPhoneCode("+31201234567", "123456", { twilio, mock: false, fetchFn: reply(404, {}) })).toBe(false);
    expect(await checkPhoneCode("+31201234567", "abc", { twilio, mock: false, fetchFn: reply(200, { status: "approved" }) })).toBe(false);
  });

  it("without Twilio only a mock build sends and accepts the mock code", async () => {
    expect(await sendPhoneCode("+31201234567", "call", "nl", { mock: true })).toBe(true);
    expect(await checkPhoneCode("+31201234567", MOCK_PHONE_CODE, { mock: true })).toBe(true);
    expect(await sendPhoneCode("+31201234567", "call", "nl", { mock: false })).toBe(false);
    expect(await checkPhoneCode("+31201234567", MOCK_PHONE_CODE, { mock: false })).toBe(false);
  });

  it("asks Twilio Verify in the owner's language", async () => {
    let seen: { url: string; body: string } | null = null;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, body: String(init.body) };
      return new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;
    expect(await sendPhoneCode("+31201234567", "call", "nl", { twilio, mock: false, fetchFn })).toBe(true);
    expect(seen!.url).toBe("https://verify.twilio.com/v2/Services/VA1/Verifications");
    expect(seen!.body).toBe("To=%2B31201234567&Channel=call&Locale=nl");
  });
});
