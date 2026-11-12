import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { activeName, DEMO_OWNER, EN_OWNER, NAMES, signInAs, switcher, visit } from "./helpers-owner-area";

/**
 * Feature 002 B-04 (AC-8): the owner area is accessible. axe (WCAG 2.2 A + AA, as e2e/a11y.spec.ts) over every page of
 * AC-8 in NL and EN, mock mode, reduced motion, cookie notice dismissed; then the keyboard: the switcher, the nav and
 * "Uitloggen" are reached in order with a visible focus ring, a business can be chosen without a mouse, the switch is
 * announced, and a dot never carries meaning alone.
 *
 * Lane B owns the markup of its own pages (layout with the switcher, /app, /app/rapporten, /app/voortgang, /r/[id]).
 * Lane A's pages are tested here by URL but built by lane A (tickets A-02…A-06): until both lanes are merged their
 * tests are `test.fixme` (a feature may be missing), named with the ticket. After the merge the delivery-lead runs
 * the whole file with OWNER_A11Y_LANE_A=1 (no fixme) and routes a violation on an A page to lane A.
 */
const laneA = process.env.OWNER_A11Y_LANE_A === "1" ? test : test.fixme;
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

interface Target {
  route: string; // the Dutch route, with its query
  lane: "B" | "A";
  ticket?: string;
}
const TARGETS: Target[] = [
  { route: "/app", lane: "B" },
  { route: "/app/rapporten", lane: "B" },
  { route: "/app/voortgang", lane: "B" },
  { route: "/app/account", lane: "A", ticket: "A-02 sign-ins and Overal uitloggen" },
  { route: "/app/account/verwijderen", lane: "A", ticket: "A-05 the delete step" },
  { route: "/app/abonnement", lane: "A", ticket: "A-05 abonnement" },
  { route: "/app/abonnement/opzeggen", lane: "A", ticket: "A-05 cancel" },
  { route: "/app/abonnement/pauzeren", lane: "A", ticket: "A-05 pause" },
  { route: "/app/google", lane: "A", ticket: "A-04 disconnect" },
  { route: "/inloggen?opnieuw=1&next=/app", lane: "A", ticket: "A-03 opnieuw" },
  { route: "/auth/confirm?token_hash=x&type=email&next=/app", lane: "A", ticket: "A-02 confirm page" },
];

const EN_SLUGS: Record<string, string> = { inloggen: "login" };
/** The English URL of a Dutch route (lib/lang-paths.ts); e2e/helpers.ts `en()` would split the `next=/app` in the query. */
function enRoute(route: string): string {
  const [path = "", query = ""] = route.split("?");
  const [, first = "", ...rest] = path.split("/");
  return "/en/" + [EN_SLUGS[first] ?? first, ...rest].join("/") + (query ? `?${query}` : "");
}

const LANGS = [
  { name: "NL", owner: DEMO_OWNER, url: (r: string) => r, start: "/app" },
  { name: "EN", owner: EN_OWNER, url: enRoute, start: "/en/app" },
] as const;

for (const L of LANGS) {
  for (const t of TARGETS) {
    const run = t.lane === "A" ? laneA : test;
    run(`@a11y ${L.name} ${t.route}${t.ticket ? ` (lane A, ${t.ticket})` : ""}`, async ({ page }) => {
      test.slow(); // a sign-in and one page load
      await signInAs(page, L.owner, L.start);
      await visit(page, L.url(t.route));
      await page.locator("main, body").first().waitFor();
      // The cookie notice must not be what is measured.
      const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      const bad = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      const summary = bad.map((v) => `${v.impact} ${v.id}: ${v.help} (${v.nodes.length}×) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      expect(summary, summary.join("\n")).toEqual([]);
    });
  }
}

/** One Tab press: what has focus now, and whether it shows it (an outline or a box-shadow ring). */
async function focusNow(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const s = getComputedStyle(el);
    const ring = (s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== "none";
    return { tag: el.tagName.toLowerCase(), name: el.getAttribute("name"), text: (el.textContent ?? "").trim().slice(0, 40), href: el.getAttribute("href"), ring };
  });
}

for (const L of LANGS) {
  test(`@a11y ${L.name} keyboard: Tab reaches the switcher, its button, every nav link and the sign-out button in order, each with a focus ring`, async ({ page }) => {
    test.slow();
    await signInAs(page, L.owner, L.start);
    await visit(page, L.start);
    await page.locator("body").click({ position: { x: 1, y: 1 } }); // start from the top of the page
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const seen: NonNullable<Awaited<ReturnType<typeof focusNow>>>[] = [];
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press("Tab");
      const f = await focusNow(page);
      if (!f) continue;
      seen.push(f);
      if (f.tag === "button" && /^(Uitloggen|Log out|Sign out)$/.test(f.text)) break;
    }
    const idx = (pred: (f: (typeof seen)[number]) => boolean) => seen.findIndex(pred);
    const select = idx((f) => f.tag === "select" && f.name === "business");
    const wissel = idx((f) => f.tag === "button" && /^(Wissel|Switch)$/.test(f.text));
    const navLinks = ["/app", "/app/voortgang", "/app/rapporten", "/app/gegevens", "/app/domein", "/app/google", "/app/abonnement", "/app/account"].map((h) => idx((f) => f.tag === "a" && (f.href === h || f.href === `/en${h}`)));
    const out = idx((f) => f.tag === "button" && /^(Uitloggen|Log out|Sign out)$/.test(f.text));
    const order = [select, wissel, ...navLinks.slice(1), out]; // the first nav link ("/app") may come after the wordmark's own link to /app
    expect(order.every((i) => i >= 0), `all reached: ${JSON.stringify(seen.map((s) => s.name ?? s.href ?? s.text))}`).toBe(true);
    expect(order, "in reading order").toEqual([...order].sort((a, b) => a - b));
    expect(navLinks[0], "the Overzicht link is reached").toBeGreaterThanOrEqual(0);
    const unringed = seen.filter((f) => !f.ring).map((f) => f.name ?? f.href ?? f.text);
    expect(unringed, "every focused control shows a focus ring").toEqual([]);
  });

  test(`@a11y ${L.name} keyboard alone chooses a business, and the switch is announced`, async ({ page }) => {
    test.slow();
    const first = L.name === "NL" ? NAMES.haarlem : NAMES.enRotterdam;
    const second = L.name === "NL" ? NAMES.amsterdam : NAMES.enLeiden;
    await signInAs(page, L.owner, L.start);
    await visit(page, L.start);
    expect(await activeName(page)).toBe(first);
    await switcher(page).focus();
    // Type the option's name (type-ahead on the focused select; the arrow keys open a native popup on some systems), then Tab to
    // the button and press Enter: no mouse involved.
    await page.keyboard.type(second, { delay: 15 });
    expect(await activeName(page)).toBe(second);
    await page.keyboard.press("Tab");
    const f = await focusNow(page);
    expect(f?.text).toMatch(/^(Wissel|Switch)$/);
    await Promise.all([page.waitForURL(/gewisseld=1/), page.keyboard.press("Enter")]);
    expect(await activeName(page)).toBe(second);
    // role="status" holds the sentence, and it is polite.
    const status = page.getByRole("status").filter({ hasText: second });
    await expect(status).toBeVisible();
    await expect(status).toHaveAttribute("aria-live", "polite");
  });
}

test("@a11y /app/rapporten: every dot is aria-hidden and its row says the same in words", async ({ page }) => {
  test.slow();
  await signInAs(page, DEMO_OWNER, "/app/rapporten");
  const rows = page.locator("main ol > li");
  await expect(rows.first()).toBeVisible();
  const dots = page.locator("main ol [class*='bg-rood'], main ol [class*='bg-groen'], main ol [class*='bg-oranje'], main ol [class*='bg-grijs']");
  expect(await dots.count()).toBeGreaterThan(0);
  expect(await dots.evaluateAll((els) => els.every((e) => e.getAttribute("aria-hidden") === "true"))).toBe(true);
  // A done row names its colour in words ("Klopt", "Misleidt", "Stuurt klanten weg", "Kent je niet…"); a row without a dot says its state.
  for (const t of await rows.allInnerTexts()) expect(t).toMatch(/Klopt|Misleidt|Stuurt klanten weg|Kent je niet|Aantallen volgen|Wacht op|Wordt nu|Niet gelukt/);
});
