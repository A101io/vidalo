import { CANONICAL_HOST, REDIRECT_HOSTS } from "./canonical.js";

/**
 * The origin to send a visitor back to after Stripe Checkout, the customer
 * portal or a preview toggle. Derived from the request (Origin, else
 * Referer) so it keeps pointing at the host the visitor is on, through a
 * domain change and on the workers.dev preview, instead of a hostname baked
 * in at deploy time (playbook/STRIPE.md: Sonable's success URLs pointed at a
 * dead host for weeks). Only hosts that are ours count; anything else falls
 * back, so a forged header cannot send a paying customer elsewhere.
 */
export function isOwnHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === CANONICAL_HOST || (REDIRECT_HOSTS as readonly string[]).includes(h) || h.endsWith(".workers.dev") || h === "localhost" || h === "127.0.0.1";
}

export function safeOrigin(headers: { get(name: string): string | null }, fallback: string): string {
  for (const name of ["origin", "referer"]) {
    const value = headers.get(name);
    if (!value) continue;
    try {
      const url = new URL(value);
      if ((url.protocol === "https:" || url.protocol === "http:") && isOwnHost(url.hostname)) return url.origin;
    } catch {
      /* not a URL: ignore */
    }
  }
  return fallback.replace(/\/$/, "");
}
