import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { confirmCheck, dismissNotice, mockSite } from "./helpers";

/**
 * QA, feature 005 (docs/features/005-scan-identity/qa.md): the guarantees free-check.spec.ts does not reach.
 * Mock mode lists every name with a made-up address and www.<slug>.nl, except names with "Music" (and the other
 * MOCK_ONLINE_RE words), which come back with no listing and no website. The mock website reader recognises a
 * "music" host and says "Gecontroleerd als: aanbieder van achtergrondmuziek", which tells which website the check read.
 */
const uniq = () => `${Date.now()}${Math.floor(Math.random() * 1000)}`;

async function fill(page: Page, name: string, identity: string, lang: "nl" | "en" = "nl") {
  await page.goto(lang === "nl" ? "/" : "/en");
  await dismissNotice(page);
  const form = page.locator("form[action='/api/scan']").first();
  await form.locator("input[name='q']").fill(name);
  await form.locator("input[name='place']").fill("Utrecht");
  await form.locator("input[name='identity']").fill(identity);
  await form.locator("input[name='email']").fill("e2e@example.nl");
  await form.locator("button[type='submit']").click();
}

test("AC-5: a website as identity when nothing is listed starts the check on that website, without the pick page", async ({ page }) => {
  test.setTimeout(120_000);
  await fill(page, `Vloedlijn Music ${uniq()}`, "www.vloedlijn-music.example");
  await page.waitForURL(/\/scan\/mail\?/);
  await confirmCheck(page);
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 60_000 });
  await expect(page.getByText(/Gecontroleerd als: aanbieder van achtergrondmuziek/)).toBeVisible();
});

test("AC-4: 'not listed' checks the business as typed, and uses the typed identity website when the field is empty", async ({ page }) => {
  test.setTimeout(120_000);
  // Listed in mock mode (with www.studio-vloedlijn-….nl), so the typed website matches nobody: the pick page.
  await fill(page, `Studio Vloedlijn ${uniq()}`, "www.vloedlijn-music.example");
  await page.waitForURL(/\/scan\/kies\?/);
  await dismissNotice(page);
  await page.getByRole("button", { name: "Mijn bedrijf staat er niet bij" }).click();
  await page.waitForURL(/\/scan\/mail\?/);
  await confirmCheck(page);
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 60_000 });
  // The candidate's own website would say nothing; only the typed one reads as a music business.
  await expect(page.getByText(/Gecontroleerd als: aanbieder van achtergrondmuziek/)).toBeVisible();
});

test("AC-3: the pick page lists street, postcode and website, and nothing starts without the click", async ({ page }) => {
  const name = `Kapper Lijst ${uniq()}`;
  await fill(page, name, "1011 AA 1");
  await page.waitForURL(/\/scan\/kies\?/);
  const row = page.locator("main li").first();
  await expect(row).toContainText(/[A-Z][a-z]+ ?[a-z]* \d+, \d{4} [A-Z]{2}/);
  await expect(row).toContainText(mockSite(name).replace(/^www\./, ""));
  await expect(row.getByRole("button", { name: "Dit bedrijf" })).toBeVisible();
  await dismissNotice(page);
  await row.getByRole("button", { name: "Dit bedrijf" }).click();
  await page.waitForURL(/\/scan\/mail\?/);
});

test("AC-6: the typed identity is never in a URL or echoed; it rides only in the signed, httpOnly 15-minute cookie", async ({ page }) => {
  const name = `Bakkerij Geheim ${uniq()}`;
  const res = await page.request.post("/api/scan", { form: { q: name, place: "Utrecht", identity: "9999 ZZ 77", email: "e2e@example.nl" }, maxRedirects: 0 });
  const to = res.headers()["location"]!;
  expect(new URL(to).pathname).toBe("/scan/kies");
  const url = new URL(to);
  expect([...url.searchParams.keys()].sort()).toEqual(["place", "q"].concat(url.searchParams.has("k") ? ["k"] : []).sort());
  expect(decodeURIComponent(to)).not.toMatch(/9999 ?ZZ/i);
  const cookie = res.headersArray().find((h) => h.name.toLowerCase() === "set-cookie" && h.value.startsWith("vidalo_check="))!.value;
  expect(cookie).toMatch(/HttpOnly/i);
  expect(cookie).toMatch(/Max-Age=900/);
  // A refused identity goes back to the field without the value in the URL or on the page.
  const bad = await page.request.post("/api/scan", { form: { q: name, place: "Utrecht", identity: "geheim-woonadres 77", email: "e2e@example.nl" }, maxRedirects: 0 });
  const back = bad.headers()["location"]!;
  expect(back).toContain("fout=herken");
  expect(back).not.toContain("geheim");
  await page.goto(back);
  expect(await page.content()).not.toContain("geheim-woonadres");
});

test("AC-1: a pick or 'not listed' needs no identity, but a fresh post without one is refused even with a cookie from before", async ({ page }) => {
  const name = `Slager Volgorde ${uniq()}`;
  const first = await page.request.post("/api/scan", { form: { q: name, place: "Utrecht", identity: "1011 AA 1", email: "e2e@example.nl" }, maxRedirects: 0 });
  expect(new URL(first.headers()["location"]!).pathname).toBe("/scan/kies");
  // From the pick page: the cookie carries address and identity, the form carries neither.
  const pick = await page.request.post("/api/scan", { form: { q: name, place: "Utrecht", pick: "0" }, maxRedirects: 0 });
  expect(new URL(pick.headers()["location"]!).pathname).toBe("/scan/mail");
  // A typed but unusable identity is refused even though the cookie holds a usable one.
  const typedBad = await page.request.post("/api/scan", { form: { q: name, place: "Utrecht", identity: "Vidalo", email: "e2e@example.nl" }, maxRedirects: 0 });
  expect(typedBad.headers()["location"]).toContain("fout=herken");
});

test("AC-8: label, hint and error tied to the field, NL and EN, no axe violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const lang of ["nl", "en"] as const) {
    await page.goto(lang === "nl" ? "/scan/kies?q=Bakkerij%20X&place=Utrecht&fout=herken" : "/en/scan/kies?q=Bakkerij%20X&place=Utrecht&fout=herken");
    await dismissNotice(page);
    const field = page.getByLabel(lang === "nl" ? "Postcode en huisnummer, of website" : "Postcode and house number, or website");
    await expect(field).toHaveAttribute("aria-invalid", "true");
    const ids = (await field.getAttribute("aria-describedby"))!.split(" ");
    expect(ids).toHaveLength(2);
    await expect(page.locator(`#${ids[0]}`)).toContainText(lang === "nl" ? "Zo weten we zeker welk bedrijf" : "So we know for sure which business");
    await expect(page.locator(`#${ids[1]}`)).toContainText(lang === "nl" ? "zoals 3071 AV 80" : "such as 3071 AV 80");
    await expect(page.locator("h1")).toContainText(lang === "nl" ? "postcode en het huisnummer of de website" : "postcode and house number, or its website");
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations.map((v) => `${v.id} (${v.nodes.length}×)`)).toEqual([]);
  }
});

test("@mobile 375 px: the landing form with the identity field has no sideways scroll", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  for (const path of ["/", "/en"]) {
    await page.goto(path);
    await dismissNotice(page);
    const field = page.locator("form[action='/api/scan'] input[name='identity']").first();
    await expect(field).toBeVisible();
    const box = await field.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  }
});
