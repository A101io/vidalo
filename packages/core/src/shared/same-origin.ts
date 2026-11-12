/**
 * The Origin check for route handlers that change something (feature 002, ADR-0003, SEC-35).
 * Server actions carry Next's own check; route handlers do not. The own hosts are an exact list:
 * never "ends with vidalo.io", because facts hosts (*.feiten.vidalo.io, owners' own domains) serve
 * pages an owner controls.
 */
import { CANONICAL_HOST, REDIRECT_HOSTS } from "./canonical.js";

/** The workers.dev addresses a deploy is checked on (apps/web/wrangler.jsonc). */
const WORKER_HOSTS = ["vidalo-web-staging.julian-devriend.workers.dev", "vidalo-web-preview.julian-devriend.workers.dev"];

/** True for an origin ("https://host[:port]") this site answers on. */
export function isOwnOrigin(origin: string, baseUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.origin === "null") return false;
  let base: URL | null = null;
  try {
    base = new URL(baseUrl);
  } catch {
    base = null;
  }
  if (base && u.origin === base.origin) return true;
  if (u.protocol !== "https:" || u.port !== "") return false;
  const host = u.hostname.toLowerCase();
  return host === CANONICAL_HOST || (REDIRECT_HOSTS as readonly string[]).includes(host) || WORKER_HOSTS.includes(host);
}

/**
 * null when the request comes from this site (an own Origin, or no Origin and
 * Sec-Fetch-Site: same-origin); otherwise a 403 that changes nothing.
 */
export function refuseCrossSite(req: Pick<Request, "headers">, baseUrl: string): Response | null {
  const origin = req.headers.get("origin");
  if (origin !== null ? isOwnOrigin(origin, baseUrl) : req.headers.get("sec-fetch-site") === "same-origin") return null;
  return new Response(JSON.stringify({ error: "cross_site" }), { status: 403, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
