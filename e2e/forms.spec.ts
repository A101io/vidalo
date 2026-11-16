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

/**
 * Feature 003 (FE-02, AC-7, AC-11): under every email field a sentence says two more
 * messages follow and how to stop them, with the privacy link; the Monthly card shows the total.
 */
for (const [lang, home, privacy, pricing, sentence, total] of [
  ["nl", "/", "/privacy", "/prijzen", "na 7 en 21 dagen nog een kort bericht", "€149 eenmalig + €49 per maand, excl. btw"],
  ["en", "/en", "/en/privacy", "/en/pricing", "after 7 and 21 days about the outcome", "€149 once + €49 per month, excl. VAT"],
] as const) {
  test(`the scan form says what follows the report (${lang})`, async ({ page }) => {
    await page.goto(home);
    const form = page.locator("form[action='/api/scan']").first();
    const note = form.locator("p[id$='-email-note']");
    await expect(note).toContainText(sentence);
    await expect(note.locator("a")).toHaveAttribute("href", privacy);
    const describedBy = await form.locator("input[name='email']").getAttribute("aria-describedby");
    expect(describedBy).toContain(await note.getAttribute("id"));
  });

  test(`the report page says what follows the report email (${lang})`, async ({ page }) => {
    await page.goto(lang === "nl" ? "/r/voorbeeld" : "/en/r/voorbeeld");
    const form = page.locator("form[action='/api/report-email']");
    const note = form.locator("#report-email-note");
    await expect(note).toContainText(sentence);
    await expect(note.locator("a")).toHaveAttribute("href", privacy);
    await expect(form.locator("#report-email")).toHaveAttribute("aria-describedby", "report-email-note");
  });

  test(`the Monthly card shows the whole price (${lang})`, async ({ page }) => {
    await page.goto(pricing);
    await expect(page.getByText(total, { exact: true }).first()).toBeVisible();
  });
}
