import { discoverDirectories, ensureFactsHost, publishFactsPage, syncAllChannels } from "@vidalo/core/publisher";
import { sendWelcome } from "@vidalo/core/reporter";
import { generatePrompts, getDb } from "../compat.js";
import { log } from "../log.js";
import type { Handler } from "./types.js";

/**
 * Workflow B after checkout: prompts → host → facts page → channels → baseline scan →
 * own-website check + Google index check → welcome.
 * Idempotent: safe to re-run after the owner confirms facts or connects Google.
 */
export const setup: Handler<"setup"> = async (p) => {
  const db = getDb();
  const business = await db.getBusiness(p.businessId);
  if (!business) throw new Error(`business ${p.businessId} not found`);
  const facts = await db.latestFacts(business.id);
  if (!facts) throw new Error(`business ${business.id} has no facts; the web app must insert provisional facts before setup`);

  // 1. prompts (~20) when missing
  let prompts = await db.listPrompts(business.id, { activeOnly: true });
  if (prompts.length === 0) {
    prompts = await db.insertPrompts(business.id, generatePrompts(facts));
    await db.logEvent(business.id, "prompts.generated", { count: prompts.length });
  }

  // 2. host + facts page
  await ensureFactsHost(business.id, p.hostChoice ?? (business.domain ? "domain" : "fallback"));
  const pub = await publishFactsPage(business.id);

  // 3. channels: platforms + directory sweep, then sync
  await discoverDirectories(business.id);
  const sync = await syncAllChannels(business.id);

  // 4. baseline scan → fix round 1 (+ baseline mail) chained by the scan handler
  const scanJob = await db.enqueueJob("scan", { businessId: business.id, kind: "baseline" });
  await db.logEvent(business.id, "scan.enqueued", { kind: "baseline", jobId: scanJob.id });

  // 5. the owner's own website, and whether Google has read the facts page
  //    (cron repeats both: site monthly, Google weekly; see cron.ts)
  await db.enqueueJob("sitecheck", { businessId: business.id });
  await db.logEvent(business.id, "sitecheck.enqueued", { reason: "setup" });
  if (pub.verified) {
    await db.enqueueJob("index_check", { businessId: business.id });
    await db.logEvent(business.id, "google_index.enqueued", { reason: "setup" });
  }

  // 6. welcome (4 steps)
  if (!p.skipWelcome) await sendWelcome(business.id);

  // anniversary day for the monthly scan = day of setup
  if (business.anniversaryDay == null) {
    const day = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", day: "numeric" }).format(new Date()));
    await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, anniversaryDay: Math.min(day, 28) });
  }

  await db.logEvent(business.id, "setup.done", { host: pub.host, verified: pub.verified, prompts: prompts.length, channels: sync.results.length });
  log.info("setup.done", { businessId: business.id, host: pub.host, prompts: prompts.length, channels: sync.results.length });
  return { host: pub.host, prompts: prompts.length, channels: sync.results.length, baselineJobId: scanJob.id };
};
