/**
 * Tiny fetch-style HTTP handler for facts pages: `(req: Request) => Promise<Response>`.
 *
 * Serves `/`, `/llms.txt`, `/sitemap.xml`, `/robots.txt` and the IndexNow key
 * file for whichever host the request came in on. Looks the business up by
 * facts host, renders the latest verified facts, caches 10 minutes per host.
 * Works in node:http (see apps/worker) and could be mounted on a Cloudflare Worker.
 */
import type { Facts } from "../types.js";
import type { BusinessRecord } from "../db/types.js";
import { getBusinessByFactsHost, getDb } from "../shared/db.js";
import { googleVerificationToken } from "./google-index.js";
import { indexNowKey, isIndexNowKeyPath } from "./indexnow.js";
import { renderFactsPage, type RenderedFactsPage } from "./render.js";

const CACHE_TTL_MS = 10 * 60 * 1000;

interface CacheEntry {
  page: RenderedFactsPage;
  lastModified: Date;
  business: BusinessRecord;
  facts: Facts;
  cachedAt: number;
}

const cache = new Map<string, CacheEntry>();

export function clearServeCache(host?: string): void {
  if (host) cache.delete(host.toLowerCase());
  else cache.clear();
}

export interface ServeOptions {
  /** Override lookup (tests / Cloudflare Worker with a KV). */
  resolve?: (host: string) => Promise<{ business: BusinessRecord; facts: Facts; googleSiteVerification?: string | null } | null>;
  /** Where churned businesses redirect (default: their own website). */
  now?: () => Date;
}

async function defaultResolve(host: string): Promise<{ business: BusinessRecord; facts: Facts; googleSiteVerification: string | null } | null> {
  const business = await getBusinessByFactsHost(host);
  if (!business) return null;
  const facts = await getDb().latestFacts(business.id);
  if (!facts) return null;
  return { business, facts, googleSiteVerification: await googleVerificationToken(business.id, host) };
}

function hostOf(req: Request): string {
  const h = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  return h.split(":")[0]!.toLowerCase();
}

function text(body: string, type: string, extra: Record<string, string> = {}, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": type, "cache-control": "public, max-age=600", ...extra } });
}

export function createFactsHandler(opts: ServeOptions = {}): (req: Request) => Promise<Response> {
  const resolve = opts.resolve ?? defaultResolve;
  const now = opts.now ?? (() => new Date());

  return async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const host = hostOf(req);
    const path = url.pathname;

    if (req.method !== "GET" && req.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    // IndexNow key file: same for every host.
    if (isIndexNowKeyPath(path)) {
      return text(indexNowKey() ?? "", "text/plain; charset=utf-8");
    }

    if (path === "/robots.txt") {
      return text(`User-agent: *\nAllow: /\nSitemap: https://${host}/sitemap.xml\n`, "text/plain; charset=utf-8");
    }

    if (path === "/healthz") return text("ok", "text/plain; charset=utf-8", { "cache-control": "no-store" });

    let entry = cache.get(host);
    if (!entry || now().getTime() - entry.cachedAt > CACHE_TTL_MS) {
      const found = await resolve(host);
      if (!found) {
        cache.delete(host);
        return text("Geen feitenpagina op dit adres.", "text/plain; charset=utf-8", { "cache-control": "no-store" }, 404);
      }
      const { business, facts, googleSiteVerification } = found;
      if (business.status === "churned") {
        const site = facts.website ?? business.domain;
        const target = site ? `https://${site.replace(/^https?:\/\//, "")}` : null;
        if (target) return new Response(null, { status: 302, headers: { location: target, "cache-control": "no-store" } });
        return text("Deze feitenpagina is niet meer actief.", "text/plain; charset=utf-8", { "cache-control": "no-store" }, 410);
      }
      const lastModified = new Date(facts.verifiedAt ?? business.createdAt);
      const page = renderFactsPage(facts, business, { host, verifiedAt: lastModified.toISOString(), googleSiteVerification });
      entry = { page, lastModified, business, facts, cachedAt: now().getTime() };
      cache.set(host, entry);
    }

    const lastMod = entry.lastModified.toUTCString();
    const ims = req.headers.get("if-modified-since");
    if (ims && !Number.isNaN(Date.parse(ims)) && Date.parse(ims) >= Math.floor(entry.lastModified.getTime() / 1000) * 1000) {
      return new Response(null, { status: 304, headers: { "last-modified": lastMod, "cache-control": "public, max-age=600" } });
    }
    const headers = { "last-modified": lastMod, "x-facts-version": String(entry.facts.version) };

    switch (path) {
      case "/":
      case "/index.html":
        return text(entry.page.html, "text/html; charset=utf-8", headers);
      case "/llms.txt":
        return text(entry.page.llmsTxt, "text/plain; charset=utf-8", headers);
      case "/sitemap.xml":
        return text(entry.page.sitemapXml, "application/xml; charset=utf-8", headers);
      case "/feiten.json":
        return text(JSON.stringify(entry.page.jsonLd, null, 2), "application/ld+json; charset=utf-8", headers);
      default:
        return text("Niet gevonden.", "text/plain; charset=utf-8", { "cache-control": "no-store" }, 404);
    }
  };
}

/** Default handler bound to the db. */
export const handleFactsRequest = createFactsHandler();
