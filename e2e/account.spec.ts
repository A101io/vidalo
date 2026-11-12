import { expect, test, type Page } from "@playwright/test";
import { dismissNotice, startCheckViaApi } from "./helpers";

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
  await page.goto(await startCheckViaApi(page, { q: "Kapsalon Vreemd", place: "Haarlem", email: "e2e@example.nl" }));
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
  await expect(page.getByRole("status").filter({ hasText: "De koppeling met Google is verbroken." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Koppeling verbreken" })).toHaveCount(0);
  // Ownership proof stays (the first card still says verified).
  expect(await page.locator("section").first().innerText()).toContain(verifiedLine.split("\n")[1] ?? verifiedLine);
});

// ---- A-05: "Verwijder alles" on every plan ----

const SCAN = "scan-eigenaar@example.nl";
const MONTHLY = "maand-eigenaar@example.nl";

test("A-05: a hand-edited business of another login changes nothing", async ({ page }) => {
  await signInAs(page, DEMO);
  const demoId = await demoBusinessId(page);
  await page.context().clearCookies();
  await signInAs(page, SCAN, "/app/account/verwijderen");
  await page.goto("/app/account/verwijderen");
  await page.locator("form input[name='business']").last().evaluate((el, id) => ((el as HTMLInputElement).value = id), demoId);
  await page.locator("input[name='confirm']").check();
  await page.getByRole("button", { name: "Verwijder alles" }).click();
  await page.waitForURL((u) => u.pathname === "/app");
  // Both businesses are still there.
  await page.goto("/app/account");
  await expect(page.locator("main")).toContainText("Fietsenmaker Scan");
  await page.context().clearCookies();
  await signInAs(page, DEMO);
  expect(await demoBusinessId(page)).toBe(demoId);
});

test("A-05: the Monthly owner sees money and invoices before the button, schedules, gets the mail, calls it off", async ({ page }) => {
  await signInAs(page, MONTHLY, "/app/account/verwijderen");
  await page.goto("/app/account/verwijderen");
  const money = page.locator("[data-money]");
  await expect(money).toContainText("Het bedrag voor de lopende maand krijg je niet terug");
  await expect(page.locator("[data-invoices]")).toContainText("Download ze dus eerst");
  // Both sentences come before the button.
  const order = await page.evaluate(() => {
    const m = document.querySelector("[data-money]")!;
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Verwijder alles")!;
    return m.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  expect(order).toBeTruthy();
  await page.locator("input[name='confirm']").check();
  await page.getByRole("button", { name: "Verwijder alles" }).click();
  await page.waitForURL(/gegevens=gepland/);
  await expect(page.getByRole("status").filter({ hasText: "worden op de einddatum verwijderd" })).toBeVisible();
  await expect(page.getByText(/Je gegevens worden op \d+ \w+ \d{4} verwijderd\./)).toBeVisible();
  await page.goto("/app/abonnement");
  await expect(page.locator("[data-deletion-scheduled]")).toContainText("Je gegevens worden op");
  // The mail went out at once (logged on the business; read back through the owner's own download).
  const id = (await page.locator("form input[name='business']").first().getAttribute("value"))!;
  const data = await (await page.request.get(`/api/account/export?business=${id}`)).json();
  expect(data.events.some((e: { type: string }) => e.type === "mail.deletion_scheduled")).toBe(true);
  expect(data.business.deleteReason).toBe("owner");
  // Toch bewaren.
  await page.locator("[data-deletion-scheduled]").getByRole("button", { name: "Toch bewaren" }).click();
  await page.waitForURL(/gegevens=bewaard/);
  await expect(page.getByRole("status").filter({ hasText: "Je gegevens blijven bewaard." })).toBeVisible();
  await expect(page.getByText(/Je gegevens worden op .* verwijderd\./)).toHaveCount(0);
});

test("A-05: the English delete page (the owner's language set to English first)", async ({ page }) => {
  await signInAs(page, MONTHLY, "/app/account");
  await page.goto("/app/account");
  await page.locator("select[name='language']").selectOption("en");
  await page.locator("select[name='language']").locator("xpath=ancestor::form").getByRole("button").click();
  await page.waitForURL(/\/en\/app\/account\?taal=opgeslagen/);
  await page.goto("/en/app/account/verwijderen");
  await expect(page.locator("h1")).toHaveText("Delete everything");
  await expect(page.locator("[data-money]")).toContainText("The amount for the current month is not refunded");
  // Back to Dutch for the tests after this one.
  await page.goto("/en/app/account");
  await page.locator("select[name='language']").selectOption("nl");
  await page.locator("select[name='language']").locator("xpath=ancestor::form").getByRole("button").click();
  await page.waitForURL(/\/app\/account\?taal=opgeslagen/);
});

test("A-05: the Vidalo Scan owner deletes at once and has no business afterwards", async ({ page }) => {
  await signInAs(page, SCAN, "/app/account/verwijderen");
  await page.goto("/app/account/verwijderen");
  await expect(page.locator("[data-money]")).toContainText("Vidalo Scan krijg je niet terug");
  await page.locator("input[name='confirm']").check();
  await page.getByRole("button", { name: "Verwijder alles" }).click();
  await page.waitForURL(/\/inloggen\?verwijderd=1/);
  await expect(page.getByRole("status")).toContainText("Je gegevens zijn verwijderd.");
  // Cookies cleared: signed out. Signing in again finds no business.
  await page.goto("/app");
  await expect(page).toHaveURL(/\/inloggen/);
  await signInAs(page, SCAN, "/app");
  await expect(page).toHaveURL(/\/inloggen\?fout=geen/);
});

test("A-06: after the end, /app/abonnement says what stopped, until when, and that Google is gone", async ({ page }) => {
  await signInAs(page, "eind-eigenaar@example.nl", "/app/abonnement");
  await page.goto("/app/abonnement");
  const end = page.locator("[data-end-state]");
  await expect(end).toContainText("Je abonnement is afgelopen");
  await expect(end).toContainText("Je feitenpagina stuurt bezoekers door naar je eigen website.");
  await expect(end).toContainText(/Je rapporten blijven tot \d+ \w+ \d{4} te zien/);
  await expect(end).toContainText("14 dagen vooraf krijg je een herinnering");
  await expect(end).toContainText("De koppeling met Google is verbroken");
});

test("V-SEC-03: route handlers that read the session are never cached", async ({ page, baseURL }) => {
  await signInAs(page, DEMO);
  const id = await demoBusinessId(page);
  const answers = [
    await page.request.get(`/api/google/start?business=${id}`, { maxRedirects: 0 }),
    await page.request.get(`/api/google/callback?state=x&code=y`, { maxRedirects: 0 }),
    await page.request.post("/api/billing/portal", { headers: { origin: new URL(baseURL!).origin }, form: { business: id }, maxRedirects: 0 }),
  ];
  for (const r of answers) {
    expect(r.headers()["cache-control"] ?? "", r.url()).toMatch(/private/);
    expect(r.headers()["cache-control"] ?? "", r.url()).toMatch(/no-store/);
  }
});
