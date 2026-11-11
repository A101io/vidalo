import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withMockDb, createDb, type Db } from "../src/db";
import { PgDb } from "../src/db/pg";
import { isMember, linkBusinessesByEmail, listMemberBusinesses, listMemberUserIds, listReportArchive, saveRunSummary, type RunSummary } from "../src/db/owner-area";
import { prepareBusiness } from "../src/scanner";

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

  it("the archive: 6 finished + 1 recheck + 1 failed gives 7 rows newest first, pages by cursor, and keeps businesses apart", async () => {
    const { business } = await prepareBusiness({ name: "Bakkerij Archief", place: "Haarlem", db });
    const { business: other } = await prepareBusiness({ name: "Bakkerij Ander", place: "Utrecht", db });
    const ids: string[] = [];
    const pause = () => new Promise((r) => setTimeout(r, 12));
    const snapshotOf = (id: string, kind: "free" | "monthly") => ({ scanRunId: id, kind, checkedAt: new Date().toISOString(), engines: [], stip: "groen" as const, engineStips: [], cells: [] });
    const make = async (b: string, kind: "free" | "baseline" | "monthly" | "recheck", status: "done" | "failed") => {
      const run = await db.createScanRun({ businessId: b, kind, engines: ["chatgpt"], samplesPerPrompt: 1, status });
      await pause();
      return run.id;
    };
    for (const kind of ["free", "baseline", "monthly", "monthly", "monthly", "monthly"] as const) {
      const id = await make(business.id, kind, "done");
      await saveRunSummary(db, id, { v: 1, stip: "groen", answered: 5, correct: 5, snapshot: snapshotOf(id, "monthly") } satisfies RunSummary);
      ids.push(id);
    }
    const recheck = await make(business.id, "recheck", "done");
    const failed = await make(business.id, "monthly", "failed");
    const foreign = await make(other.id, "monthly", "done");

    const all = await listReportArchive(db, business.id, { limit: 24 });
    expect(all.next).toBeNull();
    expect(all.rows.map((r) => r.id)).toEqual([failed, ...[...ids].reverse()]);
    expect(all.rows.map((r) => r.id)).not.toContain(recheck);
    expect(all.rows.map((r) => r.id)).not.toContain(foreign);
    expect(all.rows[0]).toMatchObject({ status: "failed", summary: null });
    expect(all.rows[1]!.summary).toMatchObject({ answered: 5, correct: 5 });

    // Paging: 3 + 3 + 1, every row once, `next` null at the end.
    const p1 = await listReportArchive(db, business.id, { limit: 3 });
    expect(p1.rows).toHaveLength(3);
    expect(p1.next).toBeTruthy();
    const p2 = await listReportArchive(db, business.id, { limit: 3, before: p1.next! });
    const p3 = await listReportArchive(db, business.id, { limit: 3, before: p2.next! });
    expect([...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id)).toEqual(all.rows.map((r) => r.id));
    expect(p3.next).toBeNull();

    // SEC-12: a cursor made from the other business's run moves a position, never the business; a forged one is the first page.
    const fromOther = await listReportArchive(db, other.id, { limit: 1 });
    const cursorFromOther = Buffer.from(`${new Date().toISOString()}|${foreign}`).toString("base64url");
    const crossed = await listReportArchive(db, business.id, { limit: 24, before: cursorFromOther });
    for (const row of crossed.rows) expect(all.rows.map((r) => r.id)).toContain(row.id);
    expect(fromOther.rows.map((r) => r.id)).toEqual([foreign]);
    for (const forged of ["'; select 1; --", "%%%", "x".repeat(500), Buffer.from("not|a|cursor").toString("base64url"), Buffer.from(`2026-13-45T99:99:99Z|${failed}`).toString("base64url")]) {
      expect((await listReportArchive(db, business.id, { limit: 24, before: forged })).rows.map((r) => r.id), forged).toEqual(all.rows.map((r) => r.id));
    }
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

describe.skipIf(!PG_URL)("PgDb scan_run_summary_shape (migration 0017)", () => {
  it("refuses a summary without answered, and accepts a whole one", async () => {
    const raw = postgres(PG_URL!, { max: 1, onnotice: () => {} });
    try {
      await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
      const [b] = await raw`insert into business (slug, name, place) values ('shape', 'Shape', 'Haarlem') returning id`;
      const [r] = await raw`insert into scan_run (business_id, kind, engines, samples_per_prompt, status) values (${b!.id}, 'free', '{chatgpt}', 1, 'done') returning id`;
      await expect(raw`update scan_run set summary = ${raw.json({ v: 1, stip: "groen", correct: 1 })} where id = ${r!.id}`).rejects.toThrow(/scan_run_summary_shape/);
      await expect(raw`update scan_run set summary = ${raw.json({ v: 1, stip: "groen", correct: 1, answered: "5" })} where id = ${r!.id}`).rejects.toThrow(/scan_run_summary_shape/);
      await raw`update scan_run set summary = ${raw.json({ v: 1, stip: "groen", correct: 1, answered: 1 })} where id = ${r!.id}`;
    } finally {
      await raw.end();
    }
  });
});
