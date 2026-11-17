/**
 * The B2B consent at checkout cannot be loosened silently (feature 003, AC-12, F-012).
 * apps/web has no unit-test runner, so the route is read as text, as legal.test.ts reads the source tree.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { copy } from "../src/copy/index";
import { en } from "../src/copy/en";

const route = readFileSync(join(__dirname, "../../../apps/web/app/api/checkout/route.ts"), "utf8");

describe("checkout consent", () => {
  it("the terms box is required", () => {
    expect(route).toMatch(/consent_collection:\s*\{\s*terms_of_service:\s*"required"\s*\}/);
  });
  it("the custom text carries the B2B sentence and the acceptance", () => {
    expect(route).toMatch(/custom_text:[\s\S]*consentSubmit\(/);
    expect(route).toMatch(/custom_text:[\s\S]*consentAccept\(/);
  });
  it("the sentence says Vidalo is not for consumers, in both languages", () => {
    expect(copy.checkout.consentSubmit("t", "p")).toContain("niet voor consumenten");
    expect(en.checkout.consentSubmit("t", "p")).toContain("not consumers");
  });
  // F-009 (BE-02): without a Stripe key, only mock mode may mark a business paid.
  it("the no-Stripe branch refuses outside mock mode, before any status change", () => {
    const refuse = route.search(/if \(!stripe && !env\.mock\) \{[\s\S]*?reason: "no_stripe"[\s\S]*?betaling=fout/);
    expect(refuse).toBeGreaterThan(-1);
    const paidMock = route.indexOf('transitionStatus(business.id, "trial"');
    expect(paidMock).toBeGreaterThan(refuse);
  });
  it("the mock path queues the same order mail as the webhook (ADR-0008)", () => {
    expect(route).toMatch(/queueOrderConfirmation\(business, mockCheckoutSession\(plan, lang,/);
  });
  // F-020 (BE-02): Monthly is added only to a paid, running Scan.
  it("an add-on without a paid Scan is refused before Stripe is asked", () => {
    const refuse = route.search(/business\.plan !== "setup" \|\| \(business\.status !== "trial" && business\.status !== "active"\)\) \{[\s\S]*?reason: "addon_without_scan"[\s\S]*?\/app\/abonnement/);
    expect(refuse).toBeGreaterThan(-1);
    expect(route.indexOf("getStripe()")).toBeGreaterThan(refuse);
  });
});
