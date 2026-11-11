import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { dismissNotice } from "./helpers";

/**
 * Feature 001, FE-03: "Zo lezen wij je bedrijf" on /app/gegevens. The demo owner (mock mode) corrects how
 * the checks read the business; a refused value is answered next to its field, in the page's language.
 * One shared demo business, so the tests run in order and put the first reading back.
 */
test.describe.configure({ mode: "serial" });

const SHOTS = "out/journey-mock";
const ORIGINAL = { mode: "door", offer: "brood, gebak en taarten op bestelling", audience: "buurtbewoners in Haarlem", category: "bakkerij" };

async function signIn(page: Page) {
  await page.goto(`/inloggen?next=${encodeURIComponent("/app/gegevens")}`);
  await dismissNotice(page);
  await page.locator("input[name='email']").fill("eigenaar@bakkerijdevries.nl");
  await page.locator("button[type='submit']").click();
  await page.waitForURL(/\/app\/gegevens/);
  await dismissNotice(page);
}

async function setLang(page: Page, lang: "nl" | "en") {
  await page.goto(`/api/lang?to=${lang}&next=${encodeURIComponent("/app/gegevens")}`);
  await page.waitForURL(lang === "en" ? /\/en\/app\/gegevens/ : /\/app\/gegevens/);
  await dismissNotice(page);
}

async function fill(page: Page, v: { mode?: string; offer?: string; audience?: string; category?: string }) {
  if (v.mode) await page.locator(`#profiel input[name='profileMode'][value='${v.mode}']`).check();
  if (v.offer !== undefined) await page.locator("#profileOffer").fill(v.offer);
  if (v.audience !== undefined) await page.locator("#profileAudience").fill(v.audience);
  if (v.category !== undefined) await page.locator("#profileCategory").fill(v.category);
}

const save = (page: Page) => Promise.all([page.waitForURL(/profiel(fout)?=/), page.locator("#profiel button[type='submit']").click()]);

test.afterAll(async ({ browser }, testInfo) => {
  // One worker per project shares the server: only the desktop one (which saves) puts the reading back.
  if (testInfo.project.name !== "desktop") return;
  const page = await browser.newPage();
  await signIn(page);
  await setLang(page, "nl");
  await fill(page, ORIGINAL);
  await save(page);
  await page.close();
});

test("the group shows the current reading, where it came from, and the page keeps one primary button", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  const group = page.locator("#profiel");
  await expect(group.getByRole("heading", { name: "Zo lezen wij je bedrijf" })).toBeVisible();
  await expect(group.getByRole("radio", { name: /Klanten komen bij mij langs/ })).toBeChecked();
  await expect(page.locator("#profileOffer")).toHaveValue(ORIGINAL.offer);
  await expect(page.locator("#profileAudience")).toHaveValue(ORIGINAL.audience);
  await expect(page.locator("#profileCategory")).toHaveValue(ORIGINAL.category);
  await expect(group.getByText(/^Automatisch bepaald op .* uit Google en je website\.$/)).toBeVisible();
  // The facts form's button is the only primary one; the save here is the secondary kind.
  await expect(page.locator("main .btn-primary")).toHaveCount(1);
  await expect(group.locator("button[type='submit']")).toHaveText("Opslaan");
  await expect(group.locator("button[type='submit']")).not.toHaveClass(/btn-primary/);
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/gegevens-profiel-nl-auto.png` });
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a correction is saved, shown after a reload, and marked as the owner's", async ({ page }) => {
  await signIn(page);
  await fill(page, { mode: "visit", offer: "taarten bij je thuis bezorgd", audience: "gezinnen", category: "banketbakker" });
  // A business id in the form is ignored: the business comes from the session (S-24).
  await page.locator("#profiel form").evaluate((f) => {
    for (const name of ["businessId", "id", "slug"]) {
      const i = document.createElement("input");
      i.type = "hidden";
      i.name = name;
      i.value = "somebody-else";
      f.appendChild(i);
    }
  });
  await save(page);
  await expect(page).toHaveURL(/\/app\/gegevens\?profiel=1#profiel$/);
  const group = page.locator("#profiel");
  await expect(group.getByRole("status")).toHaveText("Opgeslagen. De volgende controle gebruikt dit.");
  await expect(group.getByText(/^Door jou aangepast op /)).toBeVisible();
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/gegevens-profiel-nl-saved.png` });
  await page.goto("/app/gegevens");
  await expect(group.getByRole("radio", { name: /Ik kom bij de klant/ })).toBeChecked();
  await expect(page.locator("#profileOffer")).toHaveValue("taarten bij je thuis bezorgd");
  await expect(page.locator("#profileAudience")).toHaveValue("gezinnen");
  await expect(page.locator("#profileCategory")).toHaveValue("banketbakker");
  await expect(group.getByText(/^Door jou aangepast op /)).toBeVisible();
  await expect(group.getByRole("status")).toBeEmpty();
});

test("a refused or missing value is answered next to its field, announced, and nothing from the URL is echoed", async ({ page }) => {
  await signIn(page);
  await fill(page, { offer: "<img src=x onerror=alert(1)>" });
  await save(page);
  await expect(page).toHaveURL(/profielfout=offer:refused#profiel$/);
  const offer = page.locator("#profileOffer");
  await expect(offer).toHaveAttribute("aria-invalid", "true");
  const msg = "Dit kunnen we niet gebruiken. Schrijf het als een korte omschrijving in gewone woorden.";
  await expect(page.locator("#profile-err-offer")).toHaveText(msg);
  expect(await offer.getAttribute("aria-describedby")).toContain("profile-err-offer");
  await expect(page.locator("#profiel").getByRole("status")).toHaveText(`Niet opgeslagen. ${msg}`);
  await expect(offer).toBeFocused();
  expect(await page.locator("#profiel img").count()).toBe(0);
  await page.locator("#profiel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/gegevens-profiel-nl-error.png` });

  // The save did not happen: the earlier correction still stands.
  await page.goto("/app/gegevens");
  await expect(page.locator("#profileOffer")).toHaveValue("taarten bij je thuis bezorgd");

  await fill(page, { category: "" });
  await save(page);
  await expect(page).toHaveURL(/profielfout=category:required#profiel$/);
  await expect(page.locator("#profile-err-category")).toHaveText("Vul in hoe een klant naar je zoekt.");
  await expect(page.locator("#profileCategory")).toHaveAttribute("aria-invalid", "true");

  await page.goto("/app/gegevens?profielfout=<script>x</script>:y");
  await expect(page.locator("#profiel [id^='profile-err-']")).toHaveCount(0);
  await expect(page.locator("#profiel").getByRole("status")).toBeEmpty();
  expect(await page.locator("#profiel script").count()).toBe(0);

  // Over the length: the page's own limit is on the field, so go around it as a script would.
  await page.goto("/app/gegevens");
  await page.locator("#profileOffer").evaluate((el) => el.removeAttribute("maxlength"));
  await fill(page, { offer: "x".repeat(121) });
  await save(page);
  await expect(page).toHaveURL(/profielfout=offer:too_long#profiel$/);
  await expect(page.locator("#profile-err-offer")).toHaveText("Te lang. Maximaal 120 tekens.");
});

test("English: the group and its errors in the page's language", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  await setLang(page, "en");
  const group = page.locator("#profiel");
  await expect(group.getByRole("heading", { name: "How we read your business" })).toBeVisible();
  await expect(group.getByRole("radio", { name: /I work online or across the whole country/ })).toBeVisible();
  await expect(group.locator("button[type='submit']")).toHaveText("Save");
  await fill(page, { offer: "" });
  await save(page);
  await expect(page).toHaveURL(/\/en\/app\/gegevens\?profielfout=offer:required#profiel$/);
  await expect(page.locator("#profile-err-offer")).toHaveText("Say what you offer.");
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/gegevens-profiel-en-error.png` });
  await page.goto("/en/app/gegevens");
  await fill(page, { mode: "online", offer: "background music for hotels", audience: "hotels", category: "background music provider" });
  await save(page);
  await expect(page).toHaveURL(/\/en\/app\/gegevens\?profiel=1#profiel$/);
  await expect(group.getByRole("status")).toHaveText("Saved. The next check uses this.");
  await expect(group.getByText(/^Changed by you on /)).toBeVisible();
  await group.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/gegevens-profiel-en-saved.png` });
  expect(errors, errors.join("\n")).toEqual([]);
});

for (const lang of ["nl", "en"] as const) {
  test(`@a11y /app/gegevens (${lang}) has no axe violations, with and without an error`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await signIn(page);
    await setLang(page, lang);
    const url = lang === "en" ? "/en/app/gegevens" : "/app/gegevens";
    for (const q of ["", "?profielfout=offer:refused"]) {
      await page.goto(url + q);
      await page.locator("#profiel").waitFor();
      const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      const summary = results.violations.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}x) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(summary, summary.join("\n")).toEqual([]);
    }
  });
}

test("keyboard only: the radio group is one tab stop, then the three fields in order, focus is visible, and Enter saves", async ({ page }) => {
  await signIn(page);
  await setLang(page, "nl");
  await page.locator("#profiel input[name='profileMode']:checked").focus();
  const active = () => page.evaluate(() => (document.activeElement as HTMLInputElement).name);
  const order = [await active()];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    order.push(await active());
  }
  expect(order).toEqual(["profileMode", "profileOffer", "profileAudience", "profileCategory"]);
  const ring = await page.locator("#profileCategory").evaluate((el) => getComputedStyle(el).boxShadow !== "none" || getComputedStyle(el).outlineStyle !== "none");
  expect(ring).toBe(true);
  await page.keyboard.press("Enter");
  await page.waitForURL(/profiel=1/);
});

test("@mobile 375px: no horizontal scroll, targets are at least 44px", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/app/gegevens");
  await page.locator("#profiel").waitFor();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  for (const sel of ["#profiel label:has(input[type='radio'])", "#profileOffer", "#profileAudience", "#profileCategory", "#profiel button[type='submit']"]) {
    for (const box of await page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
  }
  await page.locator("#profiel").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${SHOTS}/gegevens-profiel-nl-375.png` });
});
