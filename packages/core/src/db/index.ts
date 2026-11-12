/**
 * Database entry point.
 *
 *   import { db } from "@vidalo/core/db";
 *   const b = await db.getBusiness("bakkerij-de-vries-haarlem");
 *
 * `db` is chosen at import time:
 *   - VIDALO_MOCK=1 or no DATABASE_URL  -> MemDb (in-memory, zero infrastructure)
 *   - otherwise                          -> PgDb (postgres.js against DATABASE_URL)
 *   - VIDALO_DB=pg forces PgDb even under VIDALO_MOCK=1, so the mock engines
 *     can drive a real Postgres (`pnpm e2e:pg`).
 *
 * `withMockDb()` returns a fresh MemDb regardless of env (tests, dry runs).
 * `createDb(url)` builds a PgDb for an explicit connection string.
 */
import { MemDb } from "./mem";
import { PgDb } from "./pg";
import type { Db } from "./types";

export * from "./types";
export { MemDb } from "./mem";
export { PgDb } from "./pg";
export * from "./owner-area";

/** True when the process should avoid all external infrastructure. */
export function isMockMode(): boolean {
  return process.env.VIDALO_MOCK === "1" || !process.env.DATABASE_URL;
}

/** A fresh in-memory database with the same interface as the real one. */
export function withMockDb(): MemDb {
  return new MemDb();
}

export function createDb(databaseUrl: string, opts?: { max?: number; idleTimeout?: number }): PgDb {
  return new PgDb(databaseUrl, opts);
}

function pickDb(): Db {
  if (process.env.VIDALO_DB === "pg") {
    if (!process.env.DATABASE_URL) throw new Error("VIDALO_DB=pg needs DATABASE_URL");
    return new PgDb(process.env.DATABASE_URL);
  }
  if (isMockMode()) return new MemDb();
  return new PgDb(process.env.DATABASE_URL!);
}

/** The process-wide database handle. */
export const db: Db = pickDb();

/**
 * Helper for callers that want to override the db (tests) without touching
 * module state everywhere: pass `db` explicitly to runScan / CLI helpers.
 */
export type { Db };
