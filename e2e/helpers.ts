import { expect, type Page } from "@playwright/test";

/** Every public page, as the Dutch route; `en()` gives its English URL (lib/lang-paths.ts). */
export const SECTORS = [
  "loodgieters-installateurs",
  "aannemers-dakdekkers-schilders",
  "vve-beheer",
  "zorg-praktijken",
  "horeca",
  "winkels",
  "garages-fietsenmakers",
  "kappers-schoonheid",
  "advocaten-notarissen-accountants",
  "makelaars-hypotheek",
  "kinderopvang-sport-rijscholen",
];

export const PUBLIC_ROUTES = [
  "/",
  "/prijzen",
  "/waarom",
  "/hoe-het-werkt",
  "/straks",
  "/voorwaarden",
  "/privacy",
  "/cookies",
  "/inloggen",
  "/feiten",
  "/r/voorbeeld",
  "/r/voorbeeld-grijs",
  "/r/voorbeeld-online",
  ...SECTORS.map((s) => `/vak/${s}`),
];

const EN_SLUGS: Record<string, string> = {
  prijzen: "pricing",
  waarom: "why",
  "hoe-het-werkt": "how-it-works",
  straks: "whats-next",
  vak: "sectors",
  voorwaarden: "terms",
  inloggen: "login",
  afmelden: "unsubscribe",
  welkom: "welcome",
  eigenaar: "owner",
  feiten: "facts",
  binnenkort: "coming-soon",
  voorvertoning: "preview",
};

export function en(route: string): string {
  const [, first = "", ...rest] = route.split("/");
  return "/en" + (first ? "/" + [EN_SLUGS[first] ?? first, ...rest].join("/") : "");
}

/** Errors the page itself raised: uncaught exceptions and console errors, minus browser noise. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/favicon|Download the React DevTools|\[Fast Refresh\]|webpack-hmr|_next\/webpack/.test(t)) return;
    errors.push(`console: ${t}`);
  });
  return errors;
}

/** Dismisses the cookie notice if it is showing. */
export async function dismissNotice(page: Page) {
  // The notice mounts after hydration (CookieConsent reads the cookie in an effect), so give it a moment;
  // with a category to choose it is tall enough to cover the hero's button.
  const ok = page.getByRole("button", { name: /^(Begrepen|Got it|Alleen noodzakelijk|Necessary only)$/ }).first();
  if (await ok.waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false)) await ok.click();
  // On a cold dev server the first visit still compiles; a Fast Refresh reload after this point would empty the fields a test fills next.
  await page.waitForLoadState("networkidle");
}

/**
 * After a free-check post: the check starts only from the link in the confirmation mail
 * (core/shared/scan-confirm.ts). With mock engines /scan/mail shows that link; follow it and press start.
 */
export async function confirmCheck(page: Page) {
  await page.waitForURL(/\/(en\/)?scan\/mail\?/);
  await page.getByTestId("confirm-link").click();
  await page.waitForURL(/\/(en\/)?scan\/bevestigen\?t=/);
  await page.locator("main form[action='/api/scan/bevestigen'] button[type='submit']").click();
}

/**
 * A free check through the API (no form): the post, then the confirmation link's button
 * (mock engines: /scan/mail?link=<token>). Returns the waiting room's URL.
 */
export async function startCheckViaApi(page: Page, form: Record<string, string>): Promise<string> {
  const res = await page.request.post("/api/scan", { form, maxRedirects: 0 });
  const mail = new URL(res.headers()["location"]!);
  expect(mail.pathname).toBe("/scan/mail");
  const started = await page.request.post("/api/scan/bevestigen", { form: { t: mail.searchParams.get("link")! }, maxRedirects: 0 });
  const waiting = started.headers()["location"]!;
  expect(waiting).toMatch(/\/scan\/[^/?#]+$/);
  return waiting;
}

export async function expectNoErrors(errors: string[]) {
  expect(errors, errors.join("\n")).toEqual([]);
}
