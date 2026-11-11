import { defineConfig, devices } from "@playwright/test";

/**
 * Session tests against a fake Supabase Auth (e2e/fixtures/fake-gotrue.ts), feature 002 lane A.
 *
 *   pnpm e2e:auth
 *
 * The web app runs with SUPABASE_URL pointing at the fake (5-second access tokens, refresh-token
 * reuse detection that revokes) and no DATABASE_URL, so business data is the in-memory demo and
 * nothing reaches the hosted project, which is production (F-003). Specs that need this server
 * check E2E_AUTH and skip under the default config.
 */
process.env.E2E_AUTH = "1";

const port = Number(process.env.E2E_AUTH_PORT ?? 3102);
const gotruePort = Number(process.env.FAKE_GOTRUE_PORT ?? 54399);
const baseURL = `http://localhost:${port}`;
process.env.FAKE_GOTRUE_URL = `http://127.0.0.1:${gotruePort}`;

export default defineConfig({
  testDir: "e2e",
  testMatch: ["auth-session.spec.ts", "auth-link.spec.ts"],
  timeout: 90_000,
  expect: { timeout: 10_000 },
  // One fake GoTrue for every test, and tests that wait for token expiry: one at a time.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  outputDir: "out/playwright-auth-results",
  use: { baseURL, trace: "retain-on-failure", locale: "nl-NL", ...devices["Desktop Chrome"] },
  webServer: [
    {
      command: "pnpm exec tsx e2e/fixtures/fake-gotrue.ts",
      url: `http://127.0.0.1:${gotruePort}/__test/health`,
      reuseExistingServer: false,
      timeout: 30_000,
      env: { FAKE_GOTRUE_PORT: String(gotruePort) },
    },
    {
      command: `pnpm --filter @vidalo/web exec next dev --webpack --port ${port}`,
      url: `${baseURL}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000,
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
  ],
});
