import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against the real web app (apps/web), in the shape of the
 * A101 kit's pack. Three modes, one config:
 *
 *   pnpm e2e           mock mode: no keys, in-memory data, mock checkout
 *   pnpm e2e:gate      the same app with the launch gate on (VIDALO_COMING_SOON=1)
 *   pnpm e2e:stripe    a real Stripe test-mode checkout; needs the Stripe lines
 *                      in the root .env and `stripe listen` (docs/setup/stripe-and-resend.md)
 *
 * The server runs on :3100 so it never collides with a dev server on :3000,
 * and every key is set explicitly, so a key in a local .env cannot make the
 * suite spend money or send mail.
 */
const mode = process.env.E2E_MODE === "gate" ? "gate" : process.env.E2E_MODE === "stripe" ? "stripe" : "mock";
const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${port}`;

const keyless = {
  VIDALO_MOCK: "1",
  VIDALO_DB: "",
  DATABASE_URL: "",
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  OPENAI_API_KEY: "",
  GEMINI_API_KEY: "",
  PERPLEXITY_API_KEY: "",
  SERPAPI_KEY: "",
  GOOGLE_PLACES_API_KEY: "",
  RESEND_API_KEY: "",
  STRIPE_SECRET_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
};

const serverEnv: Record<string, string> = {
  ...keyless,
  PUBLIC_BASE_URL: baseURL,
  VIDALO_COMING_SOON: mode === "gate" ? "1" : "0",
  VIDALO_PREVIEW_BUTTON: mode === "gate" ? "1" : "0",
  VIDALO_PREVIEW_KEY: mode === "gate" ? "e2e-preview-key" : "",
};
if (mode === "stripe") {
  // Stripe from the environment (the root .env, loaded by the e2e:stripe script); everything else stays mock.
  for (const k of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_SETUP", "STRIPE_PRICE_MONITOR", "STRIPE_TAX_RATE_ID", "STRIPE_PORTAL_CONFIGURATION"]) {
    serverEnv[k] = process.env[k] ?? "";
  }
}

export default defineConfig({
  testDir: "e2e",
  timeout: mode === "stripe" ? 120_000 : 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: mode !== "stripe",
  workers: mode === "stripe" ? 1 : undefined,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "out/playwright-report" }]],
  outputDir: "out/playwright-results",
  grep: mode === "gate" ? /@gate/ : mode === "stripe" ? /@stripe/ : undefined,
  grepInvert: mode === "mock" ? /@gate|@stripe/ : undefined,
  use: { baseURL, trace: "retain-on-failure", locale: "nl-NL" },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm --filter @vidalo/web exec next dev --port ${port}`,
        url: `${baseURL}/api/health`,
        reuseExistingServer: false,
        timeout: 180_000,
        env: serverEnv,
      },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] }, grep: /@mobile/ },
  ],
});
