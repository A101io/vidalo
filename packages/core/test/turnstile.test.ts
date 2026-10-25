import { describe, expect, it } from "vitest";
import { TURNSTILE_TEST_KEYS, TURNSTILE_VERIFY_URL, turnstileMode, turnstilePasses, verifyTurnstile } from "../src/shared/turnstile";

const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;

describe("turnstile mode", () => {
  it("is on with both keys, wherever it runs", () => {
    expect(turnstileMode({ secret: "s", siteKey: "k", production: false, mock: true })).toBe("on");
  });

  it("is off without keys only where nothing real happens", () => {
    expect(turnstileMode({ production: false, mock: false })).toBe("off");
    expect(turnstileMode({ production: true, mock: true })).toBe("off");
  });

  it("fails closed in a real production build without a key, or with half of it", () => {
    expect(turnstileMode({ production: true, mock: false })).toBe("misconfigured");
    expect(turnstileMode({ secret: "s", production: true, mock: false })).toBe("misconfigured");
    expect(turnstileMode({ siteKey: "k", production: true, mock: false })).toBe("misconfigured");
  });
});

describe("turnstile verification", () => {
  it("posts secret, token and address to Cloudflare and trusts only success: true", async () => {
    let seen: { url: string; body: string } | undefined;
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen = { url, body: String(init.body) };
      return { ok: true, json: async () => ({ success: true }) };
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", { secret: TURNSTILE_TEST_KEYS.secretPass, ip: "1.2.3.4", fetchFn })).toBe(true);
    expect(seen?.url).toBe(TURNSTILE_VERIFY_URL);
    expect(seen?.body).toContain("response=tok");
    expect(seen?.body).toContain("remoteip=1.2.3.4");
    expect(await verifyTurnstile("tok", { secret: "s", fetchFn: answer({ success: "true" }) })).toBe(false);
    expect(await verifyTurnstile("tok", { secret: "s", fetchFn: answer({ success: false }) })).toBe(false);
    expect(await verifyTurnstile("tok", { secret: "s", fetchFn: answer({ success: true }, false) })).toBe(false);
  });

  it("no token, a huge token or a network error is a no, without asking", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await verifyTurnstile("", { secret: "s", fetchFn })).toBe(false);
    expect(await verifyTurnstile(null, { secret: "s", fetchFn })).toBe(false);
    expect(await verifyTurnstile("x".repeat(3000), { secret: "s", fetchFn })).toBe(false);
    expect(calls).toBe(0);
    expect(await verifyTurnstile("tok", { secret: "s", fetchFn })).toBe(false);
  });

  it("off lets every post through; misconfigured lets none through", async () => {
    const fetchFn = answer({ success: true });
    expect(await turnstilePasses("off", undefined, {})).toBe(true);
    expect(await turnstilePasses("misconfigured", "tok", { secret: "s", fetchFn })).toBe(false);
    expect(await turnstilePasses("on", "tok", { secret: "s", fetchFn })).toBe(true);
    expect(await turnstilePasses("on", "", { secret: "s", fetchFn })).toBe(false);
  });
});
