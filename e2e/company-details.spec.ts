import { expect, test } from "@playwright/test";
import { COMPANY, CONTACT } from "../packages/core/src/shared/contact";

/**
 * Feature 003 (FE-01, AC-1, AC-2, AC-3): the company line, with the btw number, in the
 * footer of every page and on the coming-soon page; /contact says how to complain.
 */
const FIELDS = [COMPANY.legalName, COMPANY.street, `KvK ${COMPANY.kvk}`, COMPANY.vat, CONTACT.phone];

for (const url of ["/", "/en", "/prijzen", "/en/pricing", "/contact", "/en/contact"]) {
  test(`footer carries the company details on ${url}`, async ({ page }) => {
    await page.goto(url);
    const footer = await page.locator("footer").last().innerText();
    for (const f of FIELDS) expect(footer, `${url} footer lacks ${f}`).toContain(f);
  });
}

for (const [url, days] of [["/contact", "5 werkdagen"], ["/en/contact", "5 working days"]] as const) {
  test(`${url} says how to complain`, async ({ page }) => {
    await page.goto(url);
    await expect(page.getByRole("heading", { name: url === "/contact" ? "Een klacht" : "A complaint" })).toBeVisible();
    await expect(page.locator("main")).toContainText(days);
  });
}

for (const url of ["/binnenkort", "/en/coming-soon"]) {
  test(`@gate ${url} shows contact details and the company line`, async ({ page }) => {
    await page.goto(url);
    const main = await page.locator("main").innerText();
    expect(main).toContain(CONTACT.email);
    expect(main).toContain(CONTACT.phone);
    const footer = await page.locator("footer").last().innerText();
    for (const f of FIELDS) expect(footer, `${url} footer lacks ${f}`).toContain(f);
  });
}

test("the company line does not widen the page at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("@gate the coming-soon page does not widen at 375 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/binnenkort");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
