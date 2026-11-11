import { describe, expect, it } from "vitest";
import { LINK_LIMITS, overLimit, throttleIp, throttleKeys } from "../src/shared/auth-throttle";

/** Feature 002 AC-4(b), SEC-31: the keys and the rule. The counting itself is in db-account.test.ts (MemDb and PgDb). */
describe("throttleKeys", () => {
  it("are 64-hex HMACs that never contain the address or IP", async () => {
    const [a, i] = await throttleKeys("eigenaar@bakkerij.nl", "203.0.113.7", "s1");
    for (const k of [a, i]) expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain("eigenaar");
    expect(a).not.toBe(i);
  });
  it("count A@X.nl and a@x.nl together", async () => {
    expect((await throttleKeys(" A@X.nl ", "1.1.1.1", "s"))[0]).toBe((await throttleKeys("a@x.nl", "1.1.1.1", "s"))[0]);
  });
  it("differ under another secret", async () => {
    expect((await throttleKeys("a@x.nl", "1.1.1.1", "s1"))[0]).not.toBe((await throttleKeys("a@x.nl", "1.1.1.1", "s2"))[0]);
  });
});

describe("overLimit", () => {
  it("the 5th per address and the 20th per IP still go; the 6th and the 21st do not", () => {
    expect(LINK_LIMITS).toEqual({ perAddress: 5, perIp: 20, windowMs: 3_600_000 });
    expect(overLimit([5, 20])).toBe(false);
    expect(overLimit([6, 1])).toBe(true);
    expect(overLimit([1, 21])).toBe(true);
  });
});

describe("throttleIp", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("keys on cf-connecting-ip, never x-forwarded-for, on Cloudflare", () => {
    expect(throttleIp(h({ "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" }), false)).toBe("1.2.3.4");
    expect(throttleIp(h({ "x-forwarded-for": "9.9.9.9" }), false)).toBe("unknown");
  });
  it("takes x-forwarded-for only where it is trusted (local runs)", () => expect(throttleIp(h({ "x-forwarded-for": "9.9.9.9, 1.1.1.1" }), true)).toBe("9.9.9.9"));
});
