import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { COMING_SOON_ROUTE, PREVIEW_TOKEN_LABEL, gateRoute, isGatedRoute, previewToken, samePreviewToken } from "../src/shared/gate.js";

const on = { comingSoon: true, preview: false };

describe("launch gate (go-live J4)", () => {
  it("hides the marketing pages while the gate is on", () => {
    for (const route of ["/", "/prijzen", "/hoe-het-werkt", "/waarom", "/straks", "/vak/loodgieters-installateurs", "/scan/kies", "/scan/abc"]) {
      expect(gateRoute(route, on), route).toBe(COMING_SOON_ROUTE);
    }
  });

  it("keeps every page a visitor has a right to or a link to (invariant: legal, reports, account, unsubscribe)", () => {
    for (const route of ["/privacy", "/voorwaarden", "/cookies", "/contact", "/binnenkort", "/r/abc", "/inloggen", "/auth/callback", "/app", "/app/abonnement", "/afmelden", "/feiten", "/feiten/bakkerij", "/welkom", "/eigenaar/bevestigen"]) {
      expect(gateRoute(route, on), route).toBe(route);
    }
  });

  it("control: with the gate off, or with the preview cookie, nothing is rewritten", () => {
    expect(gateRoute("/", { comingSoon: false, preview: false })).toBe("/");
    expect(gateRoute("/prijzen", { comingSoon: true, preview: true })).toBe("/prijzen");
  });

  it("matches whole path segments only (a lookalike route is not gated)", () => {
    expect(isGatedRoute("/vakantie")).toBe(false);
    expect(isGatedRoute("/scanner")).toBe(false);
    expect(isGatedRoute("/vak")).toBe(true);
  });
});

describe("preview cookie", () => {
  it("is the HMAC of the label under the key, the same in Web Crypto and node:crypto", async () => {
    const token = await previewToken("e2e-preview-key");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toBe(createHmac("sha256", "e2e-preview-key").update(PREVIEW_TOKEN_LABEL).digest("hex"));
    expect(await previewToken("another-key")).not.toBe(token);
  });

  it("opens the gate only for the token of the current key", async () => {
    const token = await previewToken("k1");
    expect(samePreviewToken(token, token)).toBe(true);
    for (const forged of ["1", "", undefined, token.slice(0, 63), await previewToken("k2")]) {
      expect(samePreviewToken(forged, token), String(forged)).toBe(false);
    }
    // No key configured: nobody passes, whatever the cookie says.
    expect(samePreviewToken(token, null)).toBe(false);
  });
});
