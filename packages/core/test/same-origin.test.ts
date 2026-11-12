import { describe, expect, it } from "vitest";
import { refuseCrossSite } from "../src/shared/same-origin";

/** Feature 002 AC-4(e), SEC-35. */
const BASE = "https://vidalo.ai";
const req = (h: Record<string, string>) => ({ headers: new Headers(h) });

describe("refuseCrossSite", () => {
  const refused: Record<string, string>[] = [
    { origin: "https://evil.example" },
    { origin: "null" },
    { origin: "https://x-feiten.vidalo.io" },
    { origin: "https://feiten.klant.nl" },
    { origin: "https://vidalo.ai.evil.example" },
    { origin: "https://evilvidalo.ai" },
    { origin: "http://vidalo.ai" },
    { origin: "https://vidalo.ai:8443" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
    {},
  ];
  for (const h of refused) it(`refuses ${JSON.stringify(h)}`, () => expect(refuseCrossSite(req(h), BASE)?.status).toBe(403));
  const allowed: Record<string, string>[] = [
    { origin: "https://vidalo.ai" },
    { origin: "https://www.vidalo.ai" },
    { origin: "https://vidalo.io" },
    { origin: "https://vidalo-web-staging.julian-devriend.workers.dev" },
    { "sec-fetch-site": "same-origin" },
  ];
  for (const h of allowed) it(`allows ${JSON.stringify(h)}`, () => expect(refuseCrossSite(req(h), BASE)).toBeNull());
  it("allows the configured base, http on localhost included", () => expect(refuseCrossSite(req({ origin: "http://localhost:3000" }), "http://localhost:3000")).toBeNull());
});
