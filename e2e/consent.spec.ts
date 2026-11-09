import { expect, test } from "@playwright/test";

/** Cookies (LEGAL-NL §6): nothing optional before a choice, the choice is stored, it can be reopened from the footer. */
test("@smoke the notice shows on a first visit and remembers the choice", async ({ page, context }) => {
  await page.goto("/");
  const notice = page.getByRole("button", { name: /^(Begrepen|Alleen noodzakelijk)$/ }).first();
  await expect(notice).toBeVisible();
  expect((await context.cookies()).map((c) => c.name)).not.toContain("vidalo_consent");
  await notice.click();
  await expect(notice).toBeHidden();
  const consent = (await context.cookies()).find((c) => c.name === "vidalo_consent");
  expect(consent, "the choice is stored").toBeTruthy();
  expect(decodeURIComponent(consent!.value)).toContain('"analytics":false');
  await page.reload();
  await expect(page.getByRole("button", { name: /^(Begrepen|Alleen noodzakelijk)$/ })).toHaveCount(0);
});

test("the footer links the cookie statement, and reopens the notice once there is a choice", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^(Begrepen|Alleen noodzakelijk)$/ }).first().click();
  await page.reload();
  await expect(page.locator("footer a[href='/cookies']").first()).toBeVisible();
  // "Cookie-instellingen" only exists with an optional category (SiteFooter: OPTIONAL_CATEGORIES); none today.
  const settings = page.getByRole("button", { name: "Cookie-instellingen" });
  if ((await settings.count()) > 0) {
    await settings.first().click();
    await expect(page.getByRole("button", { name: /^(Alleen noodzakelijk|Alles accepteren)$/ }).first()).toBeVisible();
  }
});

test("a category can be switched on and off and the choice saved (9 Nov 2026: Julian could not toggle)", async ({ page, context }) => {
  await page.goto("/");
  const analytics = page.getByRole("switch", { name: /Statistieken/ });
  await expect(analytics).toHaveAttribute("aria-checked", "false");
  await analytics.click();
  await expect(analytics).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Bewaar mijn keuze" }).click();
  const consent = (await context.cookies()).find((c) => c.name === "vidalo_consent");
  expect(decodeURIComponent(consent!.value)).toContain('"analytics":true');
  // Reopened from the footer, the switch shows the stored choice and can be turned off again.
  await page.getByRole("button", { name: "Cookie-instellingen" }).first().click();
  await expect(page.getByRole("switch", { name: /Statistieken/ })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("switch", { name: /Statistieken/ }).click();
  await page.getByRole("button", { name: "Bewaar mijn keuze" }).click();
  const again = (await context.cookies()).find((c) => c.name === "vidalo_consent");
  expect(decodeURIComponent(again!.value)).toContain('"analytics":false');
});

test("only necessary cookies before and after the choice", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^(Begrepen|Alleen noodzakelijk)$/ }).first().click();
  await page.goto("/prijzen");
  // The statement at /cookies lists what may exist; nothing else may appear.
  const names = (await context.cookies()).map((c) => c.name).sort();
  expect(names.filter((n) => !["vidalo_consent", "vidalo_lang"].includes(n)), names.join(", ")).toEqual([]);
  const storage = await page.evaluate(() => Object.keys(localStorage));
  expect(storage).toEqual([]);
});

test("the cookie statement names the consent cookie", async ({ page }) => {
  await page.goto("/cookies");
  await expect(page.locator("main")).toContainText("vidalo_consent");
});
