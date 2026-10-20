import { expect, test } from "@playwright/test";
import { PUBLIC_ROUTES, collectErrors, en, expectNoErrors } from "./helpers";

/** Every public page answers, in both languages, with its own language, a main landmark and no errors. */
for (const route of PUBLIC_ROUTES) {
  for (const [lang, url] of [["nl", route], ["en", en(route)]] as const) {
    test(`@smoke ${url} renders in ${lang}`, async ({ page }) => {
      const errors = collectErrors(page);
      const res = await page.goto(url);
      expect(res?.status(), url).toBe(200);
      await expect(page.locator("html")).toHaveAttribute("lang", lang);
      await expect(page.locator("main")).toBeVisible();
      expect((await page.title()).trim().length, "a title").toBeGreaterThan(10);
      expect(await page.locator("h1").count(), "exactly one h1").toBe(1);
      await expectNoErrors(errors);
    });
  }
}

test("@smoke unknown pages answer 404 with a way back", async ({ page }) => {
  const res = await page.goto("/bestaat-niet");
  expect(res?.status()).toBe(404);
  await expect(page.locator("a[href='/']").first()).toBeVisible();
});

test("@smoke machine-readable files", async ({ request }) => {
  for (const [path, type] of [["/llms.txt", "text/"], ["/sitemap.xml", "xml"], ["/robots.txt", "text/plain"], ["/.well-known/security.txt", "text/plain"]]) {
    const res = await request.get(path);
    expect(res.status(), path).toBe(200);
    expect(res.headers()["content-type"], path).toContain(type);
  }
  const health = await (await request.get("/api/health")).json();
  expect(health).toMatchObject({ ok: true });
});

test("@smoke the language switch keeps the page", async ({ page }) => {
  await page.goto("/prijzen");
  await page.getByRole("link", { name: /^EN$/ }).first().click();
  await expect(page).toHaveURL(/\/en\/pricing$/);
  await page.getByRole("link", { name: /^NL$/ }).first().click();
  await expect(page).toHaveURL(/\/prijzen$/);
});

test("@smoke @mobile no horizontal scroll on a phone", async ({ page }) => {
  for (const url of ["/", "/prijzen", "/r/voorbeeld", "/en"]) {
    await page.goto(url);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${url} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(0);
  }
});
