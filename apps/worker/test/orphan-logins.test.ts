import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MemDb } from "@vidalo/core/db";
import { setDb } from "@vidalo/core/shared";
import { retention } from "../src/cron";
import { handlerFor } from "../src/jobs/index";

/**
 * V2-COMP-03 (Julian 12 Nov 2026, "Ja, na 002"): the retention run deletes a login with no business 30 days after
 * the later of its creation and last sign-in, through 002's login_delete job, only when VIDALO_PURGE=1. Controls
 * that must keep their login: one with a business, one with no business at 29 days, one signed in 2 days ago.
 */
const DAY = 86_400_000;
const NOW = new Date();
const ago = (days: number) => new Date(NOW.getTime() - days * DAY).toISOString();

let db: MemDb;
const saved = { purge: process.env.VIDALO_PURGE, mock: process.env.VIDALO_MOCK };
const loginJobs = () => [...db.jobs.values()].filter((j) => j.kind === "login_delete");

function login(createdAt: string, lastSignInAt: string | null): string {
  const id = randomUUID();
  db.authUsers.set(id, { createdAt, lastSignInAt });
  return id;
}

let ids: { orphan: string; owner: string; young: string; recent: string };
beforeEach(async () => {
  db = new MemDb();
  setDb(db);
  process.env.VIDALO_MOCK = "1";
  delete process.env.VIDALO_PURGE;
  const owner = login(ago(100), ago(80));
  await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", ownerUserId: owner });
  ids = { orphan: login(ago(40), ago(35)), owner, young: login(ago(29), null), recent: login(ago(100), ago(2)) };
  for (const userId of Object.values(ids)) await db.recordSignIn({ sessionId: randomUUID(), userId, browser: "chrome", os: "macos", at: new Date() });
});
afterEach(() => {
  if (saved.purge === undefined) delete process.env.VIDALO_PURGE;
  else process.env.VIDALO_PURGE = saved.purge;
  process.env.VIDALO_MOCK = saved.mock;
});

describe("logins without a business (V2-COMP-03)", () => {
  it("armed: one login_delete job for the login past 30 days, run once; the controls keep login and sign-ins", async () => {
    process.env.VIDALO_PURGE = "1";
    expect(await retention(NOW)).toMatchObject({ loginsQueued: 1, dryRun: false });
    expect(loginJobs().map((j) => j.payload)).toEqual([{ userId: ids.orphan }]);
    // The next tick does not queue it twice while its job is waiting.
    expect(await retention(NOW)).toMatchObject({ loginsQueued: 0 });

    const j = (await db.claimJob(["login_delete"]))!;
    expect(await handlerFor("login_delete")!(j.payload, j)).toEqual({ deleted: true });
    await db.completeJob(j.id);
    expect(await db.listSignIns(ids.orphan, 10)).toEqual([]);
    for (const keep of [ids.owner, ids.young, ids.recent]) expect(await db.listSignIns(keep, 10)).toHaveLength(1);
  });

  it("unarmed: nothing queued, the login shows in the overdue count", async () => {
    const out = await retention(NOW);
    expect(out).toMatchObject({ loginsQueued: 0, dryRun: true, overdue: 1 });
    expect(loginJobs()).toEqual([]);
  });

  it("a login that got a business between the run and its job is skipped", async () => {
    process.env.VIDALO_PURGE = "1";
    await retention(NOW);
    await db.upsertBusiness({ name: "Kapper Jansen", place: "Leiden", ownerUserId: ids.orphan });
    const j = (await db.claimJob(["login_delete"]))!;
    expect(await handlerFor("login_delete")!(j.payload, j)).toEqual({ skipped: "member" });
    expect(await db.listSignIns(ids.orphan, 10)).toHaveLength(1);
  });
});
