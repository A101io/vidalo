import { expect, test } from "@playwright/test";

/**
 * The launch gate (go-live J4, core/shared/gate.ts), run with `pnpm e2e:gate`:
 * marketing pages show /binnenkort, while legal pages, reports and sign-in
 * keep working, and the preview key opens the whole site.
 */
test("@gate marketing pages show the coming-soon page", async ({ page }) => {
  for (const url of ["/", "/prijzen", "/vak/horeca"]) {
    await page.goto(url);
    await expect(page.locator("main"), url).toBeVisible();
    await expect(page.locator("h1"), url).toBeVisible();
    expect(await page.locator("form[action='/api/scan']").count(), `${url} has no scan form behind the gate`).toBe(0);
  }
  await page.goto("/en/pricing");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("@gate legal pages, the example report and sign-in stay reachable", async ({ page }) => {
  for (const url of ["/voorwaarden", "/privacy", "/cookies", "/r/voorbeeld", "/inloggen", "/en/terms"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBe(200);
    await expect(page.locator("form[action='/api/scan'], main"), url).not.toHaveCount(0);
  }
  // Stripe and the browser must be able to read the terms through the gate.
  await page.goto("/voorwaarden");
  await expect(page).toHaveURL(/\/voorwaarden$/);
});

test("@gate the preview button opens the whole site", async ({ page }) => {
  await page.goto("/");
  const button = page.getByRole("link", { name: /Bekijk de site alvast/ }).or(page.getByRole("button", { name: /Bekijk de site alvast/ }));
  await button.first().click();
  await page.goto("/");
  await expect(page.locator("form[action='/api/scan']").first()).toBeVisible();
});
