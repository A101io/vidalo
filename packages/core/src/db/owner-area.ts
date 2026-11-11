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
