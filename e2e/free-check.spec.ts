import { expect, test, type Page } from "@playwright/test";
import { collectErrors, confirmCheck, dismissNotice, expectNoErrors } from "./helpers";

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
  // Nothing runs without an address: the report is mailed there (core/shared/free-check.ts).
  await form.locator("input[name='email']").fill("e2e@example.nl");
  await form.locator("button[type='submit']").click();
  // Nothing runs before the address is confirmed: follow the mail's link.
  await confirmCheck(page);
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
    // Only Vidalo Monthly promises a report every month (review CMP-01).
    const monthly = page.getByText("Daarna krijg je elke maand een rapport.");
    const scanOnly = page.getByText("Elke maand controleren hoort bij Vidalo Monthly.");
    await expect(plan === "monitor" ? monthly : scanOnly).toBeVisible();
    await expect(plan === "monitor" ? scanOnly : monthly).toHaveCount(0);
    await expectNoErrors(errors);
  });
}

test("nothing starts before the mail link is pressed, and the link works once", async ({ page }) => {
  await page.goto("/");
  await dismissNotice(page);
  const form = page.locator("form[action='/api/scan']").first();
  await form.locator("input[name='q']").fill(`Slager E2E ${Date.now()}`);
  await form.locator("input[name='place']").fill("Haarlem");
  await form.locator("input[name='email']").fill("e2e@example.nl");
  await form.locator("button[type='submit']").click();
  await page.waitForURL(/\/scan\/mail\?/);
  await expect(page.getByText(/kwaadaardige bots/)).toBeVisible();
  // Opening the link starts nothing; only the button does.
  await page.getByTestId("confirm-link").click();
  await page.waitForURL(/\/scan\/bevestigen\?t=/);
  const link = page.url();
  await expect(page.locator("h1")).toContainText("Start de controle van");
  await page.locator("main form[action='/api/scan/bevestigen'] button[type='submit']").click();
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 60_000 });
  const report = page.url();
  // A second press goes where the first went; it starts nothing new.
  await page.goto(link);
  await page.locator("main form[action='/api/scan/bevestigen'] button[type='submit']").click();
  await page.waitForURL(/\/(scan|r)\//);
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 60_000 });
  expect(page.url()).toBe(report);
});

test("a made-up link starts nothing", async ({ page }) => {
  await page.goto(`/scan/bevestigen?t=${encodeURIComponent(`nope.${"a".repeat(32)}`)}`);
  await expect(page.locator("main form[action='/api/scan/bevestigen']")).toHaveCount(0);
  await expect(page.getByText(/Deze link klopt niet/)).toBeVisible();
});

test("an empty check goes back to the form", async ({ page }) => {
  await page.goto("/");
  await dismissNotice(page);
  // Bypass the browser's required check: the server must refuse too. The address is filled, so the empty name is what is refused.
  await page.evaluate(() => document.querySelectorAll("input[name='q']").forEach((i) => i.removeAttribute("required")));
  await page.locator("form[action='/api/scan'] input[name='email']").first().fill("e2e@example.nl");
  await page.locator("form[action='/api/scan'] button[type='submit']").first().click();
  await expect(page).toHaveURL(/fout=leeg/);
});

test("a check without an address comes back to the field, nothing started", async ({ page }) => {
  await page.goto("/");
  await dismissNotice(page);
  await page.evaluate(() => document.querySelectorAll("input[name='email']").forEach((i) => i.removeAttribute("required")));
  const form = page.locator("form[action='/api/scan']").first();
  await form.locator("input[name='q']").fill("Bakkerij Zonder Adres");
  await form.locator("input[name='place']").fill("Haarlem");
  await form.locator("button[type='submit']").click();
  await expect(page).toHaveURL(/\/scan\/kies\?.*fout=mail/);
  await expect(page.locator("input[name='email'][aria-invalid='true']")).toBeVisible();
});
