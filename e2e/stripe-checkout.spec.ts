import { expect, test, type Page } from "@playwright/test";
import { dismissNotice } from "./helpers";

/**
 * A real Stripe test-mode checkout, run with `pnpm e2e:stripe`
 * (scripts/e2e-stripe.sh starts `stripe listen` and checks the webhook
 * deliveries afterwards). Needs, on the Stripe account: the Terms and
 * Privacy URLs (consent_collection) and iDEAL + SEPA switched on.
 */
async function reportFor(page: Page, name: string) {
  await page.goto("/");
  await dismissNotice(page);
  const form = page.locator("form[action='/api/scan']").first();
  await form.locator("input[name='q']").fill(name);
  await form.locator("input[name='place']").fill("Rotterdam");
  await form.locator("button[type='submit']").click();
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 60_000 });
}

async function payWithTestCard(page: Page) {
  await page.waitForURL(/checkout\.stripe\.com/, { timeout: 30_000 });
  // What the customer is shown before paying: the amount, btw and the terms checkbox.
  await expect(page.getByText(/€\s?149/).first()).toBeVisible();
  await expect(page.getByText(/BTW|VAT/i).first()).toBeVisible();

  const email = page.locator("#email");
  if (await email.isVisible().catch(() => false)) await email.fill(`e2e+${Date.now()}@vidalo.io`);
  // Payment methods are an accordion; the card fields appear once "card" is chosen.
  // A transparent accordion button covers the "Kaart" row; Playwright counts it as hidden, so force the click.
  const cardTab = page.locator('[data-testid="card-accordion-item-button"]');
  if ((await cardTab.count()) > 0) await cardTab.dispatchEvent("click");
  await page.locator("#cardNumber").fill("4242424242424242");
  await page.locator("#cardExpiry").fill("12 / 34");
  await page.locator("#cardCvc").fill("123");
  await page.locator("#billingName").fill("E2E Test B.V.");
  const country = page.locator("#billingCountry");
  if (await country.isVisible().catch(() => false)) await country.selectOption("NL");
  await page.locator("#billingAddressLine1").fill("Factorij 80");
  await page.locator("#billingPostalCode").fill("3071 AV");
  await page.locator("#billingLocality").fill("Rotterdam");
  // tax_id_collection required when supported: NL is, so the btw-nummer is asked (Stripe's test VAT id).
  const business = page.locator("#businessName");
  if (await business.isVisible().catch(() => false)) await business.fill("E2E Test B.V.");
  // The tax-id type is its own dropdown and did not follow the billing country (it showed ES): choose NL.
  const taxType = page.getByRole("combobox", { name: /Belastinggegevens|Tax/ });
  if (await taxType.isVisible().catch(() => false)) await taxType.selectOption({ label: "NL BTW" });
  const taxId = page.locator("#taxId");
  if (await taxId.isVisible().catch(() => false)) await taxId.fill("NL000099998B57");
  const terms = page.locator("#termsOfServiceConsentCheckbox");
  await expect(terms, "the terms checkbox is shown and not pre-ticked").not.toBeChecked();
  await terms.check();
  await page.locator(".SubmitButton, button[type='submit']").first().click();
}

test("@stripe €149 setup: Stripe Checkout with a test card, back on /welkom", async ({ page }) => {
  await reportFor(page, `Stripe Setup E2E ${Date.now()}`);
  await page.locator("form[action='/api/checkout']:has(input[name='plan'][value='setup']) button").click();
  await payWithTestCard(page);
  await page.waitForURL(/\/welkom\?session_id=cs_test_/, { timeout: 60_000 });
  await expect(page.locator("h1")).toBeVisible();
});

test("@stripe €149 + €49/month: subscription checkout with a test card", async ({ page }) => {
  await reportFor(page, `Stripe Monitor E2E ${Date.now()}`);
  await page.locator("form[action='/api/checkout']:has(input[name='plan'][value='monitor']) button").click();
  await expect(page.getByText(/€\s?49/).first()).toBeVisible({ timeout: 30_000 });
  await payWithTestCard(page);
  await page.waitForURL(/\/welkom\?session_id=cs_test_/, { timeout: 60_000 });
  await expect(page.locator("h1")).toBeVisible();
});
