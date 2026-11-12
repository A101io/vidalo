import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { withMockDb, createDb, type Db } from "../src/db";
import { purgeBusiness, type PurgeDeps } from "../src/shared/purge";

/**
 * Feature 002 QA, verify round 2, AC-5(d) under concurrency: two purges of one business at once (the owner's
 * "Verwijder alles" and the fallback job, or two job workers) delete it once, mail once, and leave a control business
 * on another login untouched. Round 1 listed this as untested. MemDb and, with TEST_DATABASE_URL, PgDb.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "auth_session, auth_throttle, question_use, google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";

let pg: Db | undefined;
let raw: ReturnType<typeof postgres> | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      raw ??= postgres(PG_URL, { max: 4, onnotice: () => {} });
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

describe.each(backends)("%s: two purges of one business at once", (_n, makeDb) => {
  it("one deletes, the other finds nothing; one mail, one login delete; the control survives", async () => {
    const db = await makeDb();
    const user = randomUUID();
    const b = await db.upsertBusiness({ name: `Race ${randomUUID().slice(0, 6)}`, place: "Haarlem", plan: "setup", status: "scanned", ownerUserId: user, ownerEmail: "race@example.nl" });
    const control = await db.upsertBusiness({ name: `Control ${randomUUID().slice(0, 6)}`, place: "Leiden", plan: "setup", status: "scanned", ownerUserId: randomUUID(), ownerEmail: "control@example.nl" });
    await db.enqueueJob("publish", { businessId: b.id });
    await db.enqueueJob("publish", { businessId: control.id });

    const mails: string[] = [];
    const logins: string[] = [];
    const deps: PurgeDeps = {
      db,
      now: new Date(),
      dryRunRetention: true,
      stripeLive: async () => false,
      expireOpenCheckouts: async () => 0,
      revokeGoogle: async () => {},
      deleteCustomHostname: async () => {},
      deleteLogin: async (id) => void logins.push(id),
      sendDeletedMail: async (to) => void mails.push(to.email),
    };
    const results = await Promise.all([purgeBusiness(deps, b.id, "no_subscription"), purgeBusiness(deps, b.id, "no_subscription")]);

    expect(results.filter((r) => r.done)).toHaveLength(1);
    expect(await db.getBusiness(b.id)).toBeNull();
    expect(mails).toEqual(["race@example.nl"]);
    expect(logins).toEqual([user]);
    expect(await db.getBusiness(control.id)).not.toBeNull();
    const left = await db.claimJob(["publish"]);
    expect(left?.payload.businessId).toBe(control.id);
  });
});
