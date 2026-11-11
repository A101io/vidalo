/**
 * Timings of the owner pages (feature 002, B-03 / AC-7): `pnpm perf:owner`.
 *
 * Starts a LOCAL PRODUCTION build (`next start`) against the database seeded by scripts/perf/seed-history.mts, signs in as
 * each seeded owner with the mock cookie (VIDALO_MOCK=1 VIDALO_DB=pg: mock sign-in and mock engines, real Postgres), loads each
 * page 20 times per business after one warm-up load, prints p50/p95 and fails when any p95 is over 1 s.
 *
 *   pnpm --filter @vidalo/web exec next build --webpack      # first, with DATABASE_URL= (a build must not bake the root .env)
 *   DATABASE_URL=postgresql://postgres@localhost:5432/vidalo_verify pnpm tsx scripts/perf/seed-history.mts
 *   DATABASE_URL=postgresql://postgres@localhost:5432/vidalo_verify pnpm perf:owner
 *
 * The database must be on this machine (the root .env points at production). Pages of lane A (/app/account, /app/abonnement)
 * are measured, not edited.
 */
import { spawn } from "node:child_process";
import { assertLocal, PERF_OWNERS } from "./seed-history.mts";

const URL_DB = assertLocal(process.env.DATABASE_URL);
const PORT = Number(process.env.PERF_PORT ?? 3197);
const BASE = `http://localhost:${PORT}`;
const LOADS = 20;
const BUDGET_MS = 1000;
const PAGES = ["/app", "/app/voortgang", "/app/rapporten", "/app/account", "/app/abonnement"];

const keyless = Object.fromEntries(
  ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY", "SUPABASE_URL", "SUPABASE_ANON_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "PERPLEXITY_API_KEY", "SERPAPI_KEY", "GOOGLE_PLACES_API_KEY", "RESEND_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"].map((k) => [k, ""]),
);
const server = spawn("pnpm", ["--filter", "@vidalo/web", "exec", "next", "start", "--port", String(PORT)], {
  env: { ...process.env, ...keyless, VIDALO_MOCK: "1", VIDALO_DB: "pg", DATABASE_URL: URL_DB, PUBLIC_BASE_URL: BASE, VIDALO_COMING_SOON: "0", NODE_ENV: "production" },
  stdio: ["ignore", "ignore", "inherit"],
});
const stop = () => server.kill("SIGTERM");
process.on("exit", stop);

async function waitUp() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("the production server did not come up (run `next build --webpack` first)");
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)]!;

async function load(path: string, cookie: string, mustContain: string): Promise<number> {
  const t = performance.now();
  const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
  const body = await res.text();
  const ms = performance.now() - t;
  if (res.status !== 200) throw new Error(`${path}: HTTP ${res.status}${res.headers.get("location") ? ` → ${res.headers.get("location")}` : ""}`);
  // A page that answers 200 but shows another business, or an error shell, is not a timing.
  if (!body.includes(mustContain)) throw new Error(`${path}: the page does not show ${mustContain}`);
  return ms;
}

let failed = false;
try {
  await waitUp();
  console.log(`page            business     p50 ms   p95 ms   max ms   (${LOADS} loads, budget p95 < ${BUDGET_MS} ms)`);
  for (const [label, o] of Object.entries(PERF_OWNERS)) {
    const cookie = `vidalo_mock_session=${encodeURIComponent(JSON.stringify({ userId: o.userId, email: o.email }))}`;
    for (const path of PAGES) {
      await load(path, cookie, o.name); // warm-up: compiles nothing in a production build, but opens the connection and warms caches
      const ms: number[] = [];
      for (let i = 0; i < LOADS; i++) ms.push(await load(path, cookie, o.name));
      const p95 = pct(ms, 95);
      const over = p95 >= BUDGET_MS;
      failed ||= over;
      console.log(`${path.padEnd(15)} ${label.padEnd(10)} ${pct(ms, 50).toFixed(0).padStart(8)} ${p95.toFixed(0).padStart(8)} ${Math.max(...ms).toFixed(0).padStart(8)}${over ? "   FAIL" : ""}`);
    }
  }
} finally {
  stop();
}
if (failed) {
  console.error("FAIL: a page is over budget");
  process.exit(1);
}
console.log("OK: every page p95 under budget");
