import { expect, test, type Page } from "@playwright/test";
import { dismissNotice } from "./helpers";

/**
 * 13 Nov 2026 owner fixes (mock mode): the sticky footer and the cookie button in it, starting a new check from
 * behind the login, and removing a check (with another user's check as the control).
 */

async function signIn(page: Page, email: string, next = "/eigenaar/bevestigen") {
  await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);
  await dismissNotice(page);
  await page.locator("input[name='email']").fill(email);
  await page.locator("button[type='submit']").click();
  await page.waitForURL((u) => !u.pathname.startsWith("/inloggen"));
}

/** A finished free check through the API, as the asker `email`; returns the report path. */
async function freeCheck(page: Page, name: string, email: string): Promise<string> {
  const res = await page.request.post("/api/scan", { form: { q: name, place: "Haarlem", email }, maxRedirects: 0 });
  const waiting = res.headers()["location"]!;
  await page.goto(waiting);
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 60_000 });
  return new URL(page.url()).pathname;
}

for (const size of [{ name: "desktop", width: 1280, height: 800 }, { name: "375", width: 375, height: 667 }]) {
  test.describe(`${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    // The pages that wrap main and footer directly, short and long, NL and EN.
    for (const path of ["/scan/druk?check=1", "/en/scan/druk?check=1", "/inloggen", "/en/login", "/cookies", "/en/cookies", "/contact", "/zzz-bestaat-niet"]) {
      test(`the footer reaches the bottom of the viewport on ${path}`, async ({ page }) => {
        await page.goto(path);
        await dismissNotice(page);
        const box = await page.locator("footer").last().boundingBox();
        const docHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        // On a page shorter than the viewport the footer ends exactly at the bottom; on a longer page it ends the document.
        expect(Math.round(box!.y + box!.height)).toBe(Math.max(docHeight, size.height));
        await page.screenshot({ path: `out/screenshots/footer-${size.name}-${path.replace(/[^a-z0-9]+/gi, "_")}.png` });
      });
    }

    test("Cookie-instellingen sits on the line of its neighbours and looks like them", async ({ page }) => {
      await page.goto("/scan/druk?check=1");
      await dismissNotice(page);
      const footer = page.locator("footer").last();
      const button = footer.getByRole("button", { name: /Cookie-instellingen/ });
      const link = footer.getByRole("link", { name: "Cookies", exact: true });
      await expect(button).toBeVisible();
      const style = (l: ReturnType<Page["locator"]>) =>
        l.evaluate((el) => {
          const c = getComputedStyle(el);
          return { font: `${c.fontFamily}|${c.fontSize}|${c.fontWeight}|${c.lineHeight}`, color: c.color, padding: c.padding, border: c.borderTopWidth, display: c.display };
        });
      expect(await style(button)).toEqual(await style(link));
      // The text itself sits on the same line: the same top and height of its glyph box, so the same baseline.
      // (Link boxes may stretch to the tallest item in the row; the text does not move with them.)
      const text = (l: ReturnType<Page["locator"]>) => l.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); const b = r.getBoundingClientRect(); return { top: b.top, height: b.height }; });
      const [a, b] = [await text(button), await text(link)];
      expect(Math.abs(a.top - b.top)).toBeLessThanOrEqual(1);
      expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(1);
      await footer.screenshot({ path: `out/screenshots/footer-cookie-${size.name}.png` });
    });
  });
}

test("the full footer's Cookie-instellingen is as wide as its text, like the links above it", async ({ page }) => {
  await page.goto("/cookies");
  await dismissNotice(page);
  const footer = page.locator("footer").last();
  const button = footer.getByRole("button", { name: /Cookie-instellingen/ });
  const link = footer.getByRole("link", { name: "Privacybeleid" }).first();
  await expect(button).toBeVisible();
  const [a, b] = [await button.boundingBox(), await link.boundingBox()];
  expect(Math.abs(a!.height - b!.height)).toBeLessThanOrEqual(1);
  const text = await button.evaluate((el) => (el as HTMLElement).getBoundingClientRect().width);
  const range = await button.evaluate((el) => { const r = document.createRange(); r.selectNodeContents(el); return r.getBoundingClientRect().width; });
  expect(Math.abs(text - range)).toBeLessThanOrEqual(2);
});

test("a signed-in person without a business starts a new check from behind the login, with their address filled in", async ({ page }) => {
  const email = `nieuw-${Date.now()}@example.com`;
  await signIn(page, email);
  await page.goto("/inloggen");
  const start = page.getByRole("link", { name: "Nieuwe controle" });
  await expect(start).toBeVisible();
  await start.click();
  await expect(page).toHaveURL(/\/controle$/);
  const form = page.locator("form[action='/api/scan']");
  await expect(form.locator("input[name='email']")).toHaveValue(email);
  await form.locator("input[name='q']").fill(`Bakkerij Nieuw ${Date.now()}`);
  await form.locator("input[name='place']").fill("Haarlem");
  await page.screenshot({ path: "out/screenshots/nieuwe-controle.png" });
  await form.locator("button[type='submit']").click();
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 60_000 });
  // The second check on the same login: the list holds both.
  await freeCheck(page, `Kapper Tweede ${Date.now()}`, email);
  await page.goto("/inloggen");
  await expect(page.locator("#my-checks ~ ul li")).toHaveCount(2);
  await page.screenshot({ path: "out/screenshots/je-controles.png", fullPage: true });
});

test("/controle sends a visitor who is not signed in to the sign-in page", async ({ page }) => {
  await page.goto("/controle");
  await expect(page).toHaveURL(/\/inloggen\?next=%2Fcontrole/);
  await page.goto("/en/check");
  await expect(page).toHaveURL(/\/en\/login\?next=%2Fcontrole/);
});

test("remove a check: confirm step, then it is gone; someone else's check cannot be removed", async ({ browser }) => {
  const mine = `ik-${Date.now()}@example.com`;
  const other = `ander-${Date.now()}@example.com`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await signIn(a, mine);
  await signIn(b, other);
  const reportA = await freeCheck(a, `Slager Eigen ${Date.now()}`, mine);
  const reportB = await freeCheck(b, `Slager Ander ${Date.now()}`, other);
  const runA = reportA.split("/").pop()!;
  const runB = reportB.split("/").pop()!;

  // B tries A's confirm page and A's action: sent back with a refusal, A's report still opens.
  await b.goto(`/controle/verwijderen/${runA}?terug=/inloggen`);
  await expect(b).toHaveURL(/\/inloggen\?controle=not_yours/);
  await expect(b.getByText("Deze controle hoort niet bij je account")).toBeVisible();
  const forged = await b.request.post(`/controle/verwijderen/${runA}`, { form: { run: runA, back: "/inloggen" }, maxRedirects: 0 }).catch(() => null);
  expect(forged === null || forged.status() >= 300).toBe(true);
  expect((await a.request.get(reportA)).status()).toBe(200);

  // A removes their own: confirm step first, cancel keeps it.
  await a.goto("/inloggen");
  await a.getByRole("link", { name: /Verwijder de controle van Slager Eigen/ }).click();
  await expect(a.getByRole("heading", { name: /verwijderen\?/ })).toBeVisible();
  await a.screenshot({ path: "out/screenshots/controle-verwijderen.png" });
  await a.getByRole("link", { name: "Nee, behouden" }).click();
  await a.waitForURL(/\/inloggen$/);
  const list = a.locator("#my-checks ~ ul");
  await expect(list.getByText("Slager Eigen")).toBeVisible();
  await a.getByRole("link", { name: /Verwijder de controle van Slager Eigen/ }).click();
  await a.getByRole("button", { name: "Ja, verwijder" }).click();
  await expect(a).toHaveURL(/\/inloggen\?controle=weg/);
  await expect(a.getByText("De controle is verwijderd.")).toBeVisible();
  await expect(a.locator("#my-checks")).toHaveCount(0);
  // The report is gone for everyone, B's own check is untouched.
  expect((await a.request.get(reportA)).status()).toBe(404);
  expect((await b.request.get(reportB)).status()).toBe(200);
  await b.goto("/inloggen");
  await expect(b.locator("#my-checks ~ ul").getByText("Slager Ander")).toBeVisible();
  await ctxA.close();
  await ctxB.close();
});
