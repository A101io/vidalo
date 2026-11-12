import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { withMockDb, createDb, type Db } from "../src/db";

/**
 * Feature 002 QA, verify round 2 (V-COMP-03, AC-5/AC-6). An owner's own deletion must never wait behind a page of
 * retention rows. The lane's test puts the owner's date before the retention dates, so ordering by date alone already
 * lists it first and removing "owner first" stays green. Here the owner's date is the LATEST of 26 due rows and the
 * page holds 20: only the owner-first order lists it. MemDb and, with TEST_DATABASE_URL (pnpm verify:pg), PgDb.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "auth_session, auth_throttle, question_use, google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";
const DAY = 86_400_000;

let pg: Db | undefined;
let raw: ReturnType<typeof postgres> | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      raw ??= postgres(PG_URL, { max: 1, onnotice: () => {} });
      await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
      pg ??= createDb(PG_URL);
      return pg;
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
  await raw?.end();
});

describe.each(backends)("%s: an owner's deletion is listed before a full page of due retention rows (V-COMP-03)", (_n, makeDb) => {
  it("25 due Vidalo Scan retention rows dated earlier, one owner row dated last, page of 20: the owner row is on it", async () => {
    const db = await makeDb();
    const days = (n: number) => new Date(Date.now() + n * DAY);
    const biz = (name: string, over: Record<string, unknown> = {}) => db.upsertBusiness({ name: `${name} ${randomUUID().slice(0, 6)}`, place: "Haarlem", ...over });

    const retention: string[] = [];
    for (let i = 0; i < 25; i++) {
      const r = await biz(`Scan ${i}`, { plan: "setup", status: "trial" });
      await db.setScanRetention(r.id, days(-30 + i * 0.1).toISOString());
      expect(await db.claimDeletionReminder(r.id, days(-60))).toBe(true);
      retention.push(r.id);
    }
    const o = await biz("Owner last", { plan: "monitor", status: "active", cancelAt: days(-1).toISOString() });
    await db.setDeletion(o.id, { at: days(-1).toISOString(), reason: "owner" });
    const churned = await db.upsertBusiness({ id: o.id, slug: o.slug, name: o.name, place: o.place, status: "churned" });
    expect(churned.deleteReason).toBe("owner");
    // Control: every row is due, and the owner's date is the latest of them.
    const all = await db.listDueDeletions(new Date(), 100);
    expect(all.map((b) => b.id).sort()).toEqual([...retention, o.id].sort());
    expect(Math.max(...all.map((b) => Date.parse(b.deleteAt!)))).toBe(Date.parse(churned.deleteAt!));

    const page = await db.listDueDeletions(new Date(), 20);
    expect(page).toHaveLength(20);
    expect(page[0]!.id, "the owner's own deletion comes first").toBe(o.id);
  });
});
