import { expect, test } from "@playwright/test";

/**
 * The sign-in link may only continue to a path on this site (core/shared/safe-next.ts).
 * Since feature 002 (ADR-0003) the link opens /auth/confirm, a page with one button whose
 * form carries a safe `next`; /auth/callback sends the same query there, on this host.
 */
const BAD = ["//evil.example/x", "/\\evil.example", "https://evil.example"];

for (const next of BAD) {
  test(`/auth/confirm puts a safe next in its form for next=${next}`, async ({ request }) => {
    const res = await request.get(`/auth/confirm?next=${encodeURIComponent(next)}`, { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    const html = await res.text();
    // The form carries the safe value; the raw query only echoes in Next's page data, never as a target.
    expect(html).toMatch(/name="next" value="\/app"/);
    expect(html).not.toMatch(/name="next" value="[^"]*evil/);
  });

  test(`/auth/callback stays on this site for next=${next}`, async ({ request, baseURL }) => {
    const res = await request.get(`/auth/callback?next=${encodeURIComponent(next)}`, { maxRedirects: 0 });
    expect(res.status()).toBe(303);
    const location = new URL(res.headers()["location"]!, baseURL);
    expect(location.host).toBe(new URL(baseURL!).host);
    expect(location.pathname).toBe("/auth/confirm");
  });
}

test("a same-site next is kept", async ({ request }) => {
  const html = await (await request.get(`/auth/confirm?next=${encodeURIComponent("/app/account")}`)).text();
  expect(html).toMatch(/name="next" value="\/app\/account"/);
});

test("the confirm page uses nothing up and is never stored or indexed", async ({ request }) => {
  const res = await request.get(`/auth/confirm?token_hash=pkce_abcdef0123456789&type=email&next=%2Fapp`);
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h["cache-control"]).toMatch(/no-store/);
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["x-robots-tag"]).toMatch(/noindex/);
  expect(res.headersArray().filter((x) => x.name.toLowerCase() === "set-cookie")).toHaveLength(0);
  const html = await res.text();
  expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);
  expect(html).toContain('name="token_hash" value="pkce_abcdef0123456789"');
});

test("an English next renders the page in English", async ({ request }) => {
  const html = await (await request.get(`/auth/confirm?next=${encodeURIComponent("/en/app")}`)).text();
  expect(html).toContain("Sign in to Vidalo");
});

// AC-4(c) route table (feature 002, A-03): every bad `next` given to the sign-in form ends on this site.
const TABLE = ["//evil.example", "/\\evil.example", "/%2F%2Fevil.example", "https://evil.example", "javascript:alert(1)", "/.//evil.example", "/app/..//evil.example", "/%2e%2e//evil.example"];
test("the sign-in form never continues off the site (mock sign-in)", async ({ page, baseURL }) => {
  test.setTimeout(120_000);
  for (const next of TABLE) {
    await page.context().clearCookies();
    await page.goto(`/inloggen?next=${encodeURIComponent(next)}`);
    await page.locator("input[name='email']").fill("eigenaar@bakkerijdevries.nl");
    await page.locator("form button[type='submit']").first().click();
    await page.waitForURL((u) => u.pathname !== "/inloggen" || u.search.includes("fout="));
    expect(new URL(page.url()).host, next).toBe(new URL(baseURL!).host);
    expect(new URL(page.url()).pathname, next).toBe("/app");
  }
});
