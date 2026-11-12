import { expect, test, type Page } from "@playwright/test";
import { DEMO_OWNER, EN_OWNER, signInAs, visit } from "./helpers-owner-area";

/**
 * Feature 002 QA (phase 4), AC-8: the keyboard-only pass against docs/process/checklists/a11y.md over every page AC-8
 * names, NL and EN, mock mode. Per page, Tab from the top until focus comes back round, and check:
 *  - every visible control (a, button, input, select, textarea, [tabindex>=0]) is reached at least once (reachable);
 *    a radio group is one Tab stop, and the arrow key moves within it;
 *  - focus comes back to the start and never sticks on one element (not trapped);
 *  - each focused element shows a ring (outline or box-shadow) and is not covered by a fixed or sticky element (SC 2.4.11);
 *  - each focused control has an accessible name;
 *  - at 375 px the page has no horizontal scroll (reflow).
 * Touch-target size and contrast are measured by axe in owner-a11y.spec.ts and are not repeated here.
 *
 *   E2E_SERVER=start npx playwright test --project=desktop e2e/owner-keyboard-qa.spec.ts
 */
const PAGES = [
  "/app",
  "/app/rapporten",
  "/app/voortgang",
  "/app/account",
  "/app/account/verwijderen",
  "/app/abonnement",
  "/app/abonnement/opzeggen",
  "/app/abonnement/pauzeren",
  "/app/google",
  "/inloggen?opnieuw=1&next=/app",
  "/auth/confirm?token_hash=x&type=email&next=/app",
];
const EN_SLUGS: Record<string, string> = { inloggen: "login" };
function enRoute(route: string): string {
  const [path = "", query = ""] = route.split("?");
  const [, first = "", ...rest] = path.split("/");
  return "/en/" + [EN_SLUGS[first] ?? first, ...rest].join("/") + (query ? `?${query}` : "");
}
const LANGS = [
  { name: "NL", owner: DEMO_OWNER, url: (r: string) => r, start: "/app" },
  { name: "EN", owner: EN_OWNER, url: enRoute, start: "/en/app" },
] as const;

interface Stop {
  key: string;
  radio: string | null;
  ring: boolean;
  covered: string | null;
  name: string;
}

async function tabOnce(page: Page): Promise<Stop | null> {
  await page.keyboard.press("Tab");
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const path = (n: Element): string => {
      const parts: string[] = [];
      for (let e: Element | null = n; e && e !== document.body; e = e.parentElement) parts.unshift(`${e.tagName.toLowerCase()}:${[...(e.parentElement?.children ?? [])].indexOf(e)}`);
      return parts.join("/");
    };
    const s = getComputedStyle(el);
    const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
    const r = el.getBoundingClientRect();
    let covered: string | null = null;
    if (r.width > 0 && r.height > 0) {
      const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        for (let e: Element | null = hit; e; e = e.parentElement) {
          const pos = getComputedStyle(e).position;
          if (pos === "fixed" || pos === "sticky") {
            covered = `${e.tagName.toLowerCase()}.${(e as HTMLElement).className}`.slice(0, 80);
            break;
          }
        }
      }
    }
    const label =
      el.getAttribute("aria-label") ||
      (el.getAttribute("aria-labelledby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim() ||
      ((el as HTMLInputElement).labels?.[0]?.textContent ?? "").trim() ||
      (el.textContent ?? "").trim() ||
      el.getAttribute("title") ||
      (el as HTMLInputElement).value ||
      el.getAttribute("placeholder") ||
      "";
    const radio = el instanceof HTMLInputElement && el.type === "radio" ? el.name : null;
    return { key: path(el), radio, ring, covered, name: label.slice(0, 60) };
  });
}

for (const L of LANGS) {
  for (const route of PAGES) {
    test(`@a11y-keyboard ${L.name} ${route}`, async ({ page }) => {
      test.slow();
      await signInAs(page, L.owner, L.start);
      await visit(page, L.url(route));
      await page.locator("main, body").first().waitFor();
      // Every visible control the page offers.
      const controls = await page.evaluate(() => {
        const path = (n: Element): string => {
          const parts: string[] = [];
          for (let e: Element | null = n; e && e !== document.body; e = e.parentElement) parts.unshift(`${e.tagName.toLowerCase()}:${[...(e.parentElement?.children ?? [])].indexOf(e)}`);
          return parts.join("/");
        };
        return [...document.querySelectorAll<HTMLElement>("a[href], button, input:not([type=hidden]), select, textarea, [tabindex]")]
          .filter((e) => !(e as HTMLButtonElement).disabled && e.tabIndex >= 0 && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== "hidden")
          .map((e) => ({ key: path(e), radio: e instanceof HTMLInputElement && e.type === "radio" ? e.name : null, what: `${e.tagName.toLowerCase()} "${(e.textContent || (e as HTMLInputElement).name || "").trim().slice(0, 30)}"` }));
      });
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await page.mouse.click(1, 1); // focus starts at the top of the document
      const stops: Stop[] = [];
      let first: string | null = null;
      for (let i = 0; i < controls.length + 15; i++) {
        const s = await tabOnce(page);
        if (!s) {
          if (stops.length) break; // focus left the document: the cycle is complete
          continue;
        }
        if (s.key === first) break;
        first ??= s.key;
        stops.push(s);
      }
      const reached = new Set(stops.map((s) => s.key));
      // A radio group is one Tab stop; its other options are reached with the arrow keys (checked below).
      const groups = new Set(stops.map((s) => s.radio).filter(Boolean));
      const missed = controls.filter((c) => !reached.has(c.key) && !(c.radio && groups.has(c.radio))).map((c) => c.what);
      expect(missed, `not reachable by Tab on ${route}`).toEqual([]);
      expect(stops.length, "focus is not trapped on one element").toBeGreaterThan(Math.min(1, controls.length - 1));
      expect(stops.filter((s) => !s.ring).map((s) => s.name || s.key), "focused without a visible ring").toEqual([]);
      expect(stops.filter((s) => s.covered).map((s) => `${s.name} under ${s.covered}`), "focused element hidden by a fixed element").toEqual([]);
      expect(stops.filter((s) => !s.name).map((s) => s.key), "focusable without an accessible name").toEqual([]);
      for (const g of groups) {
        const radios = page.locator(`input[type=radio][name="${g}"]`);
        if ((await radios.count()) < 2) continue;
        await radios.first().focus();
        await page.keyboard.press("ArrowDown");
        expect(await radios.nth(1).isChecked(), `arrow key moves within the radio group ${g}`).toBe(true);
      }
      // Reflow at phone width.
      await page.setViewportSize({ width: 375, height: 812 });
      await page.reload();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "horizontal scroll at 375 px").toBeLessThanOrEqual(0);
    });
  }
}
