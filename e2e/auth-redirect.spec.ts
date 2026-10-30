import { expect, test } from "@playwright/test";

/**
 * The sign-in link may only continue to a path on this site
 * (apps/web/lib/auth-confirm.ts, safeNext). "//host" and "/\host" would
 * leave the site, so both routes fall back to /app.
 */
for (const route of ["/auth/confirm", "/auth/callback"]) {
  for (const next of ["//evil.example/x", "/\\evil.example", "https://evil.example"]) {
    test(`${route} refuses next=${next}`, async ({ request }) => {
      const res = await request.get(`${route}?next=${encodeURIComponent(next)}`, { maxRedirects: 0 });
      const location = res.headers()["location"] ?? "";
      expect(res.status()).toBeGreaterThanOrEqual(300);
      expect(new URL(location).hostname).not.toContain("evil.example");
      expect(location).not.toContain("evil.example");
    });
  }
}

test("a same-site next is kept", async ({ request }) => {
  const res = await request.get(`/auth/confirm?next=${encodeURIComponent("/app/account")}`, { maxRedirects: 0 });
  expect(res.headers()["location"]).toMatch(/\/app\/account$/);
});
