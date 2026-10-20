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
  const ok = page.getByRole("button", { name: /^(Begrepen|Got it|Alleen noodzakelijk|Only necessary)$/ });
  if (await ok.first().isVisible().catch(() => false)) await ok.first().click();
}

export async function expectNoErrors(errors: string[]) {
  expect(errors, errors.join("\n")).toEqual([]);
}
