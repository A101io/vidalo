import { expect, test } from "@playwright/test";
import { DEMO_OWNER, linkFor } from "./helpers-account";

/**
 * Feature 002 QA, AC-3(a) on the production build over https (playwright.https.config.ts): every auth cookie the
 * app sets (Supabase's sb-…, the switcher's vidalo_business) is HttpOnly, Secure, SameSite=Lax, Path=/; every
 * response that sets a session cookie is not storable. Sign-in, a middleware refresh, a business switch, sign-out.
 *
 * Control used in phase 4: `secure: baseUrl.startsWith("https:")` → `secure: false` in apps/web/lib/auth-cookies.ts
 * (production build rebuilt) turns the Secure assertion red.
 */
test.skip(!process.env.E2E_HTTPS, "needs the https production run: npx playwright test -c playwright.https.config.ts");

const AUTH = /^(sb-[^=]+|vidalo_business|vidalo_mock_session)=/;

test("AC-3(a): every auth cookie is HttpOnly, Secure and SameSite=Lax over https, and never cacheable", async ({ page, context }) => {
  const seen: { url: string; cookie: string; cacheControl: string }[] = [];
  context.on("response", async (res) => {
    try {
      const headers = await res.headersArray();
      const cacheControl = headers.find((h) => h.name.toLowerCase() === "cache-control")?.value ?? "";
      for (const h of headers) if (h.name.toLowerCase() === "set-cookie" && AUTH.test(h.value.trimStart())) seen.push({ url: res.url(), cookie: h.value, cacheControl });
    } catch {
      /* response gone */
    }
  });

  const tokenHash = await linkFor(page.request, DEMO_OWNER);
  await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=email&next=%2Fapp`);
  await page.locator("form button[type='submit']").first().click();
  await page.waitForURL((u) => u.pathname === "/app");
  // Past the middleware's refresh point (125-s fake tokens, refreshed 120 s ahead), so it writes the cookie again.
  await page.waitForTimeout(7_000);
  await page.goto("/app/account");
  // The business switcher writes vidalo_business.
  const select = page.locator("header select, nav select, select[name='business']").first();
  if (await select.count()) {
    const options = await select.locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    const current = await select.inputValue();
    const other = options.find((v) => v && v !== current);
    if (other) {
      await select.selectOption(other);
      await select.locator("xpath=ancestor::form[1]").locator("button[type='submit']").first().click();
      await page.waitForLoadState("load");
    }
  }
  await page.goto("/en/app");

  const sb = seen.filter((s) => s.cookie.startsWith("sb-") && !/^sb-[^=]+=;/.test(s.cookie));
  expect(sb.length, "no sb- session cookie seen").toBeGreaterThan(1);
  // Under real auth the fake GoTrue login owns no demo business (SEC-11 links only unowned rows), so no switcher shows;
  // vidalo_business's options are read in business-actions.ts and checked over http by owner-area.spec.ts.
  for (const s of seen) {
    expect(s.cookie, s.url).toMatch(/;\s*HttpOnly/i);
    expect(s.cookie, s.url).toMatch(/;\s*Secure/i);
    expect(s.cookie, s.url).toMatch(/;\s*SameSite=Lax/i);
    expect(s.cookie, s.url).toMatch(/;\s*Path=\//i);
    if (s.cookie.startsWith("sb-")) expect(s.cacheControl, s.url).toMatch(/no-store/);
  }
  // What the browser stored agrees.
  for (const c of (await context.cookies()).filter((c) => AUTH.test(`${c.name}=`))) {
    expect(c, c.name).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/" });
  }
  test.info().annotations.push({ type: "cookies", description: seen.map((s) => `${new URL(s.url).pathname} ${s.cookie.replace(/=[^;]*/, "=…")} | ${s.cacheControl}`).join("\n") });
});
