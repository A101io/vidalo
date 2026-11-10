/**
 * One address for the website. vidalo.ai is the domain since 6 Nov 2026
 * (before that vidalo.io, registered 14 Oct 2026; vidalo.nl and vidalo.com are
 * held by others). www.vidalo.ai, vidalo.io and www.vidalo.io are bound to the
 * same web Worker and answer with a permanent redirect to the same path on
 * vidalo.ai, so search engines and AI crawlers see one site. Mail and the
 * facts-page hosts (*.feiten.vidalo.io) stay on vidalo.io.
 *
 * Only GET and HEAD are redirected. A POST to the old host (the Stripe webhook
 * registered on vidalo.io, the support mailbox relay) is served where it
 * lands: a 301 would turn it into a GET, and Stripe does not follow redirects.
 *
 * workers.dev and localhost are left alone: they are how a deploy is checked
 * and how the app runs in development, and must keep answering themselves.
 */
export const CANONICAL_HOST = "vidalo.ai";

/** The hosts that redirect to CANONICAL_HOST. Each one is a custom domain in apps/web/wrangler.jsonc. */
export const REDIRECT_HOSTS = ["www.vidalo.ai", "vidalo.io", "www.vidalo.io"] as const;

/** The redirect target for a request URL, or null when it is already on the right host. */
export function canonicalRedirect(requestUrl: string, method: string, canonicalHost: string = CANONICAL_HOST): string | null {
  if (method !== "GET" && method !== "HEAD") return null;
  const url = new URL(requestUrl);
  const host = url.hostname.toLowerCase();
  if (host === canonicalHost) return null;
  if (!(REDIRECT_HOSTS as readonly string[]).includes(host)) return null;
  return `https://${canonicalHost}${url.pathname}${url.search}`;
}
