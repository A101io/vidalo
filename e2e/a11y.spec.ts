import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { dismissNotice } from "./helpers";

/**
 * axe-core (WCAG 2.2 A + AA) over the pages a customer sees. axe finds
 * roughly a third of the issues; the rest is the kit's manual checklist.
 * Reduced motion, so entrance animations do not blend colours mid-fade.
 */
const pages = ["/", "/prijzen", "/hoe-het-werkt", "/r/voorbeeld", "/r/voorbeeld-grijs", "/vak/horeca", "/voorwaarden", "/cookies", "/inloggen", "/en"];

for (const url of pages) {
  test(`@a11y ${url}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(url);
    await dismissNotice(page);
    await page.locator("main").waitFor();
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const summary = results.violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}×) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
    expect(summary, summary.join("\n")).toEqual([]);
  });
}

test("@a11y the cookie notice itself", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.getByRole("button", { name: /^(Begrepen|Alleen noodzakelijk)$/ }).first().waitFor();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id} (${v.nodes.length}×)`)).toEqual([]);
});

test("@a11y keyboard: the first Tab reaches something visible and focus is shown", async ({ page }) => {
  await page.goto("/");
  await dismissNotice(page);
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    return { tag: el.tagName, text: el.textContent?.trim().slice(0, 40), outline: s.outlineStyle !== "none" || s.boxShadow !== "none" };
  });
  expect(focused, "Tab moved focus off the body").not.toBeNull();
  expect(focused!.outline, `focus ring on ${focused!.tag} "${focused!.text}"`).toBe(true);
});
