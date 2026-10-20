/**
 * Publisher: facts page + channel sync.
 *
 *   publishFactsPage(businessId)  render latest facts → write out/pages (mock) →
 *                                 IndexNow ping → upsert facts_page channel → event
 *   syncAllChannels(businessId)   run every channel adapter, store status/evidence,
 *                                 enqueue follow-up jobs (email / operator_task)
 *   ensureFactsHost(businessId)   pick feiten.{domain} or the fallback host
 *   discoverDirectories(businessId) find listings in the NL directories → channels
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Channel, Facts } from "../types.js";
import type { BusinessRecord } from "../db/types.js";
import { getDb, isMock, setFactsHost } from "../shared/db.js";
import { log } from "../shared/log.js";
import { syncChannel, type SyncResult } from "./channels/index.js";
import { findAllListings } from "./channels/directories.js";
import { checkFactsHost, defaultFactsHost, isFallbackHost, preferredFactsHost } from "./host.js";
import { pingIndexNow } from "./indexnow.js";
import { renderFactsPage, type RenderedFactsPage } from "./render.js";
import { clearServeCache } from "./serve.js";

export * from "./render.js";
export * from "./host.js";
export * from "./indexnow.js";
export * from "./serve.js";
export * from "./sitecheck.js";
export * from "./google-index.js";
export * from "./channels/index.js";

export interface PublishResult {
  businessId: string;
  host: string;
  url: string;
  factsVersion: number;
  verified: boolean;
  indexNow: { skipped: boolean; status?: number };
  outputDir: string | null;
}

export function factsPageUrl(business: Pick<BusinessRecord, "slug" | "factsHost">): string {
  const host = business.factsHost ?? defaultFactsHost(business);
  return `https://${host}/`;
}

/**
 * Decide the facts host for a business if none is set. Owner's domain wins;
 * the fallback host is verified immediately (it is ours).
 */
export async function ensureFactsHost(businessId: string, choice: "domain" | "fallback" = "domain"): Promise<BusinessRecord> {
  const db = getDb();
  const business = await db.getBusiness(businessId);
  if (!business) throw new Error(`business ${businessId} not found`);
  if (business.factsHost) return business;
  const host = choice === "domain" ? preferredFactsHost(business) : defaultFactsHost(business);
  const verifiedAt = isFallbackHost(host) ? new Date().toISOString() : null;
  const updated = await setFactsHost(business.id, host, verifiedAt);
  await db.logEvent(business.id, "facts_host.set", { host, verified: verifiedAt !== null, cnameTarget: isFallbackHost(host) ? null : `feiten.${process.env.FACTS_HOST_SUFFIX || "vidalo.io"}` });
  return updated;
}

/** Cron helper: poll DNS/Cloudflare for an unverified custom host; mark verified when it resolves. */
export async function pollFactsHost(businessId: string): Promise<{ verified: boolean; host: string | null }> {
  const db = getDb();
  const business = await db.getBusiness(businessId);
  if (!business?.factsHost) return { verified: false, host: null };
  if (business.factsHostVerifiedAt) return { verified: true, host: business.factsHost };
  const check = await checkFactsHost(business.factsHost);
  log.info("facts_host.poll", { businessId, host: business.factsHost, verified: check.verified, cname: check.cname?.found ?? null });
  if (check.verified) {
    await setFactsHost(business.id, business.factsHost, new Date().toISOString());
    await db.logEvent(business.id, "facts_host.verified", { host: business.factsHost, cloudflare: check.cloudflare?.status ?? null });
    await db.enqueueJob("publish", { businessId: business.id, reason: "host_verified" });
  }
  return { verified: check.verified, host: business.factsHost };
}

async function writeMockOutput(host: string, page: RenderedFactsPage): Promise<string> {
  const dir = path.resolve(process.env.VIDALO_OUT_DIR ?? "out", "pages", host);
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(path.join(dir, "index.html"), page.html, "utf8"),
    writeFile(path.join(dir, "llms.txt"), page.llmsTxt, "utf8"),
    writeFile(path.join(dir, "sitemap.xml"), page.sitemapXml, "utf8"),
    writeFile(path.join(dir, "feiten.json"), JSON.stringify(page.jsonLd, null, 2), "utf8"),
  ]);
  return dir;
}

/**
 * Render and publish the facts page for the latest facts. Pages are rendered
 * on request by serve.ts, so "publishing" means: fix the host, bust the cache,
 * write the static files (mock / backup), ping IndexNow and record the channel.
 */
export async function publishFactsPage(businessId: string): Promise<PublishResult> {
  const db = getDb();
  const business = await ensureFactsHost(businessId);
  const facts = await db.latestFacts(business.id);
  if (!facts) throw new Error(`business ${businessId} has no facts yet`);
  if (facts.provisional && !facts.verifiedAt) {
    log.warn("publish.provisional_facts", { businessId, version: facts.version });
  }
  const host = business.factsHost!;
  const page = renderFactsPage(facts, business, { host, verifiedAt: new Date().toISOString() });
  clearServeCache(host);

  const outputDir = isMock() || process.env.VIDALO_WRITE_PAGES === "1" ? await writeMockOutput(host, page) : null;
  const verified = business.factsHostVerifiedAt !== null;
  const indexNow = verified ? await pingIndexNow([page.canonicalUrl, `${page.canonicalUrl}llms.txt`]) : { skipped: true };

  await db.upsertChannel({
    businessId: business.id,
    type: "facts_page",
    name: "Feitenpagina",
    externalId: host,
    url: page.canonicalUrl,
    status: verified ? "synced" : "pending",
    lastSyncedAt: new Date().toISOString(),
    meta: { factsVersion: facts.version, verified, outputDir },
  });
  await db.logEvent(business.id, "facts_page.published", { host, url: page.canonicalUrl, factsVersion: facts.version, verified, indexNow: indexNow.skipped ? "skipped" : (indexNow as { status?: number }).status });
  log.info("publish.done", { businessId, host, factsVersion: facts.version, verified, outputDir });

  return { businessId, host, url: page.canonicalUrl, factsVersion: facts.version, verified, indexNow, outputDir };
}

/**
 * Create directory channels for every directory where the business is listed.
 * Run once during setup; safe to re-run (upsert by name).
 */
export async function discoverDirectories(businessId: string): Promise<Channel[]> {
  const db = getDb();
  const business = await db.getBusiness(businessId);
  if (!business) throw new Error(`business ${businessId} not found`);
  const hits = await findAllListings(business);
  const channels: Channel[] = [];
  for (const hit of hits) {
    if (!hit.found) continue;
    channels.push(
      await db.upsertChannel({
        businessId: business.id,
        type: "directory",
        name: hit.directory.name,
        externalId: null,
        url: hit.url,
        status: "pending",
        meta: { mode: hit.directory.mode, domain: hit.directory.domain, discovery: hit.mode, factsPageUrl: factsPageUrl(business) },
      }),
    );
  }
  await db.logEvent(business.id, "directories.discovered", { found: channels.map((c) => c.name) });
  return channels;
}

/** Ensure the platform channels (GBP, Bing, Apple) exist as pending rows. */
export async function ensurePlatformChannels(businessId: string): Promise<Channel[]> {
  const db = getDb();
  const existing = await db.listChannels(businessId);
  const wanted: { type: Channel["type"]; name: string }[] = [
    { type: "gbp", name: "Google Bedrijfsprofiel" },
    { type: "bing", name: "Bing Places" },
    { type: "apple", name: "Apple Business Connect" },
  ];
  const out: Channel[] = [];
  for (const w of wanted) {
    const found = existing.find((c) => c.type === w.type);
    out.push(found ?? (await db.upsertChannel({ businessId, type: w.type, name: w.name, externalId: null, url: null, status: "pending" })));
  }
  return out;
}

export interface SyncAllResult {
  businessId: string;
  results: SyncResult[];
}

/** Sync every non-facts_page channel against the latest facts and persist status + evidence. */
export async function syncAllChannels(businessId: string, opts: { facts?: Facts; channelIds?: string[] } = {}): Promise<SyncAllResult> {
  const db = getDb();
  const business = await db.getBusiness(businessId);
  if (!business) throw new Error(`business ${businessId} not found`);
  const facts = opts.facts ?? (await db.latestFacts(businessId));
  if (!facts) throw new Error(`business ${businessId} has no facts yet`);
  await ensurePlatformChannels(businessId);
  let channels = (await db.listChannels(businessId)).filter((c) => c.type !== "facts_page");
  if (opts.channelIds) channels = channels.filter((c) => opts.channelIds!.includes(c.id));

  const results: SyncResult[] = [];
  for (const channel of channels) {
    const result = await syncOneChannel(channel, facts, business);
    results.push(result);
  }
  await db.logEvent(businessId, "channels.synced", { results: results.map((r) => ({ channel: r.channelId, type: r.channelType, status: r.status, diff: r.diff.length })) });
  return { businessId, results };
}

/** Sync one channel, store the outcome and enqueue any follow-up job. */
export async function syncOneChannel(channel: Channel, facts: Facts, business?: BusinessRecord): Promise<SyncResult> {
  const db = getDb();
  const result = await syncChannel(channel, facts);
  const status: Channel["status"] = result.status === "skipped" ? channel.status : result.status;
  await db.upsertChannel({
    id: channel.id,
    businessId: channel.businessId,
    type: channel.type,
    name: channel.name,
    externalId: channel.externalId,
    url: channel.url,
    status,
    lastSyncedAt: new Date().toISOString(),
    meta: { lastSync: result.evidence, lastDiff: result.diff, note: result.note ?? null },
  });
  if (result.followUp) {
    const payload: Record<string, unknown> = { ...result.followUp.payload, businessId: channel.businessId, channelId: channel.id, channelName: channel.name };
    if (result.followUp.kind === "email") {
      await db.enqueueJob("email", { template: "directory_correction", ...payload, ownerEmail: business?.ownerEmail ?? null });
    } else {
      await db.enqueueJob("operator_task", payload);
    }
  }
  log.info("channel.synced", { channelId: channel.id, type: channel.type, name: channel.name, status: result.status, diff: result.diff.length });
  return result;
}
