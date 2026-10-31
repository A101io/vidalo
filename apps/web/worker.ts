/**
 * The web Worker's entry: OpenNext's handler, with a database handle of its
 * own for every request. On Workers a connection opened during one request
 * cannot be used by the next, so the process-wide handle that serves Node
 * (dev, tests) would fail from the second request on. Hyperdrive, when bound,
 * pools the real connections; without it the handle connects directly.
 * Mock mode keeps the in-memory database and needs none of this.
 *
 * Not in tsconfig: it imports the build output (.open-next), which exists only
 * after `opennextjs-cloudflare build`; wrangler bundles it with esbuild.
 */
import handler from "./.open-next/worker.js";
import { createDb } from "@vidalo/core/db";
import { canonicalRedirect, withDb } from "@vidalo/core/shared";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

interface Env {
  HYPERDRIVE?: { connectionString: string };
  VIDALO_MOCK?: string;
  VIDALO_DB?: string;
  DATABASE_URL?: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    // www.vidalo.io is the same site: one permanent redirect to vidalo.io,
    // before anything touches the database.
    const canonical = canonicalRedirect(request.url);
    if (canonical) return Response.redirect(canonical, 301);
    // Postgres unless plain mock mode; VIDALO_DB=pg is mock engines on a real database (as in core).
    const postgres = env.VIDALO_MOCK !== "1" || env.VIDALO_DB === "pg";
    const url = postgres ? (env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? null) : null;
    // Not mock, and no database: core would quietly fall back to mock mode and
    // serve demo data as if it were real. Say so instead (Sitty's rule:
    // fixtures are never a fallback).
    if (postgres && !url) return notConfigured();
    if (!url) return handler.fetch(request, env, ctx);
    // The app decides "mock or real" by DATABASE_URL (apps/web/lib/env.ts,
    // core/db). On Workers the string lives in the Hyperdrive binding, so
    // without this the web app took production for mock mode: every route
    // that awaits ready() first seeded eight demo scans into a MemDb and hung
    // (seen on vidalo.io 31 Oct 2026: /api/scan/*/status, /api/support-autoreply).
    if (!process.env.DATABASE_URL) process.env.DATABASE_URL = url;
    // Few connections, closed shortly after the last query: the next request opens its own.
    const db = createDb(url, { max: 3, idleTimeout: 5 });
    return withDb(db, () => handler.fetch(request, env, ctx));
  },
};

function notConfigured(): Response {
  return new Response("Vidalo is not connected to its database (DATABASE_URL / HYPERDRIVE missing). Nothing is served until it is.\n", {
    status: 503,
    headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "300" },
  });
}
