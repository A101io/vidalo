import { defineConfig, devices } from "@playwright/test";

/**
 * Feature 002 QA, AC-3(a): the auth cookies of the PRODUCTION build (`next build --webpack` in apps/web/.next,
 * built with DATABASE_URL= empty) read over https, with the fake GoTrue as Supabase.
 *
 *   npx playwright test -c playwright.https.config.ts
 *
 * `next start` on :3103 behind e2e/fixtures/tls-proxy.ts on https://localhost:3443. Nothing reaches the hosted
 * project, Stripe or Cloudflare.
 */
process.env.E2E_HTTPS = "1";
const gotruePort = Number(process.env.FAKE_GOTRUE_PORT ?? 54398);
process.env.FAKE_GOTRUE_URL = `http://127.0.0.1:${gotruePort}`;
const baseURL = "https://localhost:3443";

export default defineConfig({
  testDir: "e2e",
  testMatch: ["auth-cookie-https.spec.ts"],
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "out/playwright-https-results",
  use: { baseURL, ignoreHTTPSErrors: true, locale: "nl-NL", ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: "pnpm exec tsx e2e/fixtures/fake-gotrue.ts",
      url: `http://127.0.0.1:${gotruePort}/__test/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FAKE_GOTRUE_PORT: String(gotruePort) },
    },
    {
      command: "pnpm --filter @vidalo/web exec next start --port 3103",
      url: "http://127.0.0.1:3103/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        VIDALO_MOCK: "1",
        PUBLIC_BASE_URL: baseURL,
        SUPABASE_URL: `http://127.0.0.1:${gotruePort}`,
        SUPABASE_ANON_KEY: "fake-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "",
        VIDALO_AUTH_SECRET: "e2e-auth-secret",
        DATABASE_URL: "",
        VIDALO_DB: "",
        VIDALO_COMING_SOON: "0",
        TURNSTILE_SITE_KEY: "",
        TURNSTILE_SECRET_KEY: "",
        OPENAI_API_KEY: "",
        GEMINI_API_KEY: "",
        PERPLEXITY_API_KEY: "",
        SERPAPI_KEY: "",
        GOOGLE_PLACES_API_KEY: "",
        RESEND_API_KEY: "",
        STRIPE_SECRET_KEY: "",
        STRIPE_WEBHOOK_SECRET: "",
        GA4_MEASUREMENT_ID: "",
      },
    },
    {
      command: "pnpm exec tsx e2e/fixtures/tls-proxy.ts",
      url: "http://127.0.0.1:3444/",
      reuseExistingServer: false,
      timeout: 30_000,
      env: { TLS_PROXY_PORT: "3443", TLS_PROXY_TARGET: "http://127.0.0.1:3103" },
    },
  ],
});
