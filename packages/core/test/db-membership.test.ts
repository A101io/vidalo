import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withMockDb, createDb, type Db } from "../src/db";
import { PgDb } from "../src/db/pg";
import { isMember, linkBusinessesByEmail, listMemberBusinesses, listMemberUserIds } from "../src/db/owner-area";

/**
 * Feature 002 B-01: who is a member of which business. MemDb derives membership from ownerUserId;
 * PgDb reads the table business_member, which a trigger keeps in step with business.owner_user_id
 * (migration 0016). The two must answer the same.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";

let pg: Db | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      const raw = postgres(PG_URL, { max: 1, onnotice: () => {} });
      await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
      await raw.end();
      pg ??= createDb(PG_URL);
      return pg;
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
});

const pause = () => new Promise((r) => setTimeout(r, 15));

describe.each(backends)("%s membership", (_name, makeDb) => {
  let db: Db;
  let one: string;
  let two: string;
  beforeEach(async () => {
    db = await makeDb();
    one = randomUUID();
    two = randomUUID();
  });

  async function business(name: string, owner: string | null, email = `${name.toLowerCase().replace(/\W/g, "")}@example.nl`) {
    return db.upsertBusiness({ name, place: "Haarlem", ownerEmail: email, ownerUserId: owner });
  }

  it("lists every business of a login, newest first, and never another login's", async () => {
    const a = await business("Eerste", one);
    await pause();
    const b = await business("Tweede", one);
    await pause();
    const c = await business("Derde", two);
    expect((await listMemberBusinesses(db, one)).map((x) => x.id)).toEqual([b.id, a.id]);
    expect((await listMemberBusinesses(db, two)).map((x) => x.id)).toEqual([c.id]);
    expect(await listMemberBusinesses(db, randomUUID())).toEqual([]);
    expect(await listMemberUserIds(db, a.id)).toEqual([one]);
  });

  it("isMember is true only for the owner; a malformed or unknown id is just false", async () => {
    const a = await business("Eerste", one);
    const c = await business("Derde", two);
    expect(await isMember(db, one, a.id)).toBe(true);
    expect(await isMember(db, one, c.id)).toBe(false);
    expect(await isMember(db, one, randomUUID())).toBe(false);
    expect(await isMember(db, one, "'; drop table business; --")).toBe(false);
    expect(await isMember(db, "not-a-uuid'", a.id)).toBe(false);
  });

  it("changing the owner moves the member row: the replaced login loses access at once", async () => {
    const a = await business("Eerste", one);
    expect(await isMember(db, one, a.id)).toBe(true);
    await db.upsertBusiness({ id: a.id, slug: a.slug, name: a.name, place: a.place, ownerUserId: two });
    expect(await isMember(db, one, a.id)).toBe(false);
    expect(await isMember(db, two, a.id)).toBe(true);
    expect(await listMemberBusinesses(db, one)).toEqual([]);
    await db.upsertBusiness({ id: a.id, slug: a.slug, name: a.name, place: a.place, ownerUserId: null });
    expect(await isMember(db, two, a.id)).toBe(false);
    expect(await listMemberUserIds(db, a.id)).toEqual([]);
  });

  it("linkBusinessesByEmail links only unowned businesses with that address, never one another login owns", async () => {
    const free1 = await business("Vrij een", null, "Eigenaar@Example.nl");
    const free2 = await business("Vrij twee", null, "eigenaar@example.nl");
    const other = await business("Van een ander", two, "eigenaar@example.nl"); // control: owned by login 2
    const elsewhere = await business("Ander adres", null, "iemand@example.nl");
    expect(await linkBusinessesByEmail(db, one, "EIGENAAR@example.nl")).toBe(2);
    expect(new Set((await listMemberBusinesses(db, one)).map((x) => x.id))).toEqual(new Set([free1.id, free2.id]));
    expect(await isMember(db, two, other.id)).toBe(true);
    expect(await isMember(db, one, other.id)).toBe(false);
    expect(await isMember(db, one, elsewhere.id)).toBe(false);
    expect(await linkBusinessesByEmail(db, one, "eigenaar@example.nl")).toBe(0);
  });

  it("deleting a business removes its membership", async () => {
    const a = await business("Eerste", one);
    await db.deleteBusiness(a.id);
    expect(await listMemberUserIds(db, a.id)).toEqual([]);
    expect(await listMemberBusinesses(db, one)).toEqual([]);
    if (db instanceof PgDb) expect((await db.sql`select 1 from business_member where business_id = ${a.id}`).length).toBe(0);
  });
});

describe.skipIf(!PG_URL)("PgDb business_member (migration 0016)", () => {
  let db: PgDb;
  beforeEach(async () => {
    const raw = postgres(PG_URL!, { max: 1, onnotice: () => {} });
    await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
    await raw.end();
    pg ??= createDb(PG_URL!);
    db = pg as PgDb;
  });

  it("the trigger writes the one owner row, and a second owner row for a business is refused", async () => {
    const owner = randomUUID();
    const b = await db.upsertBusiness({ name: "Eerste", place: "Haarlem", ownerUserId: owner });
    expect((await db.sql`select user_id, role from business_member where business_id = ${b.id}`).map((r) => [r.userId, r.role])).toEqual([[owner, "owner"]]);
    await expect(db.sql`insert into business_member (business_id, user_id) values (${b.id}, ${randomUUID()})`).rejects.toThrow(/business_member_one_owner/);
  });

  it("one business at most holds a verified facts host", async () => {
    const x = await db.upsertBusiness({ name: "Een", place: "Haarlem" });
    const y = await db.upsertBusiness({ name: "Twee", place: "Haarlem" });
    await db.sql`update business set facts_host = 'feiten.voorbeeld.nl', facts_host_verified_at = now() where id = ${x.id}`;
    // unverified claims of the same host stay possible; a second verified holder is refused
    await db.sql`update business set facts_host = 'Feiten.Voorbeeld.nl' where id = ${y.id}`;
    await expect(db.sql`update business set facts_host_verified_at = now() where id = ${y.id}`).rejects.toThrow(/business_facts_host_verified_uniq/);
  });
});
