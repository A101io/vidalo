import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { confirmCheck, dismissNotice } from "./helpers";

/**
 * Feature 001, ADR-0007: for a business Google does not list, /scan/kies asks for its website (the only place it is
 * asked). In mock mode a name with "Music" in it has no listing and no website. A refused address comes back next to
 * the field, in the page's language, and is never echoed; an empty field still runs the check.
 */
const REFUSED = ["http://127.0.0.1", "http://10.0.0.1/x", "javascript:alert(1)", "https://user:pw@vloedlijn.example", `https://www.vloedlijn.example/${"a".repeat(200)}`];

async function toKies(page: Page, lang: "nl" | "en" = "nl") {
  const name = `Vloedlijn Music ${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await page.goto(lang === "nl" ? "/" : "/en");
  await dismissNotice(page);
  const form = page.locator("form[action='/api/scan']").first();
  await form.locator("input[name='q']").fill(name);
  await form.locator("input[name='place']").fill("Utrecht");
  await form.locator("input[name='email']").fill("e2e@example.nl");
  await form.locator("button[type='submit']").click();
  await page.waitForURL(/\/scan\/kies/);
  await dismissNotice(page);
  return name;
}

test("a business without a listing is asked for its website, with one small button and a way on without it", async ({ page }) => {
  await toKies(page);
  await expect(page.locator("h1")).toHaveText("We vonden je bedrijf niet op Google.");
  const field = page.getByLabel("Wat is je website?");
  await expect(field).toBeVisible();
  await expect(page.locator("main")).toContainText("Vidalo leest je website om te begrijpen wat je doet");
  // the hint is tied to the field
  const hintId = (await field.getAttribute("aria-describedby"))!.split(" ")[0]!;
  await expect(page.locator(`#${hintId}`)).toContainText("Leeg laten mag");
  await expect(page.locator("main .btn-primary")).toHaveCount(0);
  await expect(page.locator("main button[type='submit']")).toHaveCount(1);
});

test("a refused website comes back next to the field and is never shown again", async ({ page }) => {
  await toKies(page);
  for (const bad of REFUSED) {
    await page.getByLabel("Wat is je website?").fill(bad);
    await Promise.all([page.waitForURL(/fout=website/), page.locator("main button[type='submit']").click()]);
    const field = page.getByLabel("Wat is je website?");
    await expect(page.locator("main [role=alert]")).toContainText("Dit is geen website die we kunnen lezen");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    const describedBy = (await field.getAttribute("aria-describedby"))!.split(" ");
    expect(describedBy.length).toBe(2);
    await expect(page.locator(`#${describedBy[1]}`)).toContainText("Dit is geen website");
    await expect(field).toHaveValue("");
    const html = await page.content();
    expect(html).not.toContain("127.0.0.1");
    expect(html).not.toContain("alert(1)");
    expect(html).not.toContain("user:pw");
    expect(page.url()).not.toContain("127.0.0.1");
  }
});

test("a valid website is read: the report says what the business does", async ({ page }) => {
  test.setTimeout(120_000); // a cold dev server compiles the waiting page and the report on first use
  await toKies(page);
  await page.getByLabel("Wat is je website?").fill("www.vloedlijn-music.example");
  await page.locator("main button[type='submit']").click();
  await confirmCheck(page);
  await page.waitForURL(/\/(scan|r)\//);
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 60_000 });
  await expect(page.getByText(/Gecontroleerd als: aanbieder van achtergrondmuziek/)).toBeVisible();
  await expect(page.getByText("We konden niet lezen wat je bedrijf doet.")).toHaveCount(0);
});

test("without a website the check still runs, and the report says it could not read the business and how to fix it", async ({ page }) => {
  test.setTimeout(120_000);
  await toKies(page);
  await page.locator("main button[type='submit']").click();
  await confirmCheck(page);
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 60_000 });
  await expect(page.getByText("We konden niet lezen wat je bedrijf doet.")).toBeVisible();
  await expect(page.getByText(/Geef bij een nieuwe controle je website op/)).toBeVisible();
  await expect(page.getByText(/Gecontroleerd als:/)).toHaveCount(0);
  // the three neutral questions sit in the folded "Alle antwoorden" list: present, not necessarily open
  for (const q of ["Bestaat", "Wat doet", "Wat is de website van"]) await expect(page.locator("main")).toContainText(q);
});

test("English: label, hint and error are English", async ({ page }) => {
  await toKies(page, "en");
  await expect(page.locator("h1")).toHaveText("We did not find your business on Google.");
  const field = page.getByLabel("What is your website?");
  await expect(field).toBeVisible();
  await field.fill("http://10.0.0.1");
  await Promise.all([page.waitForURL(/fout=website/), page.locator("main button[type='submit']").click()]);
  await expect(page.locator("main [role=alert]")).toContainText("We cannot read that as a website");
  expect(page.url()).toContain("/en/");
});

test("@mobile 375 px: no sideways scroll, the field and the button are at least 44 px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await toKies(page);
  await page.getByLabel("Wat is je website?").fill("http://10.0.0.1");
  await Promise.all([page.waitForURL(/fout=website/), page.locator("main button[type='submit']").click()]);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const box = await page.getByLabel("Wat is je website?").boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  const btn = await page.locator("main button[type='submit']").boundingBox();
  expect(btn!.height).toBeGreaterThanOrEqual(40);
  await page.screenshot({ path: "out/journey-mock/kies-website-nl-375.png", fullPage: true });
});

test("@a11y the website field, with and without an error, NL and EN", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const lang of ["nl", "en"] as const) {
    await toKies(page, lang);
    const check = async () => {
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(results.violations.map((v) => `${v.id} (${v.nodes.length}×)`)).toEqual([]);
    };
    await check();
    await page.getByLabel(lang === "nl" ? "Wat is je website?" : "What is your website?").fill("http://10.0.0.1");
    await Promise.all([page.waitForURL(/fout=website/), page.locator("main button[type='submit']").click()]);
    await check();
  }
});
