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

test("@gate no public preview button; only the preview key opens the whole site", async ({ page, request }) => {
  // The public "Bekijk de site alvast" button was removed on 18 Oct 2026.
  await page.goto("/");
  await expect(page.getByText(/Bekijk de site alvast|Have a look at the site/)).toHaveCount(0);
  await expect(page.locator("form[action='/api/waitlist']")).toHaveCount(1);
  // The assistant stays off behind the gate, and its endpoint refuses.
  await expect(page.getByRole("button", { name: /Vraag het ons|Ask us/ })).toHaveCount(0);
  const chat = await request.post("/api/chat", { data: { messages: [{ role: "user", content: "hoi" }], lang: "nl" } });
  expect(chat.status()).toBe(404);

  // A wrong key changes nothing.
  await page.request.post("/api/preview", { form: { key: "wrong-key", lang: "nl" }, maxRedirects: 0 });
  await page.goto("/");
  expect(await page.locator("form[action='/api/scan']").count()).toBe(0);

  // The right key (playwright.config.ts: VIDALO_PREVIEW_KEY) sets the preview cookie for this browser.
  await page.request.post("/api/preview", { form: { key: "e2e-preview-key", lang: "nl" }, maxRedirects: 0 });
  await page.goto("/");
  await expect(page.locator("form[action='/api/scan']").first()).toBeVisible();
});
