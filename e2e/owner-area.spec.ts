import { expect, test, type Page } from "@playwright/test";
import { activeBusinessId, activeName, CONTROL_OWNER, controlBusinessId, controlIds, DEMO_OWNER, EN_OWNER, NAMES, signInAs, switcher, switchTo, visibleState, visit } from "./helpers-owner-area";

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

/**
 * Feature 002 B-02 (AC-1): "Rapporten" lists every finished check of the active business, newest first, with date,
 * kind in words, the dot's meaning in words and "n van m antwoorden klopten"; the owner's own free report older
 * than 30 days still opens for them and is "niet gevonden" for anyone else.
 */
const ARCHIVE = [
  { name: "NL", prefix: "", owner: DEMO_OWNER, free: "Gratis controle", monthly: "Maandcontrole", extra: "Extra controle", failed: "Niet gelukt", counts: /\d+ van \d+ antwoorden? klopte/, nav: "Rapporten" },
  { name: "EN", prefix: "/en", owner: EN_OWNER, free: "Free check", monthly: "Monthly check", extra: "Extra check", failed: "Did not succeed", counts: /\d+ of \d+ answers? (was|were) correct/, nav: "Reports" },
];

for (const L of ARCHIVE) {
  test(`${L.name}: Rapporten lists the checks with kind words and counts; the failed one has no link; dots carry no meaning alone`, async ({ page }) => {
    test.slow();
    await signInAs(page, L.owner, `${L.prefix}/app`);
    await expect(page.getByRole("navigation").getByRole("link", { name: L.nav })).toBeVisible();
    await visit(page, `${L.prefix}/app/rapporten`);
    await expect(page.getByRole("heading", { level: 1, name: L.nav })).toBeVisible();
    const rows = page.locator("main ol > li");
    await expect(rows.first()).toBeVisible();
    const text = await rows.allInnerTexts();
    expect(text.some((t) => t.includes(L.free)), "a free check").toBe(true);
    // Finished checks link to their report and say how many answers were right; the dot is decoration (aria-hidden) with its meaning in words.
    const linked = rows.filter({ has: page.locator("a[href*='/r/']") });
    expect(await linked.count()).toBeGreaterThan(0);
    for (const t of await linked.allInnerTexts()) expect(t).toMatch(L.counts);
    expect(await page.locator("main ol [class*='bg-rood'], main ol [class*='bg-groen'], main ol [class*='bg-oranje'], main ol [class*='bg-grijs']").evaluateAll((els) => els.every((e) => e.getAttribute("aria-hidden") === "true"))).toBe(true);
    if (L.owner === DEMO_OWNER) {
      // The demo owner's main business has the whole range: free, baseline, monthly, extra, and one that failed (no link); the recheck is not listed.
      expect(text.some((t) => t.includes(L.monthly))).toBe(true);
      expect(text.some((t) => t.includes(L.extra))).toBe(true);
      expect(text.some((t) => /Hercontrole/.test(t))).toBe(false);
      const failed = rows.filter({ hasText: L.failed });
      await expect(failed).toHaveCount(1);
      // No report to open; the only link is "remove" (13 Nov 2026), which points at the removal page.
      await expect(failed.locator("a[href*='/r/']")).toHaveCount(0);
      // Newest first: the dates do not increase down the list.
      const dates = await rows.locator("span.font-bold").allInnerTexts();
      expect(dates.length).toBeGreaterThan(5);
    }
  });
}

test("the owner's old free report still opens for them, and is not found for anyone else (AC-1)", async ({ page, browser, baseURL }) => {
  test.slow();
  await signInAs(page, DEMO_OWNER, "/app/rapporten");
  // The seeded history starts with a free check seven months ago: far past the 30 days a link keeps working for anyone.
  const free = page.locator("main ol > li", { hasText: "Gratis controle" }).locator("a[href*='/r/']").last();
  const href = await free.getAttribute("href");
  expect(href).toMatch(/^\/r\/[0-9a-f-]{36}$/);
  const own = await page.goto(href!);
  expect(own?.status(), "the owner opens their old free report").toBe(200);
  await expect(page.locator("body")).not.toContainText("Deze pagina bestaat niet");

  // Signed out, and another login: the same page as an unknown link.
  const visitors = [await browser.newContext({ baseURL }), await browser.newContext({ baseURL })];
  await signInAs(await visitors[1]!.newPage(), CONTROL_OWNER);
  for (const ctx of visitors) {
    const p = ctx.pages()[0] ?? (await ctx.newPage());
    const res = await p.goto(href!);
    expect(res?.status(), "not found for a visitor").toBe(404);
    await ctx.close();
  }
});

/**
 * Feature 002 B-05 (F-020, SEC-04/05/13): every changing action names its business. The English owner holds Rotterdam (open
 * by default) and Leiden, both with proven ownership and findings; `ander@example.nl` is the control. A form is rendered
 * for one business, another tab switches to the other, and the first form is submitted: it must act on the business it
 * was rendered for. A hand-edited `business` must change nothing.
 */
test.describe("every changing action names its business", () => {
  // These write to the English owner's two businesses and compare what they show before and after: one after the other.
  test.describe.configure({ mode: "serial" });
  const P = "/en";

  /** Clicks and waits for the server action's POST and the navigation it answers with to settle. */
  async function press(page: Page, button: import("@playwright/test").Locator) {
    await Promise.all([page.waitForResponse((r) => r.request().method() === "POST"), button.click()]);
    await page.waitForLoadState("networkidle");
  }

  async function twoTabs(context: import("@playwright/test").BrowserContext, page: Page) {
    const other = await context.newPage();
    await visit(other, `${P}/app`);
    await switchTo(other, NAMES.enLeiden);
    expect(await activeName(other)).toBe(NAMES.enLeiden);
    return other;
  }

  test("two tabs: saving facts writes to the business the form was rendered for", async ({ page, context }) => {
    test.slow();
    await signInAs(page, EN_OWNER, `${P}/app/gegevens`);
    expect(await activeName(page)).toBe(NAMES.enRotterdam);
    const address = `Havenstraat ${Date.now() % 100000}`;
    await page.locator("input[name='address']").fill(address);
    const other = await twoTabs(context, page); // tab 2 now acts on Leiden
    await Promise.all([page.waitForURL(/opgeslagen=1/), page.locator("form:has(input[name='name']) button[type='submit']").last().click()]);
    // Rotterdam has the new version; Leiden (open in the other tab) is untouched.
    await visit(other, `${P}/app/gegevens`);
    expect(await activeName(other)).toBe(NAMES.enLeiden);
    await expect(other.locator("input[name='address']")).not.toHaveValue(address);
    await switchTo(other, NAMES.enRotterdam);
    await visit(other, `${P}/app/gegevens`);
    await expect(other.locator("input[name='address']")).toHaveValue(address);
  });

  test("two tabs: Check now and \"I have changed this\" act on the business their form was rendered for", async ({ page, context }) => {
    test.slow();
    await signInAs(page, EN_OWNER, `${P}/app`);
    expect(await activeName(page)).toBe(NAMES.enRotterdam);
    const findingHref = await page.locator("a[href*='/app/fouten/']").first().getAttribute("href");
    expect(findingHref, "Rotterdam has a finding to act on").toBeTruthy();
    const other = await twoTabs(context, page);

    // Check now, from the page rendered for Rotterdam while Leiden is open in tab 2: queued for Rotterdam ...
    await Promise.all([page.waitForURL(/controle=ingepland/), page.getByRole("button", { name: "Check now" }).click()]);
    // ... so Leiden has not been checked yet (a second request for the same business would be "too soon").
    await visit(other, `${P}/app`);
    await Promise.all([other.waitForURL(/controle=/), other.getByRole("button", { name: "Check now" }).click()]);
    expect(other.url()).toContain("controle=ingepland");

    // "I have changed this" on Rotterdam's finding page while Leiden is the open business.
    await visit(page, findingHref!);
    await switchTo(other, NAMES.enLeiden);
    await Promise.all([page.waitForURL(/hercontrole=/), page.getByRole("button", { name: "I have changed this" }).click()]);
    expect(page.url()).toContain("hercontrole=ingepland");
    expect(page.url()).toContain(findingHref!.split("/").pop()!);
  });

  test("a hand-edited business changes nothing: every action goes to /app", async ({ page, browser, baseURL }) => {
    test.slow();
    const control = await controlIds(browser, baseURL);
    const before = { control: await visibleState(browser, baseURL, CONTROL_OWNER), own: await visibleState(browser, baseURL, EN_OWNER, P) };
    await signInAs(page, EN_OWNER, `${P}/app`);
    const forge = (id: string) => page.locator("input[name='business']").evaluateAll((els, v) => els.forEach((e) => ((e as HTMLInputElement).value = v)), id);
    const atApp = () => expect(new URL(page.url()).pathname).toBe(`${P}/app`);

    // Check now (dashboard), saveFacts and saveProfile (gegevens), markFixed and dispute (a finding page).
    await forge(control.business);
    await press(page, page.getByRole("button", { name: "Check now" }));
    atApp();
    expect(page.url()).not.toContain("controle=");

    await visit(page, `${P}/app/gegevens`);
    await forge(control.business);
    await page.locator("input[name='address']").fill("Forged street 1");
    await press(page, page.locator("form:has(input[name='name']) button[type='submit']").last());
    atApp();
    await visit(page, `${P}/app/gegevens`);
    await forge(control.business);
    await press(page, page.locator("#profiel button[type='submit']"));
    atApp();

    await visit(page, `${P}/app`);
    const findingHref = (await page.locator("a[href*='/app/fouten/']").first().getAttribute("href"))!;
    await visit(page, findingHref);
    await forge(control.business);
    await press(page, page.getByRole("button", { name: "I have changed this" }));
    atApp();
    await visit(page, findingHref);
    await forge(control.business);
    await press(page, page.locator("form:has(input[name='finding']) button").last());
    atApp();

    // The control's finding and channel pages: another login's id goes to /app (SEC-13), and nothing of either business moved.
    if (control.finding) {
      await visit(page, `${P}/app/fouten/${control.finding}`);
      expect(new URL(page.url()).pathname).toBe(`${P}/app`);
    }
    if (control.channel) {
      await visit(page, `${P}/app/vermeldingen/${control.channel}`);
      expect(new URL(page.url()).pathname).toBe(`${P}/app`);
    }
    expect(await visibleState(browser, baseURL, CONTROL_OWNER), "the control business is as it was").toBe(before.control);
    expect(await visibleState(browser, baseURL, EN_OWNER, P), "the own business is as it was").toBe(before.own);
  });

  test("domain verify: the form's own business only; a host another business verified is refused", async ({ page, browser, baseURL }) => {
    test.slow();
    const control = await controlIds(browser, baseURL);
    await signInAs(page, EN_OWNER, `${P}/app`);
    const rotterdam = await activeBusinessId(page, P);
    await switchTo(page, NAMES.enLeiden);
    const leiden = await activeBusinessId(page, P);
    expect(leiden).not.toBe(rotterdam);
    const host = `haven-${Date.now() % 1000000}.example`;
    const post = async (form: Record<string, string>) => {
      const res = await page.request.post("/api/domain/verify", { form: { host, simulate: "1", ...form }, headers: { origin: baseURL! }, maxRedirects: 0 });
      return new URL(res.headers()["location"]!).pathname + new URL(res.headers()["location"]!).search;
    };
    expect(await post({}), "no business").toBe("/app");
    expect(await post({ business: control.business }), "another login's business").toBe("/app");
    expect(await post({ business: "not-a-uuid'; --" }), "a malformed id").toBe("/app");
    expect(await post({ business: rotterdam }), "Rotterdam verifies the host").toBe("/app/domein?dns=ok");
    expect(await post({ business: leiden }), "Leiden cannot take it").toBe("/app/domein?dns=nee");
    expect(await post({ business: control.business, host: host }), "the control cannot either").toBe("/app");
  });

  test("checkout: a member buying for their second business is not refused; another login's business is", async ({ page, browser, baseURL }) => {
    test.slow();
    const control = await controlIds(browser, baseURL);
    await signInAs(page, EN_OWNER, `${P}/app`);
    const rotterdam = await activeBusinessId(page, P); // the open business
    await switchTo(page, NAMES.enLeiden);
    const leiden = await activeBusinessId(page, P);
    await switchTo(page, NAMES.enRotterdam); // Leiden is NOT the open business now
    expect(rotterdam).not.toBe(leiden);
    const buy = async (business: string) => (await page.request.post("/api/checkout", { form: { business, scan: "", plan: "monitor" }, maxRedirects: 0 })).headers()["location"] ?? "";
    expect(await buy(leiden), "the second business of a member").toContain("/welkom?mock=1");
    expect(await buy(control.business), "another login's business").toContain("betaling=betaald");
  });

  test("the language switch saves only on a business of the login", async ({ page, browser, baseURL }) => {
    test.slow();
    const control = await controlIds(browser, baseURL);
    await signInAs(page, EN_OWNER, `${P}/app`);
    // A request that names another login's business, or none: only the redirect. The control owner's pages stay Dutch.
    for (const q of [`&business=${control.business}`, ""]) {
      const res = await page.request.get(`/api/lang?to=en&next=${encodeURIComponent("/app")}${q}`, { maxRedirects: 0 });
      expect(res.status()).toBe(303);
      expect(new URL(res.headers()["location"]!).pathname).toBe("/en/app");
    }
    const ctx = await browser.newContext({ baseURL });
    const ander = await ctx.newPage();
    await signInAs(ander, CONTROL_OWNER, "/app");
    expect(new URL(ander.url()).pathname, "the control business is still Dutch").toBe("/app");
    await ctx.close();
    // On a public page the switch of a signed-in owner carries the business they have open (LangSwitch), and the route re-checks it.
    const rotterdam = await activeBusinessId(page, P);
    await visit(page, "/en/why");
    const link = await page.locator("a[href^='/api/lang']").first().getAttribute("href");
    expect(link, "a signed-in owner's language link").toContain(`&business=${rotterdam}`);
    // `next` cannot leave the site.
    const out = await page.request.get(`/api/lang?to=nl&next=${encodeURIComponent("//evil.example/x")}`, { maxRedirects: 0 });
    expect(new URL(out.headers()["location"]!).host).toBe(new URL(baseURL!).host);
  });

  test("domain verify: a failed check does not keep the verified date, so a foreign host never blocks its real owner (V-SEC-05)", async ({ page, browser, baseURL }) => {
    test.slow();
    await signInAs(page, EN_OWNER, `${P}/app`);
    const rotterdam = await activeBusinessId(page, P);
    await switchTo(page, NAMES.enLeiden);
    const leiden = await activeBusinessId(page, P);
    const own = `own-${Date.now() % 1000000}.example`;
    const victim = `victim-${Date.now() % 1000000}.example`;
    const post = async (form: Record<string, string>) => {
      const res = await page.request.post("/api/domain/verify", { form, headers: { origin: baseURL! }, maxRedirects: 0 });
      return new URL(res.headers()["location"]!).pathname + new URL(res.headers()["location"]!).search;
    };
    expect(await post({ business: rotterdam, host: own, simulate: "1" })).toBe("/app/domein?dns=ok");
    // Rotterdam now names someone else's host with no DNS behind it: the check fails and it stops being a verified holder ...
    expect(await post({ business: rotterdam, host: victim })).toBe("/app/domein?dns=nee");
    // ... so the real owner's verify of that host is not "taken".
    expect(await post({ business: leiden, host: victim, simulate: "1" })).toBe("/app/domein?dns=ok");
    // A cross-site POST changes nothing: no Origin, no work.
    const foreign = await page.request.post("/api/domain/verify", { form: { business: leiden, host: own, simulate: "1" }, headers: { origin: "https://evil.example" }, maxRedirects: 0 });
    expect(foreign.status()).toBe(403);
    const none = await page.request.post("/api/domain/verify", { form: { business: leiden, host: own, simulate: "1" }, maxRedirects: 0 });
    expect(none.status()).toBe(403);
  });
});
