/**
 * The background worker as a Cloudflare Worker (apps/worker/wrangler.jsonc).
 * The Node entry (index.ts) runs the same work in loops; here Cloudflare
 * invokes it:
 *
 *   fetch      facts pages (core's handleFactsRequest) on feiten.vidalo.io,
 *              {slug}-feiten.vidalo.io and customers' feiten.{domain}
 *              (routes: wrangler.jsonc and publisher/host.ts)
 *   scheduled  every minute: run queued jobs for up to 10 minutes;
 *              every 10 minutes also the cron tick (cron.ts)
 *   queue      "vidalo-scans": a free scan started on the website
 *
 * Every invocation gets its own database handle (withDb): a connection
 * opened in one invocation cannot be used by the next. Hyperdrive, when
 * bound, pools the real connections.
 */
import { createDb } from "@vidalo/core/db";
import { withDb } from "@vidalo/core/shared";
import { handleFactsRequest } from "@vidalo/core/publisher";
import { readScanState, runScanWithProgress } from "@vidalo/core/scanner";
import type { Engine } from "@vidalo/core/types";
import { cronTick } from "./cron.js";
import { drainQueue } from "./loop.js";
import { errorMessage, log } from "./log.js";

interface Env {
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  VIDALO_MOCK?: string;
  VIDALO_DB?: string;
}

interface Ctx {
  waitUntil(p: Promise<unknown>): void;
}

/** Same shape as apps/web/lib/cloudflare.ts ScanMessage. */
interface ScanMessage {
  token: string;
  kind: "free";
  engines: string[];
}

interface QueueMessage<T> {
  body: T;
  ack(): void;
  retry(): void;
}

/** The two cron expressions in wrangler.jsonc. */
const EVERY_MINUTE = "* * * * *";
const DRAIN_FOR_MS = 10 * 60 * 1000;

function scoped<T>(env: Env, fn: () => Promise<T>): Promise<T> {
  const postgres = env.VIDALO_MOCK !== "1" || env.VIDALO_DB === "pg";
  const url = postgres ? (env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? null) : null;
  // Not mock and no database: core would fall back to mock mode and run fake
  // scans as if they were real. Refuse instead (fixtures are never a fallback).
  if (postgres && !url) return Promise.reject(new Error("vidalo-worker has no DATABASE_URL or HYPERDRIVE; refusing to run on mock data"));
  if (!url) return fn();
  return withDb(createDb(url, { max: 3, idleTimeout: 5 }), fn);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // The host is the one Cloudflare routed on (request.url / Host). A client's
    // own X-Forwarded-Host must not pick which business's page answers.
    const req = new Request(request);
    req.headers.delete("x-forwarded-host");
    return scoped(env, () => handleFactsRequest(req)).catch((err) => {
      log.error("cf.fetch.error", { error: errorMessage(err) });
      return new Response("Not available right now.\n", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
    });
  },

  async scheduled(controller: { cron: string; scheduledTime: number }, env: Env, ctx: Ctx): Promise<void> {
    const work = scoped(env, async () => {
      if (controller.cron === EVERY_MINUTE) {
        const n = await drainQueue(Number.POSITIVE_INFINITY, Date.now() + DRAIN_FOR_MS);
        if (n) log.info("cf.drained", { jobs: n });
      } else {
        await cronTick();
      }
    }).catch((err) => log.error("cf.scheduled.error", { cron: controller.cron, error: errorMessage(err) }));
    ctx.waitUntil(work);
  },

  async queue(batch: { messages: QueueMessage<ScanMessage>[] }, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      const { token, kind, engines } = msg.body;
      try {
        await scoped(env, async () => {
          const state = await readScanState(token);
          // Already running or finished (a redelivered message): nothing to do.
          if (!state || state.status !== "queued") {
            log.warn("cf.scan.skipped", { token, found: Boolean(state), status: state?.status ?? null, postgres: env.VIDALO_MOCK !== "1" || env.VIDALO_DB === "pg" });
            return;
          }
          await runScanWithProgress(state, { kind, engines: engines as Engine[] });
        });
        msg.ack();
      } catch (err) {
        log.error("cf.scan.error", { token, error: errorMessage(err) });
        msg.retry();
      }
    }
  },
};
