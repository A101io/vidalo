import { expect, test, type Page } from "@playwright/test";
import { dismissNotice } from "./helpers";

/**
 * /inloggen for a visitor who is already signed in (mock auth): no e-mail form
 * and no red "geen bedrijf" error, but a clear state with a way out. Before
 * 22 Oct 2026 a signed-in owner without a business was stuck on the form.
 */
async function signInWithoutBusiness(page: Page, email: string) {
  // Mock auth: next=/eigenaar/bevestigen signs in without requiring a business.
  await page.goto(`/inloggen?next=${encodeURIComponent("/eigenaar/bevestigen")}`);
  await dismissNotice(page);
  await page.locator("input[name='email']").fill(email);
  // The submit is a server action: wait for its redirect, or a goto() cancels it before the cookie is set.
  await page.locator("button[type='submit']").click();
  await page.waitForURL(/\/eigenaar\/bevestigen/);
}

async function freshBusinessId(page: Page, name: string): Promise<string> {
  // Through the API, not the landing form: on a cold dev server a hot reload can
  // empty the form between fill and submit, and the free check is not what
  // these tests are about (free-check.spec.ts covers it).
  const res = await page.request.post("/api/scan", { form: { q: name, place: "Haarlem" }, maxRedirects: 0 });
  const waiting = res.headers()["location"]!;
  expect(waiting).toMatch(/\/scan\/[^/?#]+$/);
  await page.goto(waiting);
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 60_000 });
  return (await page.locator("form[action='/api/checkout'] input[name='business']").first().getAttribute("value"))!;
}

test("signed in without a business: no form, a free check and sign-out", async ({ page }) => {
  await signInWithoutBusiness(page, `niemand-${Date.now()}@example.com`);
  await page.goto("/inloggen?fout=geen&next=%2Fapp");
  await expect(page.getByText(/Je bent ingelogd als niemand-/)).toBeVisible();
  await expect(page.locator("input[name='email']")).toHaveCount(0);
  await expect(page.getByText("We vonden geen bedrijf bij dit e-mailadres")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Start een gratis controle" })).toBeVisible();
  // /app sends the same visitor here, not into a loop.
  const res = await page.goto("/app");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/inloggen\?fout=geen/);
  // Sign out: the form is back.
  await page.getByRole("button", { name: "Uitloggen" }).click();
  await page.goto("/inloggen");
  await expect(page.locator("input[name='email']")).toBeVisible();
});

test("signed in, coming from /welkom: one button links the business, then the dashboard opens", async ({ page }) => {
  const email = `koppel-${Date.now()}@example.com`;
  const businessId = await freshBusinessId(page, "Kapsalon Koppel");
  await signInWithoutBusiness(page, email);
  await page.goto(`/inloggen?next=%2Fapp&business=${businessId}`);
  await expect(page.getByText("Koppel Kapsalon Koppel (Haarlem) aan dit account?")).toBeVisible();
  await expect(page.locator("input[name='email']")).toHaveCount(0);
  await page.getByRole("button", { name: "Ja, koppel dit bedrijf" }).click();
  await page.waitForURL(/\/app(\?|$)/);
  await expect(page.locator("main")).toBeVisible();
  // Signed in with a business: /inloggen goes straight to the dashboard.
  await page.goto("/inloggen");
  await expect(page).toHaveURL(/\/app(\?|$)/);
});

test("a business claimed by another address cannot be linked", async ({ page, browser }) => {
  const businessId = await freshBusinessId(page, "Garage Bezet");
  await signInWithoutBusiness(page, `eerste-${Date.now()}@example.com`);
  await page.goto(`/inloggen?next=%2Fapp&business=${businessId}`);
  await page.getByRole("button", { name: "Ja, koppel dit bedrijf" }).click();
  await page.waitForURL(/\/app(\?|$)/);
  const other = await browser.newContext();
  const p2 = await other.newPage();
  await signInWithoutBusiness(p2, `tweede-${Date.now()}@example.com`);
  await p2.goto(`/inloggen?next=%2Fapp&business=${businessId}`);
  await expect(p2.getByRole("button", { name: "Ja, koppel dit bedrijf" })).toHaveCount(0);
  await expect(p2.getByText(/Je bent ingelogd als tweede-/)).toBeVisible();
  await other.close();
});
