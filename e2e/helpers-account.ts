import { expect, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

/**
 * Helpers for the session and account specs that run against the fake GoTrue
 * (playwright.auth.config.ts, e2e/fixtures/fake-gotrue.ts). Feature 002, lane A.
 */
export const GOTRUE = process.env.FAKE_GOTRUE_URL ?? "http://127.0.0.1:54399";

/** The demo owner in mock data (apps/web/lib/demo.ts): has a business, so /app renders. */
export const DEMO_OWNER = "eigenaar@bakkerijdevries.nl";

/** A fresh token_hash for this address, as the sign-in mail would carry it. */
export async function linkFor(request: APIRequestContext, email: string, type = "email"): Promise<string> {
  const res = await request.post(`${GOTRUE}/__test/link`, { data: { email, type } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { token_hash: string }).token_hash;
}

export async function gotrueStats(request: APIRequestContext): Promise<{
  calls: Record<string, number>;
  sessions: { id: string; revoked: boolean; refreshes: number }[];
  events: { kind: string; sessionId?: string; at: number }[];
}> {
  return (await request.get(`${GOTRUE}/__test/stats`)).json();
}

/**
 * Opens the sign-in link and finishes the sign-in. Since A-02 the link opens a
 * page with one button (ADR-0003); before, the GET itself signed in.
 */
export async function signIn(page: Page, email = DEMO_OWNER, next = "/app"): Promise<void> {
  const tokenHash = await linkFor(page.request, email);
  await page.goto(`/auth/confirm?token_hash=${tokenHash}&type=email&next=${encodeURIComponent(next)}`);
  if (!new URL(page.url()).pathname.startsWith("/auth/confirm")) return;
  await page.locator("form button[type='submit']").first().click();
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/"));
}

/** Every sb- Set-Cookie header a context receives, with the response it came on. */
export function captureAuthCookies(context: BrowserContext): { url: string; cookie: string; cacheControl: string }[] {
  const seen: { url: string; cookie: string; cacheControl: string }[] = [];
  context.on("response", async (res) => {
    try {
      const headers = await res.headersArray();
      const cacheControl = headers.find((h) => h.name.toLowerCase() === "cache-control")?.value ?? "";
      for (const h of headers) {
        if (h.name.toLowerCase() === "set-cookie" && h.value.trimStart().startsWith("sb-")) seen.push({ url: res.url(), cookie: h.value, cacheControl });
      }
    } catch {
      /* response gone */
    }
  });
  return seen;
}

export function isSignInPage(url: string): boolean {
  const p = new URL(url).pathname;
  return p === "/inloggen" || p === "/en/login";
}
