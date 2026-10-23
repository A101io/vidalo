import { expect, test, type Locator } from "@playwright/test";
import { dismissNotice } from "./helpers";

/**
 * Form messages speak the page's language, not the browser's (Control Room
 * I2; components/FormMessages.tsx). The suite's browser runs in Dutch
 * (playwright.config.ts locale nl-NL), so a bubble left to the browser shows
 * up as Dutch on the English pages.
 */
const message = (field: Locator) => field.evaluate((el) => (el as HTMLInputElement).validationMessage);

for (const [lang, home, login, required, email] of [
  ["en", "/en", "/en/login", "Please fill in this field.", "Please enter a valid email address, like name@company.com."],
  ["nl", "/", "/inloggen", "Vul dit veld in.", "Vul een geldig e-mailadres in, zoals naam@bedrijf.nl."],
] as const) {
  test(`an empty free check is answered in the page's language (${lang})`, async ({ page }) => {
    await page.goto(home);
    await dismissNotice(page);
    const form = page.locator("form[action='/api/scan']").first();
    await form.locator("button[type='submit']").click();
    await expect.poll(() => message(form.locator("input[name='q']"))).toBe(required);
    expect(page.url()).not.toContain("/scan/");
  });

  test(`a wrong sign-in address is answered in the page's language (${lang})`, async ({ page }) => {
    await page.goto(login);
    await dismissNotice(page);
    const field = page.locator("input[name='email']");
    await field.fill("not-an-address");
    await field.evaluate((el) => (el as HTMLInputElement).form?.requestSubmit());
    await expect.poll(() => message(field)).toBe(email);
    // Typing again clears our message, so a corrected address goes through.
    await field.fill("eigenaar@bakkerijdevries.nl");
    expect(await message(field)).toBe("");
  });
}
