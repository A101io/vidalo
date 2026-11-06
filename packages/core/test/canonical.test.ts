import { describe, expect, it } from "vitest";
import { canonicalRedirect, REDIRECT_HOSTS } from "../src/shared/canonical.js";

describe("canonicalRedirect", () => {
  it("sends www and the old vidalo.io to the same path on vidalo.ai", () => {
    expect(REDIRECT_HOSTS).toEqual(["www.vidalo.ai", "vidalo.io", "www.vidalo.io"]);
    for (const host of REDIRECT_HOSTS) {
      expect(canonicalRedirect(`https://${host}/prijzen?x=1`, "GET")).toBe("https://vidalo.ai/prijzen?x=1");
    }
    expect(canonicalRedirect("http://WWW.VIDALO.IO/en/pricing", "GET")).toBe("https://vidalo.ai/en/pricing");
    expect(canonicalRedirect("https://vidalo.io/r/abc", "HEAD")).toBe("https://vidalo.ai/r/abc");
  });

  it("serves a POST where it lands (Stripe's webhook on vidalo.io does not follow redirects)", () => {
    expect(canonicalRedirect("https://vidalo.io/api/stripe/webhook", "POST")).toBeNull();
    // control: the same URL as a GET is redirected
    expect(canonicalRedirect("https://vidalo.io/api/stripe/webhook", "GET")).toBe("https://vidalo.ai/api/stripe/webhook");
  });

  it("leaves vidalo.ai, workers.dev and localhost alone", () => {
    expect(canonicalRedirect("https://vidalo.ai/prijzen", "GET")).toBeNull();
    expect(canonicalRedirect("https://vidalo-web.julian-devriend.workers.dev/", "GET")).toBeNull();
    expect(canonicalRedirect("http://localhost:3000/", "GET")).toBeNull();
  });

  it("does not redirect a host it does not know (control: a lookalike is not ours)", () => {
    expect(canonicalRedirect("https://vidalo.ai.example.com/", "GET")).toBeNull();
    expect(canonicalRedirect("https://vidalo.io.example.com/", "GET")).toBeNull();
    expect(canonicalRedirect("https://feiten.vidalo.io/", "GET")).toBeNull();
  });
});
