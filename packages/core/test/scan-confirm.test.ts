import { describe, expect, it } from "vitest";
import {
  SCAN_CONFIRMED_EVENT,
  SCAN_CONFIRM_EVENT,
  SCAN_CONFIRM_TTL_MS,
  confirmAddressEvent,
  confirmIpEvent,
  findPending,
  ipBucket,
  newConfirmToken,
  parseConfirmToken,
  pendingPayload,
  scanIpEvent,
} from "../src/shared/index.js";
import { scanConfirmEmail } from "../src/reporter/index.js";

const BID = "4f1c2a3b-0000-4000-8000-000000000001";

describe("confirm token", () => {
  it("round-trips to the business and a hash, never the address", () => {
    const { token, hash } = newConfirmToken(BID);
    expect(token.startsWith(`${BID}.`)).toBe(true);
    expect(parseConfirmToken(token)).toEqual({ businessId: BID, hash });
    expect(hash).not.toContain(token);
  });
  it("refuses what cannot be a token", () => {
    for (const t of [undefined, "", BID, `${BID}.short`, `${BID}.${"a".repeat(32)}.x`, `a b.${"a".repeat(32)}`, "x".repeat(300)]) expect(parseConfirmToken(t)).toBeNull();
  });
});

describe("findPending", () => {
  const { hash } = newConfirmToken(BID);
  const now = Date.parse("2026-11-11T12:00:00Z");
  const pending = { type: SCAN_CONFIRM_EVENT, payload: pendingPayload({ email: "a@b.nl", marketing: true }, "en", hash), at: "2026-11-11T11:00:00Z" };
  it("finds the request this link belongs to", () => {
    expect(findPending([pending], hash, now)).toEqual({ ok: true, at: pending.at, pending: { email: "a@b.nl", marketing: true, lang: "en" } });
  });
  it("an unknown hash is unknown", () => {
    expect(findPending([pending], "other", now)).toEqual({ ok: false, reason: "unknown" });
  });
  it("expires after the TTL", () => {
    expect(findPending([pending], hash, Date.parse(pending.at) + SCAN_CONFIRM_TTL_MS + 1)).toEqual({ ok: false, reason: "expired" });
  });
  it("works once; a used link points where the first press went", () => {
    const used = { type: SCAN_CONFIRMED_EVENT, payload: { hash, to: "/scan/abc" }, at: "2026-11-11T11:05:00Z" };
    expect(findPending([used, pending], hash, now)).toEqual({ ok: false, reason: "used", to: "/scan/abc" });
  });
});

describe("ipBucket", () => {
  it("keeps IPv4 as it is, so existing counts stay valid", () => {
    expect(ipBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(scanIpEvent("203.0.113.7", new Date("2026-11-11T08:00:00Z"))).toBe(scanIpEvent(" 203.0.113.7 ", new Date("2026-11-11T20:00:00Z")));
  });
  it("counts IPv6 per /64, whatever the host part or notation", () => {
    const a = ipBucket("2001:db8:aa:bb:1:2:3:4");
    expect(a).toBe("2001:db8:aa:bb::/64");
    expect(ipBucket("2001:0db8:00aa:00bb:ffff::1")).toBe(a);
    expect(ipBucket("[2001:db8:aa:bb::9]")).toBe(a);
    expect(ipBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipBucket("::1")).toBe("0:0:0:0::/64");
    expect(ipBucket("fe80::1%en0")).toBe("fe80:0:0:0::/64");
    expect(ipBucket("2001:db8:aa:bc::1")).not.toBe(a);
  });
  it("reads an IPv4-mapped IPv6 address as IPv4", () => {
    expect(ipBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });
  it("one /64 shares one allowance", () => {
    const day = new Date("2026-11-11T08:00:00Z");
    expect(scanIpEvent("2001:db8:aa:bb::1", day)).toBe(scanIpEvent("2001:db8:aa:bb:dead:beef:0:7", day));
    expect(confirmIpEvent("2001:db8:aa:bb::1", day)).toBe(confirmIpEvent("2001:db8:aa:bb::2", day));
    expect(confirmIpEvent("2001:db8:aa:bb::1", day)).not.toBe(scanIpEvent("2001:db8:aa:bb::1", day));
  });
});

describe("confirmAddressEvent", () => {
  it("counts per address and day, holding no address", () => {
    const day = new Date("2026-11-11T08:00:00Z");
    const e = confirmAddressEvent("A@B.nl", day);
    expect(e).toBe(confirmAddressEvent("a@b.nl", day));
    expect(e).not.toContain("a@b");
    expect(e).not.toBe(confirmAddressEvent("a@b.nl", new Date("2026-11-12T08:00:00Z")));
  });
});

describe("scanConfirmEmail", () => {
  it("carries the link and says why, in both languages", () => {
    const nl = scanConfirmEmail({ business: { name: "Bakkerij de Vries" }, confirmUrl: "https://vidalo.ai/scan/bevestigen?t=x", lang: "nl" });
    expect(nl.subject).toContain("Bakkerij de Vries");
    expect(nl.text).toContain("https://vidalo.ai/scan/bevestigen?t=x");
    expect(nl.text).toContain("kwaadaardige bots");
    const en = scanConfirmEmail({ business: { name: "X" }, confirmUrl: "https://vidalo.ai/en/scan/bevestigen?t=x", lang: "en" });
    expect(en.text).toContain("malicious bots");
    expect(en.html).toContain("https://vidalo.ai/en/scan/bevestigen?t=x");
  });
});
