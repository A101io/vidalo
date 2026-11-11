/**
 * Membership reads for the owner area (feature 002, lane B). Functions over a Db, not methods
 * on it: they branch on PgDb (own SQL through db.sql) or MemDb (derived from db.businesses).
 *
 * Membership is the table business_member (migration 0016), written only by the trigger that
 * follows business.owner_user_id (ADR-0001). MemDb has no table: it derives membership from
 * ownerUserId, so the two cannot disagree.
 */
import type { MemDb } from "./mem";
import type { PgDb } from "./pg";
import type { BusinessRecord, Db } from "./types";
import type { ScanKind, ScanReport, ScanRun, Stip } from "../types";
import { reportCounts, type ScanSnapshot } from "../progress";

// Not `instanceof`: `next dev` and OpenNext bundle core once per route, so the Db a request holds can come from
// another copy of these classes (see apps/web/lib/core.ts). `kind` is the same in every copy.
function isPg(db: Db): db is PgDb {
  return db.kind === "pg";
}
function isMem(db: Db): db is MemDb {
  return db.kind === "mem";
}

function unsupported(): never {
  throw new Error("owner-area: needs a MemDb or a PgDb");
}

/** Newest first; MemDb has no insertion clock beyond the Map order, which breaks ties. */
function newestFirst(list: BusinessRecord[]): BusinessRecord[] {
  return list
    .map((b, i) => ({ b, i }))
    .sort((x, y) => (y.b.createdAt ?? "").localeCompare(x.b.createdAt ?? "") || y.i - x.i)
    .map((x) => x.b);
}

/** Every business this login is a member of, newest first. Never another login's. */
export async function listMemberBusinesses(db: Db, userId: string): Promise<BusinessRecord[]> {
  if (isPg(db)) {
    const rows = await db.sql<{ id: string }[]>`
      select b.id from business_member m join business b on b.id = m.business_id
      where m.user_id = ${userId} order by b.created_at desc, b.id desc`;
    const found = await Promise.all(rows.map((r) => db.getBusiness(r.id)));
    return found.filter((b): b is BusinessRecord => b !== null);
  }
  if (isMem(db)) return newestFirst([...db.businesses.values()].filter((b) => b.ownerUserId === userId).map((b) => ({ ...b })));
  return unsupported();
}

/** The logins that are members of this business. */
export async function listMemberUserIds(db: Db, businessId: string): Promise<string[]> {
  if (isPg(db)) {
    const rows = await db.sql<{ userId: string }[]>`select user_id from business_member where business_id = ${businessId}`;
    return rows.map((r) => r.userId); // postgres.camel: user_id arrives as userId
  }
  if (isMem(db)) {
    const owner = db.businesses.get(businessId)?.ownerUserId;
    return owner ? [owner] : [];
  }
  return unsupported();
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when this login is a member of the business. A malformed id is simply "no" (no cast error, no 500). */
export async function isMember(db: Db, userId: string, businessId: string): Promise<boolean> {
  // MemDb ids need not be uuids (mock users are "mock-user-1"); Postgres would throw on the cast.
  if (isPg(db) && !(UUID.test(businessId) && UUID.test(userId))) return false;
  return (await listMemberUserIds(db, businessId)).includes(userId);
}

/**
 * Sets owner_user_id on every business with lower(owner_email) = email and owner_user_id null.
 * Returns how many. Only unowned rows: a business another login owns is never relinked (SEC-11).
 * `email` must be the verified address of the session, never one from a form.
 */
export async function linkBusinessesByEmail(db: Db, userId: string, email: string): Promise<number> {
  const e = email.toLowerCase();
  if (isPg(db)) {
    const rows = await db.sql`update business set owner_user_id = ${userId} where lower(owner_email) = ${e} and owner_user_id is null returning id`;
    return rows.length;
  }
  if (isMem(db)) {
    let n = 0;
    for (const b of db.businesses.values()) {
      if (b.ownerUserId || b.ownerEmail?.toLowerCase() !== e) continue;
      db.businesses.set(b.id, { ...b, ownerUserId: userId });
      n++;
    }
    return n;
  }
  return unsupported();
}

// ---------------------------------------------------------------------------
// Report archive and run summaries (migration 0017, ADR-0007)
// ---------------------------------------------------------------------------

/** What a finished check keeps for lists: the dot, the counts the report heading shows, and the progress snapshot. */
export interface RunSummary {
  v: 1;
  /** The colour of the dot, in the repo's words ("rood" | "oranje" | "groen" | "grijs"). */
  stip: Stip;
  /** Questions asked, as the report heading counts them. */
  answered: number;
  /** Of those, the questions every AI system answered right. */
  correct: number;
  snapshot: ScanSnapshot;
}

export interface ArchiveRow {
  id: string;
  kind: ScanKind;
  status: ScanRun["status"];
  createdAt: string;
  summary: RunSummary | null;
}

export function summarizeRun(report: ScanReport, snapshot: ScanSnapshot): RunSummary {
  const c = reportCounts(report);
  return { v: 1, stip: report.stip, answered: c.questions, correct: c.correct, snapshot };
}

// MemDb keeps summaries on the instance itself (a Symbol.for key), not in a module-level WeakMap: `next dev` and
// OpenNext load this module once per route, and a map per copy would hide a summary saved by another route.
const MEM_SUMMARIES = Symbol.for("vidalo.runSummaries");
function memSummaries(db: MemDb): Map<string, RunSummary> {
  const holder = db as unknown as Record<symbol, Map<string, RunSummary> | undefined>;
  return (holder[MEM_SUMMARIES] ??= new Map());
}

export async function saveRunSummary(db: Db, scanRunId: string, summary: RunSummary): Promise<void> {
  if (isPg(db)) {
    await db.sql`update scan_run set summary = ${db.sql.json(summary as never)} where id = ${scanRunId}`;
    return;
  }
  if (isMem(db)) {
    if (db.scanRuns.has(scanRunId)) memSummaries(db).set(scanRunId, structuredClone(summary));
    return;
  }
  return unsupported();
}

const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z$/;

function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, "utf8").toString("base64url");
}

/** Strict: anything that is not exactly `<iso>|<uuid>` is no cursor (the first page, never a 500). */
function decodeCursor(raw: string | undefined): { at: string; id: string } | null {
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const [at, id, ...rest] = Buffer.from(raw, "base64url").toString("utf8").split("|");
  // ISO shape and a real date (2026-13-45 matches the shape); the cursor is bound as text below, so microseconds survive.
  if (rest.length || !at || !id || !ISO.test(at) || Number.isNaN(Date.parse(at)) || !UUID.test(id)) return null;
  return { at, id };
}

/**
 * Finished and unfinished checks of one business, newest first, rechecks left out; `limit` rows and a cursor
 * for the next page (null at the end). Bound to `businessId` in SQL: a cursor made from another business's run
 * only moves the position, it never widens the business.
 */
export async function listReportArchive(db: Db, businessId: string, opts: { limit: number; before?: string }): Promise<{ rows: ArchiveRow[]; next: string | null }> {
  const limit = Math.max(1, Math.min(100, Math.floor(opts.limit)));
  const cursor = decodeCursor(opts.before);
  let all: (ArchiveRow & { cursorAt: string })[];
  if (isPg(db)) {
    if (!UUID.test(businessId)) return { rows: [], next: null };
    const after = cursor ? db.sql`and (created_at, id) < (${cursor.at}::text::timestamptz, ${cursor.id}::uuid)` : db.sql``;
    const rows = await db.sql<{ id: string; kind: ScanKind; status: ScanRun["status"]; createdAt: Date; cursorAt: string; summary: RunSummary | null }[]>`
      select id, kind, status, created_at, summary,
             to_char(created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_at
      from scan_run
      where business_id = ${businessId} and kind <> 'recheck' ${after}
      order by created_at desc, id desc limit ${limit + 1}`;
    all = rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, createdAt: r.createdAt.toISOString(), cursorAt: r.cursorAt, summary: r.summary }));
  } else if (isMem(db)) {
    const sums = memSummaries(db);
    all = [...db.scanRuns.values()]
      .filter((r) => r.businessId === businessId && r.kind !== "recheck")
      .map((r) => ({ id: r.id, kind: r.kind, status: r.status, createdAt: r.startedAt, cursorAt: r.startedAt, summary: sums.get(r.id) ?? null }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .filter((r) => !cursor || r.createdAt < cursor.at || (r.createdAt === cursor.at && r.id < cursor.id));
    all = all.slice(0, limit + 1);
  } else return unsupported();
  const page = all.slice(0, limit);
  const last = page[page.length - 1];
  return {
    rows: page.map(({ cursorAt: _c, ...row }) => row),
    next: all.length > limit && last ? encodeCursor(last.cursorAt, last.id) : null,
  };
}

/** Finished, non-recheck checks that have a summary, newest first (the progress view and the dashboard read these). */
export async function runSummaries(db: Db, businessId: string, limit: number): Promise<ArchiveRow[]> {
  const n = Math.max(1, Math.min(200, Math.floor(limit)));
  if (isPg(db)) {
    if (!UUID.test(businessId)) return [];
    const rows = await db.sql<{ id: string; kind: ScanKind; status: ScanRun["status"]; createdAt: Date; summary: RunSummary }[]>`
      select id, kind, status, created_at, summary from scan_run
      where business_id = ${businessId} and status = 'done' and kind <> 'recheck' and summary is not null
      order by created_at desc, id desc limit ${n}`;
    return rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, createdAt: r.createdAt.toISOString(), summary: r.summary }));
  }
  if (isMem(db)) {
    const sums = memSummaries(db);
    return [...db.scanRuns.values()]
      .filter((r) => r.businessId === businessId && r.status === "done" && r.kind !== "recheck" && sums.has(r.id))
      .map((r) => ({ id: r.id, kind: r.kind, status: r.status, createdAt: r.startedAt, summary: structuredClone(sums.get(r.id)!) }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, n);
  }
  return unsupported();
}

/**
 * Ids of finished, non-recheck checks for the backfill, by id (keyset: pass the last id back as `afterId`).
 * Without `all`, only those that have no summary yet.
 */
export async function listRunsToSummarize(db: Db, opts: { limit: number; afterId?: string; all?: boolean; businessId?: string }): Promise<string[]> {
  const limit = Math.max(1, Math.min(500, Math.floor(opts.limit)));
  if (isPg(db)) {
    const after = opts.afterId && UUID.test(opts.afterId) ? db.sql`and id > ${opts.afterId}::uuid` : db.sql``;
    const only = opts.all ? db.sql`` : db.sql`and summary is null`;
    const biz = opts.businessId && UUID.test(opts.businessId) ? db.sql`and business_id = ${opts.businessId}::uuid` : db.sql``;
    const rows = await db.sql<{ id: string }[]>`select id from scan_run where status = 'done' and kind <> 'recheck' ${only} ${after} ${biz} order by id limit ${limit}`;
    return rows.map((r) => r.id);
  }
  if (isMem(db)) {
    const sums = memSummaries(db);
    return [...db.scanRuns.values()]
      .filter((r) => r.status === "done" && r.kind !== "recheck" && (opts.all || !sums.has(r.id)) && (!opts.businessId || r.businessId === opts.businessId) && (!opts.afterId || r.id > opts.afterId))
      .map((r) => r.id)
      .sort()
      .slice(0, limit);
  }
  return unsupported();
}
