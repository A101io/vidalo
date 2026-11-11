import { expect, type Browser, type Page } from "@playwright/test";
import { dismissNotice } from "./helpers";

/** Mock sign-in (never on real data). The demo owner holds two businesses; ander@ holds one (the control). */
export const DEMO_OWNER = "eigenaar@bakkerijdevries.nl";
export const CONTROL_OWNER = "ander@example.nl";
export const EN_OWNER = "owner@harbour.example";
export const NAMES = { haarlem: "Bakkerij De Vries, Haarlem", amsterdam: "Bakkerij de Vries, Amsterdam", control: "Kapsalon Ander, Utrecht", enRotterdam: "Harbour Bakery, Rotterdam", enLeiden: "Harbour Bakery, Leiden" } as const;

/** Signs in through /inloggen and lands on `next`. Reduced motion and the cookie notice are dealt with. */
export async function signInAs(page: Page, email: string, next = "/app") {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);
  await dismissNotice(page);
  await page.locator("input[name='email']").fill(email);
  // The submit is a server action: wait for its redirect, or a goto() cancels it before the cookie is set.
  await Promise.all([page.waitForURL((u) => !u.pathname.endsWith("/inloggen")), page.locator("button[type='submit']").click()]);
  await dismissNotice(page);
}

/** page.goto that survives the cold dev server aborting a navigation while it compiles the page (CLAUDE.md, 22 Oct 2026). */
export async function visit(page: Page, path: string) {
  for (let i = 0; ; i++) {
    try {
      await page.goto(path);
      return;
    } catch (e) {
      if (i >= 2 || !/ERR_ABORTED|interrupted by another navigation/.test(String(e))) throw e;
    }
  }
}

export const switcher = (page: Page) => page.locator("select[name='business']");

/** The business the owner pages currently act on: the switcher's selected text, else the header text. */
export async function activeName(page: Page): Promise<string> {
  const sel = switcher(page);
  if (await sel.count()) return (await sel.locator("option:checked").innerText()).trim();
  return (await page.locator("header .text-muted").first().innerText()).trim();
}

/** Picks a business in the switcher and submits it (a plain form: no script needed). */
export async function switchTo(page: Page, label: string) {
  await switcher(page).selectOption({ label });
  await Promise.all([page.waitForURL(/gewisseld=1/), page.getByRole("button", { name: /^(Wissel|Switch)$/ }).click()]);
}

/**
 * The control business's id, learnt the way any visitor can: its report page carries it in the checkout form.
 * Opens its own context so the caller's cookies stay untouched.
 */
export async function controlBusinessId(browser: Browser, baseURL: string | undefined): Promise<string> {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await signInAs(page, CONTROL_OWNER);
  const href = await page.locator("a[href*='/r/']").first().getAttribute("href");
  expect(href, "the control owner's dashboard links to a report").toBeTruthy();
  await page.goto(href!);
  const id = await page.locator("form[action='/api/checkout'] input[name='business']").first().getAttribute("value");
  await ctx.close();
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id!;
}

/** The id the active business's changing forms carry (hidden `business`), read off /app/gegevens in the page's own language. */
export async function activeBusinessId(page: Page, prefix = ""): Promise<string> {
  await visit(page, `${prefix}/app/gegevens`);
  const id = await page.locator("main form input[name='business']").first().getAttribute("value");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  return id!;
}

/** What a signed-in owner can see of one business, as text: the dashboard and the facts versions. Equal before and after = nothing written. */
export async function visibleState(browser: Browser, baseURL: string | undefined, email: string, prefix = ""): Promise<string> {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  try {
    await signInAs(page, email, `${prefix}/app`);
    const parts: string[] = [];
    for (const path of ["/app", "/app/gegevens/versies"]) {
      await visit(page, `${prefix}${path}`);
      parts.push((await page.locator("main").innerText()).replace(/\s+/g, " "));
    }
    return parts.join("\n--\n");
  } finally {
    await ctx.close();
  }
}

/** The control owner's ids, learnt from its own dashboard: its business (from the report's checkout form) and its first finding. */
export async function controlIds(browser: Browser, baseURL: string | undefined): Promise<{ business: string; finding: string | null; channel: string | null }> {
  const business = await controlBusinessId(browser, baseURL);
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  try {
    await signInAs(page, CONTROL_OWNER);
    const idOf = async (needle: string) => {
      const href = await page.locator(`a[href*='${needle}']`).first().getAttribute("href", { timeout: 2000 }).catch(() => null);
      return href ? href.split("/").pop()! : null;
    };
    return { business, finding: await idOf("/app/fouten/"), channel: await idOf("/app/vermeldingen/") };
  } finally {
    await ctx.close();
  }
}
