/**
 * Facts host logic.
 *
 * Preferred: `feiten.{domain}` on the owner's own domain, pointed at Vidalo with
 * one CNAME record. Fallback: `{slug}-feiten.{FACTS_HOST_SUFFIX}` (one level deep,
 * so Universal SSL's `*.vidalo.io` covers it).
 *
 * Serving: `vidalo-worker` answers on the routes in apps/worker/wrangler.jsonc
 * (`feiten.vidalo.io/*`, `*-feiten.vidalo.io/*`) and on one route per custom
 * hostname, which `ensureCustomHostname` adds next to the hostname. No `*\/*`
 * catch-all: a route beats a Custom Domain on the same hostname, so it would
 * take `vidalo.io` and `www.vidalo.io` away from `vidalo-web`.
 *
 * Cloudflare for SaaS (custom hostnames) is used when CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ZONE_ID are set; otherwise every call is a logged no-op so the
 * whole flow runs in VIDALO_MOCK=1 without keys. In mock mode DNS lookups are
 * skipped and report success (set VIDALO_MOCK_DNS_OK=0 to force a real lookup).
 */
import { CANONICAL_HOST } from "../shared/canonical.js";
import { resolveCname } from "node:dns/promises";
import type { Business } from "../types.js";
import { OWN_BUSINESS } from "../shared/own.js";
import { FALLBACK_LABEL_END, defaultFactsHost } from "./render.js";

export { defaultFactsHost };

export function factsHostSuffix(): string {
  return process.env.FACTS_HOST_SUFFIX || "vidalo.io";
}

/** The CNAME target an owner must point `feiten.{domain}` at. */
export function cnameTarget(): string {
  return process.env.FACTS_CNAME_TARGET || `feiten.${factsHostSuffix()}`;
}

/** Strip protocol/path/www from a stored domain. */
export function bareDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[/:?#].*$/, "");
}

/** `feiten.{domain}` when the business has a domain, else the fallback host. */
export function preferredFactsHost(business: Pick<Business, "slug" | "domain">): string {
  if (business.domain) return `feiten.${bareDomain(business.domain)}`;
  return defaultFactsHost(business);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The label before `-feiten` in a fallback host `{slug}-feiten.{suffix}`, or
 * null when `host` is not exactly one such name: one DNS label (lowercase
 * letters, digits, hyphens, at most 63) directly under the suffix. So
 * `x-feiten.vidalo.io.evil.com`, `a.b-feiten.vidalo.io`, `feiten.vidalo.io`,
 * `www.vidalo.io` and customer domains are not.
 */
export function fallbackSlug(host: string): string | null {
  const inner = 63 - FALLBACK_LABEL_END.length - 2;
  const re = new RegExp(`^([a-z0-9](?:[a-z0-9-]{0,${inner}}[a-z0-9])?)${escapeRe(FALLBACK_LABEL_END)}\\.${escapeRe(factsHostSuffix().toLowerCase())}$`);
  return re.exec(host.toLowerCase())?.[1] ?? null;
}

/** True when the host has the shape of one of our fallback hosts (no CNAME to show the owner). */
export function isFallbackHost(host: string): boolean {
  return fallbackSlug(host) !== null;
}

/** `host` is the suffix itself or any name under it: ours, never claimable by a CNAME. */
export function isOurName(host: string): boolean {
  const h = host.toLowerCase();
  const suffix = factsHostSuffix().toLowerCase();
  return h === suffix || h.endsWith(`.${suffix}`);
}

/**
 * True when `host` is ours to give this business without a DNS check: its own
 * fallback host, or, for Vidalo itself, `feiten.{suffix}`. Another business's
 * fallback host is not.
 */
export function isOwnFactsHost(host: string, business: Pick<Business, "slug">): boolean {
  const h = host.toLowerCase();
  if (h === defaultFactsHost(business)) return true;
  return business.slug === OWN_BUSINESS.slug && h === `feiten.${factsHostSuffix()}`;
}

export interface CnameCheck {
  host: string;
  ok: boolean;
  found: string[];
  expected: string;
  error?: string;
}

/**
 * Verify that `host` has a CNAME pointing at `expectedTarget` (or at any name
 * that itself resolves to the target, one hop).
 */
export async function verifyCname(host: string, expectedTarget = cnameTarget()): Promise<CnameCheck> {
  const expected = expectedTarget.toLowerCase().replace(/\.$/, "");
  if (process.env.VIDALO_MOCK === "1" && process.env.VIDALO_MOCK_DNS_OK !== "0") {
    console.log(JSON.stringify({ msg: "dns.verify.mock", host, expected }));
    return { host, ok: true, found: [expected], expected };
  }
  try {
    const found = (await resolveCname(host)).map((c) => c.toLowerCase().replace(/\.$/, ""));
    if (found.includes(expected)) return { host, ok: true, found, expected };
    // one hop: the CNAME may point at a name that is itself a CNAME to our target
    for (const f of found) {
      try {
        const hop = (await resolveCname(f)).map((c) => c.toLowerCase().replace(/\.$/, ""));
        if (hop.includes(expected)) return { host, ok: true, found: [...found, ...hop], expected };
      } catch {
        /* ignore */
      }
    }
    return { host, ok: false, found, expected };
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return { host, ok: false, found: [], expected, error: e.code ?? e.message };
  }
}

// ---------------------------------------------------------------------------
// Cloudflare for SaaS custom hostnames
// ---------------------------------------------------------------------------

export interface CustomHostnameStatus {
  id: string | null;
  hostname: string;
  status: "active" | "pending" | "moved" | "deleted" | "unknown" | "mock";
  sslStatus: string | null;
  raw?: unknown;
}

function cfConfig(): { token: string; zoneId: string } | null {
  const token = process.env.CLOUDFLARE_API_TOKEN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!token || !zoneId) return null;
  return { token, zoneId };
}

async function cf<T>(path: string, init: RequestInit = {}): Promise<T> {
  const cfg = cfConfig();
  if (!cfg) throw new Error("cloudflare not configured");
  const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${cfg.zoneId}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${cfg.token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json()) as { success: boolean; result: T; errors?: unknown[] };
  if (!res.ok || !body.success) {
    throw new Error(`cloudflare ${path} failed: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
  }
  return body.result;
}

interface CfHostname {
  id: string;
  hostname: string;
  status: string;
  ssl?: { status?: string };
}

/** Create (or fetch existing) custom hostname. No-op with a log when not configured. */
export async function ensureCustomHostname(hostname: string): Promise<CustomHostnameStatus> {
  if (!cfConfig()) {
    console.log(JSON.stringify({ msg: "cloudflare.custom_hostname.skip", hostname, reason: "no CLOUDFLARE_API_TOKEN/ZONE_ID" }));
    return { id: null, hostname, status: "mock", sslStatus: null };
  }
  await ensureWorkerRoute(hostname);
  const existing = await cf<CfHostname[]>(`/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
  const found = existing[0];
  if (found) return toStatus(found);
  const created = await cf<CfHostname>(`/custom_hostnames`, {
    method: "POST",
    body: JSON.stringify({ hostname, ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } } }),
  });
  return toStatus(created);
}

interface CfRoute {
  id: string;
  pattern: string;
  script?: string;
}

/** The Worker that serves facts pages (apps/worker/wrangler.jsonc `name`). */
function factsWorkerName(): string {
  return process.env.FACTS_WORKER_NAME || "vidalo-worker";
}

/**
 * Worker route `{hostname}/*` → vidalo-worker on our zone, so a custom
 * hostname's traffic reaches the facts handler (Cloudflare for SaaS evaluates
 * the SaaS zone's routes by the customer's hostname). Idempotent.
 */
async function ensureWorkerRoute(hostname: string): Promise<void> {
  // Never a wildcard and never one of our own names: a route there would take
  // vidalo.io or www.vidalo.io away from vidalo-web.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(hostname) || isOurName(hostname)) throw new Error(`refusing a worker route for ${hostname}`);
  const pattern = `${hostname}/*`;
  const routes = await cf<CfRoute[]>(`/workers/routes`);
  if (routes.some((r) => r.pattern === pattern)) return;
  await cf(`/workers/routes`, { method: "POST", body: JSON.stringify({ pattern, script: factsWorkerName() }) });
}

export async function customHostnameStatus(hostname: string): Promise<CustomHostnameStatus> {
  if (!cfConfig()) {
    return { id: null, hostname, status: "mock", sslStatus: null };
  }
  const existing = await cf<CfHostname[]>(`/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
  const found = existing[0];
  if (!found) return { id: null, hostname, status: "unknown", sslStatus: null };
  return toStatus(found);
}

export async function deleteCustomHostname(hostname: string): Promise<void> {
  // Never one of our own names, never a pattern (feature 002, SEC-48): only an owner's own facts host.
  const h = hostname.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h) || isOurName(h) || h === CANONICAL_HOST || h.endsWith(`.${CANONICAL_HOST}`)) throw new Error(`refusing to delete the hostname ${hostname}`);
  if (!cfConfig()) {
    console.log(JSON.stringify({ msg: "cloudflare.custom_hostname.delete.skip", hostname }));
    return;
  }
  const route = (await cf<CfRoute[]>(`/workers/routes`)).find((r) => r.pattern === `${hostname}/*`);
  if (route) await cf(`/workers/routes/${route.id}`, { method: "DELETE" });
  const existing = await cf<CfHostname[]>(`/custom_hostnames?hostname=${encodeURIComponent(hostname)}`);
  const found = existing[0];
  if (!found) return;
  await cf(`/custom_hostnames/${found.id}`, { method: "DELETE" });
}

function toStatus(h: CfHostname): CustomHostnameStatus {
  const status = (["active", "pending", "moved", "deleted"] as const).find((s) => s === h.status) ?? "unknown";
  return { id: h.id, hostname: h.hostname, status, sslStatus: h.ssl?.status ?? null, raw: h };
}

/**
 * Full host verification step used by the cron poll:
 * the business's own fallback host is always verified; any other name under
 * our suffix never is; custom hosts need a CNAME and (when configured) an
 * active Cloudflare custom hostname.
 */
export async function checkFactsHost(host: string, business: Pick<Business, "slug">): Promise<{ verified: boolean; cname: CnameCheck | null; cloudflare: CustomHostnameStatus | null }> {
  if (isOwnFactsHost(host, business)) return { verified: true, cname: null, cloudflare: null };
  if (isOurName(host)) return { verified: false, cname: null, cloudflare: null };
  const cname = await verifyCname(host);
  if (!cname.ok) return { verified: false, cname, cloudflare: null };
  const cloudflare = await ensureCustomHostname(host);
  const verified = cloudflare.status === "active" || cloudflare.status === "mock";
  return { verified, cname, cloudflare };
}
