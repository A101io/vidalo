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
  // F-009: the no-Stripe branch must test env.mock. That is BE-02's change (route.ts is its file).
  it.todo("the no-Stripe branch tests env.mock (pins F-009; arrives with BE-02)");
});
