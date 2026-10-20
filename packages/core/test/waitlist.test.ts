import { describe, expect, it } from "vitest";
import { isListEmail, makeLimiter, parseWaitlist } from "../src/shared/waitlist";

describe("coming-soon list input", () => {
  it("accepts a normal address, trimmed and lower-cased", () => {
    expect(parseWaitlist({ email: "  Eigenaar@Bakkerij.NL ", consent: "ja", lang: "nl" })).toEqual({ ok: true, email: "eigenaar@bakkerij.nl", language: "nl" });
  });

  it("keeps English only when asked, anything else is Dutch", () => {
    expect(parseWaitlist({ email: "a@b.com", consent: "ja", lang: "en" }).language).toBe("en");
    expect(parseWaitlist({ email: "a@b.com", consent: "ja", lang: "<script>" }).language).toBe("nl");
  });

  it("a filled hidden field is a bot: no row, same thanks", () => {
    expect(parseWaitlist({ email: "a@b.com", consent: "ja", website: "http://spam" })).toMatchObject({ ok: false, reason: "trap" });
  });

  it("no ticked consent, no row", () => {
    expect(parseWaitlist({ email: "a@b.com" })).toMatchObject({ ok: false, reason: "no_consent" });
    expect(parseWaitlist({ email: "a@b.com", consent: "on" })).toMatchObject({ ok: false, reason: "no_consent" });
  });

  it("refuses what is not an address", () => {
    for (const bad of ["", "a@b", "a b@c.nl", "@b.nl", "a@@b.nl", "a@b.n", "a@b\u0000.nl", "a\tb@c.nl", "x".repeat(250) + "@b.nl", 42, null]) {
      expect(parseWaitlist({ email: bad, consent: "ja" })).toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(isListEmail("ab@cd.io")).toBe(true);
  });
});

describe("limiter", () => {
  it("lets the first N through per window, then refuses, then forgets", () => {
    const limited = makeLimiter(2, 1000);
    expect(limited("ip", 0)).toBe(false);
    expect(limited("ip", 10)).toBe(false);
    expect(limited("ip", 20)).toBe(true);
    expect(limited("other", 20)).toBe(false);
    expect(limited("ip", 2000)).toBe(false);
  });
});
