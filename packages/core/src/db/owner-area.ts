/**
 * Membership reads for the owner area (feature 002, lane B). Functions over a Db, not methods
 * on it: they branch on PgDb (own SQL) or MemDb (derived from db.businesses).
 * C-00 stub: membership is business.owner_user_id; B-01 moves Pg to business_member.
 */
import { MemDb } from "./mem";
import { PgDb } from "./pg";
import type { BusinessRecord, Db } from "./types";

function unsupported(): never {
  throw new Error("owner-area: needs a MemDb or a PgDb");
}

/** Every business this login is a member of, newest first. */
export async function listMemberBusinesses(db: Db, userId: string): Promise<BusinessRecord[]> {
  if (db instanceof PgDb) {
    const rows = await db.sql<{ id: string }[]>`select id from business where owner_user_id = ${userId} order by created_at desc`;
    const found = await Promise.all(rows.map((r) => db.getBusiness(r.id)));
    return found.filter((b): b is BusinessRecord => b !== null);
  }
  if (db instanceof MemDb) return [...db.businesses.values()].filter((b) => b.ownerUserId === userId).reverse().map((b) => ({ ...b }));
  return unsupported();
}

/** The logins that are members of this business. */
export async function listMemberUserIds(db: Db, businessId: string): Promise<string[]> {
  if (db instanceof PgDb) {
    const rows = await db.sql<{ owner_user_id: string }[]>`select owner_user_id from business where id = ${businessId} and owner_user_id is not null`;
    return rows.map((r) => r.owner_user_id);
  }
  if (db instanceof MemDb) {
    const owner = db.businesses.get(businessId)?.ownerUserId;
    return owner ? [owner] : [];
  }
  return unsupported();
}

export async function isMember(db: Db, userId: string, businessId: string): Promise<boolean> {
  return (await listMemberUserIds(db, businessId)).includes(userId);
}

/** Sets owner_user_id on every business with lower(owner_email) = email and owner_user_id null. Returns how many. */
export async function linkBusinessesByEmail(db: Db, userId: string, email: string): Promise<number> {
  const e = email.toLowerCase();
  if (db instanceof PgDb) {
    const rows = await db.sql`update business set owner_user_id = ${userId} where lower(owner_email) = ${e} and owner_user_id is null returning id`;
    return rows.length;
  }
  if (db instanceof MemDb) {
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
