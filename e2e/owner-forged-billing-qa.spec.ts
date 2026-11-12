import { expect, test, type Page } from "@playwright/test";
import { CONTROL_OWNER, EN_OWNER, NAMES, signInAs, switchTo } from "./helpers-owner-area";

/**
 * Feature 002 QA (phase 4), AC-2: "the pause and the cancel act on that business only … a business whose owner is
 * someone else is never … acted on, including by a hand-edited form value". B-05 and A-05 test this for facts, checks,
 * fixes, domain, checkout, language and delete; this file adds cancel and pause. Mock mode, production build.
 *
 * Attacker: the English owner (two businesses). Target: the control login's "Kapsalon Ander" (ander@example.nl, a
 * Vidalo Monthly in trial that no other spec cancels; apps/web/lib/demo-owner-area.ts). Positive control: the same form
 * with the attacker's own business id does cancel it (then undone), so a refusal is the guard, not a broken form.
 *
 * Control used in phase 4: `requireOwnerOf(businessFromForm(form))` in app/app/abonnement/actions.ts replaced by the
 * plain `requireOwner()` — the forged cancel is then accepted (rebuild needed; see verification/qa.md for the result).
 */
test.describe.configure({ mode: "serial" });


async function abonnementText(page: Page): Promise<string> {
  await page.goto("/app/abonnement");
  return (await page.locator("main").innerText()).replace(/\s+/g, " ");
}

async function targetIdAndState(page: Page): Promise<{ id: string; text: string }> {
  await page.context().clearCookies();
  await signInAs(page, CONTROL_OWNER, "/app/abonnement");
  const text = await abonnementText(page);
  await page.goto("/app/abonnement/opzeggen");
  const id = (await page.locator("form input[name='business']").first().getAttribute("value"))!;
  await page.context().clearCookies();
  return { id, text };
}

async function forge(page: Page, path: string, id: string) {
  await page.goto(path);
  await page.locator("main form input[name='business']").first().evaluate((el, v) => ((el as HTMLInputElement).value = v), id);
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith(path.split("/").pop()!)), page.locator("main form button[type='submit']").first().click()]);
}

test("AC-2: a hand-edited business id cannot cancel or pause another login's subscription; the own one still can", async ({ page }) => {
  const target = await targetIdAndState(page);
  expect(target.text).not.toContain("Opgezegd");

  await signInAs(page, EN_OWNER, "/en/app");
  await switchTo(page, NAMES.enRotterdam);
  const ownBefore = await abonnementText(page);

  // Forged cancel and pause: sent to the dashboard, nothing changes on either side.
  await forge(page, "/en/app/abonnement/opzeggen", target.id);
  expect(new URL(page.url()).pathname).toMatch(/\/app$/);
  expect(page.url()).not.toContain("gewijzigd");
  await forge(page, "/en/app/abonnement/pauzeren", target.id);
  expect(new URL(page.url()).pathname).toMatch(/\/app$/);
  expect(await abonnementText(page)).toBe(ownBefore);

  // Positive control: the same form with the own id cancels; undo puts it back.
  await page.goto("/en/app/abonnement/opzeggen");
  await Promise.all([page.waitForURL(/gewijzigd=opgezegd/), page.locator("main form button[type='submit']").first().click()]);
  await Promise.all([page.waitForURL(/gewijzigd=doorgaan/), page.locator("main form").filter({ has: page.locator("input[name='business']") }).locator("button[type='submit']").first().click()]);

  // The target is untouched.
  const after = await targetIdAndState(page);
  expect(after.text).toBe(target.text);
});
