import { expect, test } from "@playwright/test";
import { activeName, CONTROL_OWNER, controlBusinessId, DEMO_OWNER, EN_OWNER, NAMES, signInAs, switcher, switchTo, visit } from "./helpers-owner-area";

/**
 * Feature 002 B-01 (AC-2): a login with more than one business sees each by name and place, switches
 * between them, and every owner page acts on the chosen one; a business of another login is never
 * listed or reachable by a changed value. Mock mode: the demo owner holds Haarlem and Amsterdam,
 * ander@example.nl holds Utrecht (the control). The switch is per browser (a cookie), so these run in parallel.
 */
const NAV = ["/app", "/app/voortgang", "/app/gegevens", "/app/domein", "/app/google", "/app/abonnement", "/app/account"];
// The demo owner's businesses are Dutch; an English owner's pages live under /en (they follow business.language).
const LANGS = [
  { name: "NL", prefix: "", owner: DEMO_OWNER, first: NAMES.haarlem, second: NAMES.amsterdam, now: (n: string) => `Je werkt nu in ${n}.` },
  { name: "EN", prefix: "/en", owner: EN_OWNER, first: NAMES.enRotterdam, second: NAMES.enLeiden, now: (n: string) => `You are now working in ${n}.` },
];

test("one business: no switcher, today's text", async ({ page }) => {
  await signInAs(page, CONTROL_OWNER);
  await expect(switcher(page)).toHaveCount(0);
  expect(await activeName(page)).toBe(NAMES.control);
});

for (const L of LANGS) {
  test(`${L.name}: the owner switches to the other business, every page shows it, it survives a reload`, async ({ page }) => {
    test.slow(); // seven pages, cold on a dev server
    await signInAs(page, L.owner, `${L.prefix}/app`);
    await expect(switcher(page)).toHaveCount(1);
    expect(await switcher(page).locator("option").allInnerTexts()).toEqual(expect.arrayContaining([L.first, L.second]));
    expect(await activeName(page)).toBe(L.first); // the newest business is the default
    await switchTo(page, L.second);
    await expect(page.getByRole("status").filter({ hasText: L.now(L.second) })).toBeVisible();
    for (const path of NAV) {
      await visit(page, `${L.prefix}${path}`);
      expect(await activeName(page), path).toBe(L.second);
    }
    await page.reload();
    expect(await activeName(page)).toBe(L.second);
  });
}

test("a forged choice never selects another login's business (SEC-02, SEC-03)", async ({ page, browser, baseURL, context }) => {
  test.slow(); // three page loads per forged value on a dev server
  const control = await controlBusinessId(browser, baseURL);
  await signInAs(page, DEMO_OWNER);
  expect(await activeName(page)).toBe(NAMES.haarlem);
  const cookie = () => context.cookies().then((c) => c.find((x) => x.name === "vidalo_business"));

  // chooseBusiness with the control's id (the select's option edited by hand), posted from /app/voortgang:
  // it answers with /app and no cookie. (From /app itself the URL would not change, so a wait could not tell.)
  await visit(page, "/app/voortgang");
  await switcher(page).evaluate((el, id) => {
    const s = el as HTMLSelectElement;
    s.add(new Option("forged", id));
    s.value = id;
  }, control);
  await page.getByRole("button", { name: /^(Wissel|Switch)$/ }).click();
  await page.waitForURL((u) => u.pathname === "/app");
  await expect(page).not.toHaveURL(/gewisseld/);
  expect(await cookie()).toBeUndefined();
  expect(await activeName(page)).toBe(NAMES.haarlem);

  // A cookie set by hand to the control's id, to nothing sensible, and to its own second business.
  for (const value of [control, encodeURIComponent("not-a-uuid'; drop table business"), "00000000-0000-0000-0000-000000000000"]) {
    await context.addCookies([{ name: "vidalo_business", value, url: baseURL! }]);
    for (const path of ["/app", "/app/gegevens", "/app/account"]) {
      await visit(page, path);
      expect(await activeName(page), `${path} with cookie ${value}`).toBe(NAMES.haarlem);
      await expect(page.locator("body")).not.toContainText("Kapsalon Ander");
    }
  }
  // Control: the own second business's id in the cookie IS honoured.
  await switchTo(page, NAMES.amsterdam);
  expect((await cookie())?.value).toMatch(/^[0-9a-f-]{36}$/);
  await visit(page, "/app/gegevens");
  expect(await activeName(page)).toBe(NAMES.amsterdam);
});

test("the cookie has the options the cookie table promises", async ({ page, context }) => {
  await signInAs(page, DEMO_OWNER);
  await switchTo(page, NAMES.amsterdam);
  const c = (await context.cookies()).find((x) => x.name === "vidalo_business")!;
  expect(c).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });
  const days = (c.expires - Date.now() / 1000) / 86400;
  expect(days).toBeGreaterThan(89);
  expect(days).toBeLessThan(91);
});

test("a next that leaves the site is refused: the redirect stays on /app (SEC-30)", async ({ page }) => {
  await signInAs(page, DEMO_OWNER);
  await page.locator("input[name='next']").evaluate((el) => ((el as HTMLInputElement).value = "//evil.example/x"));
  await Promise.all([page.waitForURL(/gewisseld=1/), page.getByRole("button", { name: /^(Wissel|Switch)$/ }).click()]);
  expect(new URL(page.url()).host).toBe(new URL(page.url()).host);
  expect(new URL(page.url()).pathname).toBe("/app");
});

test("@mobile 375px: the switcher wraps, no horizontal scroll, controls are at least 44px", async ({ page }) => {
  await signInAs(page, DEMO_OWNER);
  await page.setViewportSize({ width: 375, height: 812 });
  await visit(page, "/app");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  for (const box of await page.locator("select[name='business'], form:has(select[name='business']) button").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
});
