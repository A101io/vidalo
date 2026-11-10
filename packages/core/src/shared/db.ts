/**
 * Thin access layer used by publisher / fixer / reporter so they depend on the
 * `Db` interface (packages/core/src/db/types.ts) and not on how ../db exports it.
 *
 * Also carries a few lookups the Db interface does not have yet
 * (business by facts host, businesses by status). They duck-type an optional
 * method on the db and fall back to scanning the in-memory store.
 * TODO(integration): move these onto the Db interface once db/ is final.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import * as dbModule from "../db/index.js";
import type { BusinessRecord, Db } from "../db/types.js";
import type { BusinessStatus, Fix } from "../types.js";

let cached: Db | null = null;

/**
 * A database handle for one request or one job. On Cloudflare Workers a
 * connection opened in one request cannot be used by the next ("Cannot
 * perform I/O on behalf of a different request"), so each invocation opens
 * its own (Hyperdrive pools them) and runs inside `withDb`. Everything that
 * calls getDb() then gets that handle without being passed it. Outside a
 * scope (Node: dev, tests, CLI) the process-wide handle answers, as before.
 */
// One instance per isolate, on globalThis: on Cloudflare the Worker entry
// (apps/web/worker.ts) and the Next server are bundled separately, each with
// its own copy of this module. Two AsyncLocalStorage instances would mean the
// scope opened by one is invisible to the other, and every query silently
// falls back to the shared handle.
const g = globalThis as typeof globalThis & { __vidaloDbScope?: AsyncLocalStorage<Db> };
const scope = (g.__vidaloDbScope ??= new AsyncLocalStorage<Db>());

export function withDb<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  return scope.run(db, fn);
}

export function getDb(): Db {
  const scoped = scope.getStore();
  if (scoped) return scoped;
  if (cached) return cached;
  const m = dbModule as unknown as Record<string, unknown>;
  if (typeof m.getDb === "function") cached = (m.getDb as () => Db)();
  else if (m.db && typeof m.db === "object") cached = m.db as Db;
  else if (typeof m.createDb === "function") cached = (m.createDb as () => Db)();
  else cached = m as unknown as Db; // named function exports
  return cached;
}

/** Tests can inject a Db (e.g. a MemDb) instead of the module default. */
export function setDb(db: Db | null): void {
  cached = db;
}

type MemLike = { businesses?: Map<string, BusinessRecord> };

export async function getBusinessByFactsHost(host: string): Promise<BusinessRecord | null> {
  const db = getDb();
  const h = host.toLowerCase();
  const anyDb = db as unknown as { getBusinessByFactsHost?: (h: string) => Promise<BusinessRecord | null> } & MemLike;
  if (typeof anyDb.getBusinessByFactsHost === "function") return anyDb.getBusinessByFactsHost(h);
  if (anyDb.businesses instanceof Map) {
    for (const b of anyDb.businesses.values()) if (b.factsHost?.toLowerCase() === h) return { ...b };
  }
  // Fallback host "{slug}-feiten.{suffix}" → derive slug.
  const suffix = (process.env.FACTS_HOST_SUFFIX || "vidalo.io").toLowerCase();
  const tail = `-feiten.${suffix}`;
  if (h.endsWith(tail)) {
    const slug = h.slice(0, -tail.length);
    const b = slug && !slug.includes(".") ? await db.getBusiness(slug) : null;
    if (b) return b;
  }
  return null;
}

export async function listBusinessesByStatus(statuses: BusinessStatus[]): Promise<BusinessRecord[]> {
  const db = getDb();
  const anyDb = db as unknown as { listBusinessesByStatus?: (s: BusinessStatus[]) => Promise<BusinessRecord[]> } & MemLike;
  if (typeof anyDb.listBusinessesByStatus === "function") return anyDb.listBusinessesByStatus(statuses);
  if (anyDb.businesses instanceof Map) {
    return [...anyDb.businesses.values()].filter((b) => statuses.includes(b.status)).map((b) => ({ ...b }));
  }
  console.log(JSON.stringify({ msg: "db.listBusinessesByStatus.unsupported", statuses }));
  return [];
}

/** Set facts host columns. Uses upsertBusiness (partial update by id). */
export async function setFactsHost(businessId: string, factsHost: string | null, verifiedAt: string | null): Promise<BusinessRecord> {
  const db = getDb();
  const b = await db.getBusiness(businessId);
  if (!b) throw new Error(`business ${businessId} not found`);
  return db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, factsHost, factsHostVerifiedAt: verifiedAt });
}

/** Set the lifecycle status and log a `business.status` event (the worker cron reads these for dunning/churn timing). */
export async function setBusinessStatus(businessId: string, status: BusinessStatus, extra: Record<string, unknown> = {}): Promise<BusinessRecord> {
  const db = getDb();
  const b = await db.getBusiness(businessId);
  if (!b) throw new Error(`business ${businessId} not found`);
  const updated = await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, status });
  if (b.status !== status) await db.logEvent(b.id, "business.status", { status, from: b.status, ...extra });
  return updated;
}

/** Fix by id: uses db.getFix when present, else scans unresolved fixes with a recheck date. */
export async function getFix(fixId: string): Promise<Fix | null> {
  const db = getDb();
  const anyDb = db as unknown as { getFix?: (id: string) => Promise<Fix | null>; fixes?: Map<string, Fix> };
  if (typeof anyDb.getFix === "function") return anyDb.getFix(fixId);
  if (anyDb.fixes instanceof Map) {
    const f = anyDb.fixes.get(fixId);
    return f ? { ...f } : null;
  }
  const all = await db.listDueRechecks(new Date(8640000000000000));
  return all.find((f) => f.id === fixId) ?? null;
}

export function isMock(): boolean {
  return process.env.VIDALO_MOCK === "1";
}
