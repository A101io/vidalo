import { expect, test, type Page } from "@playwright/test";
import { dismissNotice } from "./helpers";

/**
 * Feature 002, lane A, mock mode: the owner's download (A-04), Google disconnect (A-04) and,
 * from A-05, deleting everything. Signs in through the mock form like signed-in.spec.ts.
 */
async function signInAs(page: Page, email: string, next = "/app/account") {
  await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);
  await dismissNotice(page);
  await page.locator("input[name='email']").fill(email);
  await page.locator("form button[type='submit']").first().click();
  await page.waitForURL((u) => u.pathname !== "/inloggen");
}

const DEMO = "eigenaar@bakkerijdevries.nl";

async function demoBusinessId(page: Page): Promise<string> {
  await page.goto("/app/account");
  return (await page.locator("form input[name='business']").first().getAttribute("value"))!;
}

test.describe.configure({ mode: "serial" });

test("A-04: the download is the member's own business, streamed, without access keys", async ({ page }) => {
  await signInAs(page, DEMO);
  const id = await demoBusinessId(page);
  const link = page.locator("a[download]");
  await expect(link).toHaveAttribute("href", `/api/account/export?business=${id}`);
  const res = await page.request.get(`/api/account/export?business=${id}`);
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h["content-type"]).toContain("application/json");
  expect(h["content-disposition"]).toMatch(/^attachment; filename="vidalo-/);
  expect(h["cache-control"]).toBe("no-store");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["access-control-allow-origin"]).toBeUndefined();
  const body = await res.text();
  const data = JSON.parse(body);
  expect(data.business.id).toBe(id);
  expect(data.signedInAs).toBe(DEMO);
  expect(Array.isArray(data.signIns) && data.signIns.length).toBeGreaterThan(0);
  for (const key of ["refreshToken", "accessToken", "expiresAt"]) expect(body).not.toContain(`"${key}"`);
});

test("A-04: another, an unknown or a malformed business id gets the same 404; signed out gets 401", async ({ page, browser }) => {
  // Another business: a fresh free check (nobody's member).
  const res = await page.request.post("/api/scan", { form: { q: "Kapsalon Vreemd", place: "Haarlem", email: "e2e@example.nl" }, maxRedirects: 0 });
  await page.goto(res.headers()["location"]!);
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 60_000 });
  const foreign = (await page.locator("form[action='/api/checkout'] input[name='business']").first().getAttribute("value"))!;
  await signInAs(page, DEMO);
  const bodies = [];
  for (const id of [foreign, "00000000-0000-4000-8000-000000000000", "'; drop table business;--"]) {
    const r = await page.request.get(`/api/account/export?business=${encodeURIComponent(id)}`);
    expect(r.status(), id).toBe(404);
    bodies.push(await r.text());
  }
  expect(new Set(bodies).size).toBe(1);
  const out = await browser.newContext();
  expect((await out.request.get(`/api/account/export?business=${foreign}`)).status()).toBe(401);
  await out.close();
});

test("A-04: Koppeling met Google verbreken removes the connection and keeps the ownership proof", async ({ page }) => {
  await signInAs(page, DEMO, "/app/google");
  await page.goto("/app/google");
  const button = page.getByRole("button", { name: "Koppeling verbreken" });
  await expect(button).toBeVisible();
  const verifiedLine = await page.locator("section").first().innerText();
  await button.click();
  await page.waitForURL(/ontkoppeld=1/);
  await expect(page.getByRole("status")).toContainText("De koppeling met Google is verbroken.");
  await expect(page.getByRole("button", { name: "Koppeling verbreken" })).toHaveCount(0);
  // Ownership proof stays (the first card still says verified).
  expect(await page.locator("section").first().innerText()).toContain(verifiedLine.split("\n")[1] ?? verifiedLine);
});
