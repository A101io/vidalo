import { expect, test, type Page } from "@playwright/test";
import { collectErrors, dismissNotice, expectNoErrors } from "./helpers";

/**
 * The customer path in mock mode: free check from the landing page, the
 * waiting room, the report, then each plan's checkout. Without a Stripe key
 * the checkout marks the business paid and lands on /welkom (api/checkout).
 */
async function runFreeCheck(page: Page, name: string, lang: "nl" | "en" = "nl") {
  await page.goto(lang === "nl" ? "/" : "/en");
  await dismissNotice(page);
  const form = page.locator("form[action='/api/scan']").first();
  await form.locator("input[name='q']").fill(name);
  await form.locator("input[name='place']").fill("Haarlem");
  await form.locator("button[type='submit']").click();
  // Waiting room, then the report (mock engines answer in seconds).
  await page.waitForURL(/\/(en\/)?(scan|r)\//);
  await page.waitForURL(/\/(en\/)?r\/[^/?#]+/, { timeout: 60_000 });
}

test("@smoke a free check reaches its report", async ({ page }) => {
  const errors = collectErrors(page);
  await runFreeCheck(page, `Bakkerij E2E ${Date.now()}`);
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("form[action='/api/checkout']")).toHaveCount(2);
  await expect(page.getByText(/excl\.? btw/i).first()).toBeVisible();
  await expectNoErrors(errors);
});

test("a free check in English stays English", async ({ page }) => {
  await runFreeCheck(page, `Garage E2E ${Date.now()}`, "en");
  await expect(page).toHaveURL(/\/en\/r\//);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("asking again within a day shows the same report", async ({ page }) => {
  const name = `Kapper E2E ${Date.now()}`;
  await runFreeCheck(page, name);
  const first = page.url();
  await runFreeCheck(page, name);
  expect(page.url()).toBe(first);
});

for (const plan of ["monitor", "setup"] as const) {
  test(`checkout ${plan} (mock) lands on the welcome page`, async ({ page }) => {
    const errors = collectErrors(page);
    await runFreeCheck(page, `Loodgieter ${plan} ${Date.now()}`);
    await page.locator(`form[action='/api/checkout']:has(input[name='plan'][value='${plan}']) button`).click();
    await page.waitForURL(/\/welkom\?/);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();
    await expectNoErrors(errors);
  });
}

test("an empty check goes back to the form", async ({ page }) => {
  await page.goto("/");
  await dismissNotice(page);
  // Bypass the browser's required check: the server must refuse too.
  await page.evaluate(() => document.querySelectorAll("input[name='q']").forEach((i) => i.removeAttribute("required")));
  await page.locator("form[action='/api/scan'] button[type='submit']").first().click();
  await expect(page).toHaveURL(/fout=leeg/);
});
