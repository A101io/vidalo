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

test("@gate the language switch on the coming-soon page changes the whole page", async ({ page }) => {
  // next/link left the Dutch page standing under /en/coming-soon (vidalo.io, 23 Oct 2026).
  await page.goto("/");
  await page.locator(".lang-switch a[hreflang='en']").first().click();
  await expect(page).toHaveURL(/\/en\/coming-soon$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("h1")).toHaveText("Vidalo is on its way.");
  await page.locator(".lang-switch a[hreflang='nl']").first().click();
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
  await expect(page.locator("h1")).toHaveText("Vidalo komt eraan.");
});

test("@gate the coming-soon list answers in the page's language", async ({ page }) => {
  // The browser's own "tick this box" bubble spoke the browser's language; the server answers instead.
  for (const [url, message] of [
    ["/en/coming-soon", "Tick the box, and we will put you on the list."],
    ["/binnenkort", "Vink het vakje aan, dan zetten we je op de lijst."],
  ] as const) {
    await page.goto(url);
    await page.locator("#lijst-email").fill("e2e@example.com");
    await page.locator("form[action='/api/waitlist'] button[type='submit']").click();
    await expect(page.locator("#lijst-error"), url).toHaveText(message);
    await expect(page.locator("input[name='consent']"), url).toHaveAttribute("aria-invalid", "true");
  }
});

test("@gate legal pages behind the gate link only inside the coming-soon setup", async ({ page }) => {
  // Behind the gate they keep the coming-soon footer, never the site's (A101io/vidalo#34).
  const allowed = new Set(["/", "/en", "/voorwaarden", "/privacy", "/cookies", "/en/terms", "/en/privacy", "/en/cookies"]);
  for (const url of ["/voorwaarden", "/privacy", "/cookies", "/en/terms", "/en/privacy", "/en/cookies"]) {
    await page.goto(url);
    const hrefs = await page.locator("a[href^='/']").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
    for (const href of hrefs) expect(allowed.has(href), `${url} links to ${href}`).toBe(true);
  }
});
