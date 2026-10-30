import { describe, expect, it } from "vitest";
import { COMING_SOON_ROUTE, gateRoute, isGatedRoute } from "../src/shared/gate.js";

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
