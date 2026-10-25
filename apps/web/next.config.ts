import type { NextConfig } from "next";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The README says `cp .env.example .env` at the repo root, but Next only reads
 * env files from this folder, so a root .env was silently ignored and every
 * sign-in fell back to the mock session. Load the root file first; a value
 * already in the environment (CI, a Worker, apps/web/.env) always wins.
 */
for (const file of [".env", ".env.local"]) {
  const p = join(__dirname, "..", "..", file);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    const key = m?.[1];
    const raw = m?.[2];
    if (!key || raw === undefined || line.trimStart().startsWith("#")) continue;
    const value = raw.replace(/^(['"])(.*)\1$/, "$2").replace(/\s+#.*$/, "");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

/**
 * Security headers on every response (baseline D7). The CSP is production
 * only: the dev server needs eval for hot reload. 'unsafe-inline' for
 * scripts stays until Next's inline bootstrap gets a nonce; everything else
 * is locked to this origin, Supabase (auth) and the two places a form or
 * redirect may go: Stripe Checkout and Google sign-in.
 */
const supabase = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL).origin : "https://*.supabase.co";
const csp = [
  "default-src 'self'",
  // challenges.cloudflare.com: the Turnstile bot check on the scan and sign-in forms (lib/turnstile.ts).
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "frame-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabase}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self' https://checkout.stripe.com https://accounts.google.com",
  // Only on https: on an http origin (a local production build) it rewrites
  // the form's own http URL to https, which is then not 'self', and the scan
  // form silently stops submitting.
  ...((process.env.PUBLIC_BASE_URL ?? "").startsWith("https://") ? ["upgrade-insecure-requests"] : []),
].join("; ");
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.stripe.com\")" },
  ...(process.env.NODE_ENV === "production" ? [{ key: "Content-Security-Policy", value: csp }] : []),
];

const nextConfig: NextConfig = {
  transpilePackages: ["@vidalo/core"],
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
  serverExternalPackages: ["postgres"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Next.js 16 builds with Turbopack by default, but Turbopack cannot map the
  // "./x.js" imports in packages/core to their .ts files (81 "Module not found"
  // on 22 Oct 2026), so dev and build pass --webpack (package.json).
  webpack: (config) => {
    // packages/core uses Node-ESM style "./x.js" imports that resolve to .ts files.
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"], ".mjs": [".mts", ".mjs"] };
    return config;
  },
};

export default nextConfig;
