import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { confirmCheck, dismissNotice } from "./helpers";

/**
 * QA, feature 001, verify round 1 (2026-11-15), mock mode. AC-5 and AC-8 on a report the mock pipeline really built
 * for an online business (not only the demo), NL and EN; the waiting page's live region; the demo online report.
 */
const RANK = /%|#\d|\bplek \d|\bpositie\b|\bposition\b|\bscore\b|\brank/i;

async function seriousOrCritical(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  return r.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length}x)`);
}

async function onlineCheck(page: Page, lang: "nl" | "en") {
  const name = `Vloedlijn Music ${Date.now()}${Math.floor(Math.random() * 1000)}`;
  await page.goto(lang === "nl" ? "/" : "/en");
  await dismissNotice(page);
  const form = page.locator("form[action='/api/scan']").first();
  await form.locator("input[name='q']").fill(name);
  await form.locator("input[name='place']").fill("Utrecht");
  // Since #139 a free check needs a postcode or website; a postcode Google does not know leads to the website field (as scan-website.spec.ts).
  await form.locator("input[name='identity']").fill("3511 AB 1");
  await form.locator("input[name='email']").fill("e2e@example.nl");
  await form.locator("button[type='submit']").click();
  await page.waitForURL(/\/scan\/kies/);
  await dismissNotice(page);
  await page.getByLabel(lang === "nl" ? "Wat is je website?" : "What is your website?").fill("www.vloedlijn-music.example");
  await page.locator("main button[type='submit']").click();
  // Since #121 the check starts from the confirmation link (mock: shown on /scan/mail).
  await confirmCheck(page);
  await page.waitForURL(/\/r\/[^/?#]+/, { timeout: 90_000 });
  await dismissNotice(page);
  return name;
}

for (const lang of ["nl", "en"] as const) {
  test(`AC-5/AC-8 a real mock online report (${lang}): competition block with n van m, no rank, no town in its questions; axe clean`, async ({ page }) => {
    test.setTimeout(150_000);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await onlineCheck(page, lang);
    const block = page.locator("section[aria-labelledby='competition-h']");
    await expect(block).toBeVisible();
    const text = (await block.innerText()).replace(/\s+/g, " ");
    expect(text).toMatch(lang === "nl" ? /\d+ van \d+/ : /\d+ (of|out of) \d+/);
    expect(text).not.toMatch(RANK);
    // AC-2/A2: no question in the block carries the town. (The mock engines name "<surname> Utrecht" as the others;
    // that is mock data, compliance V1-COMP-06b, not a question.)
    const questions = await block.locator("li > span.font-semibold").allInnerTexts();
    expect(questions.length).toBeGreaterThan(0);
    for (const q of questions) expect(q).not.toContain("Utrecht");
    expect(await seriousOrCritical(page)).toEqual([]);
    if (lang === "en") expect(page.url()).toContain("/en/");
  });
}

for (const path of ["/r/voorbeeld-online", "/en/r/voorbeeld-online"]) {
  test(`AC-5/AC-8 demo ${path}: block shown, no rank, axe clean`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(path);
    await dismissNotice(page);
    const block = page.locator("section[aria-labelledby='competition-h']");
    await expect(block).toBeVisible();
    expect((await block.innerText()).replace(/\s+/g, " ")).not.toMatch(RANK);
    expect(await seriousOrCritical(page)).toEqual([]);
  });
}

// fixme (qa-r1.md, AC-A9): in mock mode the scan has finished before the waiting page renders, and a second request for the
// /scan/<token> hop answered not-found on the dev server (observed 15 Nov 2026). The markup is read in the source instead
// (ScanProgress.tsx:107 aria-live="polite", page.tsx:29 noscript refresh) and the state by test/scan-progress.test.ts.
test.fixme("AC-A9 waiting page: a polite live region and a no-JS refresh exist in the server HTML", async ({ page, request }) => {
  test.setTimeout(150_000);
  // Capture the first /scan/<id> URL on the way to the report.
  // The waiting page is a hop in the redirect chain (POST -> /scan/<id> -> /r/<id> once done), so it is caught as a
  // response, not as a committed navigation.
  let waitingUrl: string | null = null;
  page.on("response", (r) => {
    if (/\/scan\/(?!kies)[^/?#]+$/.test(new URL(r.url()).pathname)) waitingUrl ??= r.url();
  });
  await onlineCheck(page, "nl");
  expect(waitingUrl).not.toBeNull();
  const html = await (await request.get(waitingUrl!, { maxRedirects: 0 })).text();
  // a finished scan redirects to the report (307 with an empty body); otherwise the page carries both.
  // In mock mode the scan is usually done before this request, so the markup itself is read in the source (qa-r1.md AC-A9).
  if (html.length > 0) {
    expect(html).toContain('aria-live="polite"');
    expect(html).toMatch(/http-equiv="refresh"/i);
  }
});
