import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { MemDb, createDb, type Db } from "../src/db";

/**
 * V2-COMP-03 (Julian 12 Nov 2026, "Ja, na 002"): a login with no business is deleted 30 days after the later
 * of its creation and its last sign-in. Subject: no business, created 40 days ago, last signed in 35 days ago.
 * Controls that must never be listed: a login with a business (created 100 days ago), a login with no business
 * created 29 days ago, a login with no business whose last sign-in was 2 days ago, a login already queued.
 * Runs on MemDb and, under `pnpm verify:pg` (TEST_DATABASE_URL), on PgDb with a stand-in auth.users table.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-11-12T12:00:00.000Z");
const DAY = 86_400_000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const CUTOFF = ago(30);

let pg: Db | undefined;
let raw: ReturnType<typeof postgres> | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => new MemDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      raw ??= postgres(PG_URL, { max: 1, onnotice: () => {} });
      // Supabase's auth.users, only the columns read here; the local shim has no such table.
      await raw.unsafe(`create table if not exists auth.users (id uuid primary key, created_at timestamptz, last_sign_in_at timestamptz)`);
      await raw.unsafe(`truncate auth.users, job, business restart identity cascade`);
      pg ??= createDb(PG_URL);
      return pg;
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
  await raw?.end();
});

async function addLogin(db: Db, createdAt: Date, lastSignInAt: Date | null): Promise<string> {
  const id = randomUUID();
  if (db instanceof MemDb) db.authUsers.set(id, { createdAt: createdAt.toISOString(), lastSignInAt: lastSignInAt?.toISOString() ?? null });
  else await raw!`insert into auth.users (id, created_at, last_sign_in_at) values (${id}, ${createdAt}, ${lastSignInAt})`;
  return id;
}

for (const [name, open] of backends) {
  describe(`logins without a business (${name})`, () => {
    let db: Db;
    let ids: { orphan: string; owner: string; young: string; recent: string };
    beforeEach(async () => {
      db = await open();
      const owner = await addLogin(db, ago(100), ago(80));
      await db.upsertBusiness({ name: `Bakkerij ${randomUUID().slice(0, 6)}`, place: "Haarlem", ownerUserId: owner, ownerEmail: "eigenaar@example.nl" });
      ids = {
        orphan: await addLogin(db, ago(40), ago(35)),
        owner,
        young: await addLogin(db, ago(29), null),
        recent: await addLogin(db, ago(100), ago(2)),
      };
    });

    it("lists only the login with no business past 30 days", async () => {
      expect(await db.listLoginsWithoutBusiness(CUTOFF, 200)).toEqual([ids.orphan]);
    });

    it("a login with an unrun login_delete job is not listed again", async () => {
      await db.enqueueJob("login_delete", { userId: ids.orphan });
      expect(await db.listLoginsWithoutBusiness(CUTOFF, 200)).toEqual([]);
    });

    it("a login that gets a business is no longer listed", async () => {
      await db.upsertBusiness({ name: `Kapper ${randomUUID().slice(0, 6)}`, place: "Leiden", ownerUserId: ids.orphan });
      expect(await db.listLoginsWithoutBusiness(CUTOFF, 200)).toEqual([]);
    });

    it("the overdue count holds the login a day after its date, not before", async () => {
      const before = await db.countOverdueDeletions(NOW);
      await addLogin(db, ago(30.5), null); // past its date by half a day: not overdue yet
      expect(await db.countOverdueDeletions(NOW)).toBe(before);
      expect(before).toBe(1); // the subject, 35 days since its last sign-in
    });
  });
}
