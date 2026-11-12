import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemDb, type Job } from "@vidalo/core/db";
import { setDb } from "@vidalo/core/shared";
import { retention } from "../src/cron";
import { handlerFor } from "../src/jobs/index";

/**
 * Feature 002 QA (phase 4), AC-6 "a business with a running subscription, a scheduled pause or an undone cancel is
 * never deleted by this": the case retention.test.ts does not hold. The owner scheduled deletion for the cancel date;
 * the date passes but the churn webhook has not arrived (late or lost), so the business is still `active` (or
 * `paused` after a failed payment) with a passed `delete_at`. Neither the cron nor an armed purge job may delete it.
 *
 * Control used in phase 4: `purgeAllowed` (core/shared/deletion.ts) "due" branch reduced to `return true` once the
 * date has passed → this test is red (purge queued and the business deleted); retention.test.ts stays green.
 */
const DAY = 86_400_000;
const T0 = Date.now();
const day = (n: number) => new Date(T0 + n * DAY);

let db: MemDb;
const saved = { purge: process.env.VIDALO_PURGE, mock: process.env.VIDALO_MOCK };
beforeEach(() => {
  db = new MemDb();
  setDb(db);
  process.env.VIDALO_MOCK = "1";
  process.env.VIDALO_PURGE = "1"; // armed: only the guards stand between the date and the delete
});
afterEach(() => {
  if (saved.purge === undefined) delete process.env.VIDALO_PURGE;
  else process.env.VIDALO_PURGE = saved.purge;
  process.env.VIDALO_MOCK = saved.mock;
});

async function runJobs(kinds: string[]): Promise<Job[]> {
  const ran: Job[] = [];
  for (let j = await db.claimJob(kinds); j; j = await db.claimJob(kinds)) {
    await handlerFor(j.kind)!(j.payload, j);
    await db.completeJob(j.id);
    ran.push(j);
  }
  return ran;
}

describe("AC-6: a passed owner deletion date without the churn webhook deletes nothing", () => {
  for (const status of ["active", "paused"] as const) {
    it(`status ${status}: no purge job, and a purge job forced in is refused`, async () => {
      const end = day(20);
      const b = await db.upsertBusiness({ name: `Late ${status}`, place: "Haarlem", plan: "monitor", status: "active", ownerEmail: "late@example.nl", cancelAt: end.toISOString() });
      await db.setDeletion(b.id, { at: end.toISOString(), reason: "owner" });
      if (status === "paused") await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, status: "paused" });
      expect((await db.getBusiness(b.id))!.deleteAt).toBe(end.toISOString());
      for (const n of [21, 25, 40]) {
        const out = await retention(day(n));
        expect(out.purgeQueued, `day ${n}`).toBe(0);
      }
      expect([...db.jobs.values()].filter((j) => j.kind === "purge")).toHaveLength(0);
      // A due purge job queued anyway (a stale job, a retried one) must not delete a business Stripe still bills.
      await db.enqueueJob("purge", { businessId: b.id, guard: "due" }, day(0));
      await runJobs(["purge"]);
      expect(await db.getBusiness(b.id)).not.toBeNull();
    });
  }
});
