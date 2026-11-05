/**
 * The launch gate (go-live J4). While VIDALO_COMING_SOON=1 the marketing
 * pages show /binnenkort instead; everything a visitor may have a link to or
 * a right to keeps working: legal pages, the cookie statement, reports,
 * sign-in and the account, unsubscribe, the facts pages, the API.
 *
 * A browser with the preview cookie (set by /api/preview after the key)
 * sees the whole site. Pure, so the edge middleware and the tests share it.
 */
export const COMING_SOON_ROUTE = "/binnenkort";
export const PREVIEW_COOKIE = "vidalo_preview";

/** Routes (Dutch, as the code names them) that the gate hides. Everything else passes. */
const GATED = ["/", "/prijzen", "/hoe-het-werkt", "/waarom", "/straks", "/vak", "/scan"] as const;

export function isGatedRoute(route: string): boolean {
  if (route === "/") return true;
  return GATED.some((g) => g !== "/" && (route === g || route.startsWith(g + "/")));
}

/** The route to render for `route`: the coming-soon page when the gate applies, else the route itself. */
export function gateRoute(route: string, state: { comingSoon: boolean; preview: boolean }): string {
  if (!state.comingSoon || state.preview) return route;
  return isGatedRoute(route) ? COMING_SOON_ROUTE : route;
}

/** What the preview token signs; change it to end every open preview at once. */
export const PREVIEW_TOKEN_LABEL = "vidalo-preview-v1";

/**
 * The preview cookie's value: HMAC-SHA256 of PREVIEW_TOKEN_LABEL under the
 * preview key, hex. Only a browser that was given the key holds it, and a new
 * key ends every preview. Web Crypto, so it runs in the edge middleware; the
 * route handlers compute the same value with node:crypto (lib/gate-state.ts).
 */
export async function previewToken(key: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(PREVIEW_TOKEN_LABEL)));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Same length and same bytes, compared without stopping at the first difference. No key, no preview. */
export function samePreviewToken(given: string | undefined, expected: string | null): boolean {
  if (!given || !expected || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
