import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemDb, type Job } from "@vidalo/core/db";
import { setDb } from "@vidalo/core/shared";
import { handlerFor, validatePayload } from "../src/jobs/index";

/** Feature 002 A-05, SEC-46, F-010: VIDALO_PURGE holds back retention purges only, read at job time. */
const job = (kind: string, payload: Record<string, unknown>) => ({ id: 1, kind, payload }) as unknown as Job;

describe("purge job", () => {
  let db: MemDb;
  const saved = { purge: process.env.VIDALO_PURGE, mock: process.env.VIDALO_MOCK };
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    process.env.VIDALO_MOCK = "1";
  });
  afterEach(() => {
    if (saved.purge === undefined) delete process.env.VIDALO_PURGE;
    else process.env.VIDALO_PURGE = saved.purge;
    process.env.VIDALO_MOCK = saved.mock;
  });

  async function churnedPastDate() {
    const b = await db.upsertBusiness({ name: `Churned ${Math.random()}`, place: "Haarlem", plan: "monitor", status: "active" });
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, status: "churned" });
    // Move the retention date into the past (the clock cannot be moved in MemDb's trigger).
    db.businesses.get(b.id)!.deleteAt = new Date(Date.now() - 1000).toISOString();
    return b;
  }

  for (const flag of [undefined, "true", "0"]) {
    it(`a retention purge with VIDALO_PURGE=${flag} logs would_purge and deletes nothing`, async () => {
      if (flag === undefined) delete process.env.VIDALO_PURGE;
      else process.env.VIDALO_PURGE = flag;
      const b = await churnedPastDate();
      expect(await handlerFor("purge")!({ businessId: b.id, guard: "due" }, job("purge", {}))).toMatchObject({ done: false, reason: "dry_run" });
      expect(await db.getBusiness(b.id)).not.toBeNull();
    });
  }

  it("armed with exactly 1, the retention purge deletes", async () => {
    process.env.VIDALO_PURGE = "1";
    const b = await churnedPastDate();
    expect(await handlerFor("purge")!({ businessId: b.id, guard: "due" }, job("purge", {}))).toMatchObject({ done: true });
    expect(await db.getBusiness(b.id)).toBeNull();
  });

  it("an owner's fallback job deletes with VIDALO_PURGE unset (F-010)", async () => {
    delete process.env.VIDALO_PURGE;
    const b = await db.upsertBusiness({ name: "Scan", place: "Haarlem", plan: "setup", status: "trial" });
    expect(await handlerFor("purge")!({ businessId: b.id, guard: "no_subscription" }, job("purge", {}))).toMatchObject({ done: true });
    expect(await db.getBusiness(b.id)).toBeNull();
  });

  it("payloads need their ids", () => {
    expect(validatePayload("purge", { businessId: "x" })).toMatch(/guard/);
    expect(validatePayload("google_disconnect", { businessId: "x" })).toMatch(/reason/);
  });
});

describe("google_disconnect job", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
  });
  it("after a resubscribe the connection stays; still churned it goes (SEC-49)", async () => {
    const back = await db.upsertBusiness({ name: "Back", place: "Haarlem", plan: "monitor", status: "active" });
    const gone = await db.upsertBusiness({ name: "Gone", place: "Haarlem", plan: "monitor", status: "churned" });
    for (const b of [back, gone]) await db.upsertChannel({ businessId: b.id, type: "gbp", name: "Google", externalId: null, url: null, meta: { refreshToken: "rt" } });
    expect(await handlerFor("google_disconnect")!({ businessId: back.id, reason: "churn" }, job("google_disconnect", {}))).toEqual({ skipped: "not_churned" });
    expect(await handlerFor("google_disconnect")!({ businessId: gone.id, reason: "churn" }, job("google_disconnect", {}))).toEqual({ disconnected: 1 });
    expect((await db.listChannels(back.id)).length).toBe(1);
    expect((await db.listChannels(gone.id)).length).toBe(0);
  });
});

describe("V-COMP-01: deleting the login fails closed outside mock mode", () => {
  const saved = { mock: process.env.VIDALO_MOCK, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
  afterEach(() => {
    process.env.VIDALO_MOCK = saved.mock;
    if (saved.url === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = saved.key;
  });
  it("without the Admin key the login is not counted as deleted", async () => {
    const { deleteLogin } = await import("../src/jobs/purge");
    delete process.env.VIDALO_MOCK;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    await expect(deleteLogin("00000000-0000-4000-8000-000000000001")).rejects.toThrow(/SUPABASE/);
    const db = new MemDb();
    setDb(db);
    const user = "00000000-0000-4000-8000-0000000000aa";
    const b = await db.upsertBusiness({ name: "Scan", place: "Haarlem", plan: "setup", status: "trial", ownerUserId: user });
    const { workerPurgeDeps } = await import("../src/jobs/purge");
    const { purgeBusiness } = await import("@vidalo/core/shared");
    const out = await purgeBusiness({ ...workerPurgeDeps(), stripeLive: async () => false, sendDeletedMail: async () => {} }, b.id, "no_subscription");
    expect(out).toMatchObject({ done: true, loginsDeleted: 0 });
  });
  it("in mock mode it is recorded and passes", async () => {
    const { deleteLogin } = await import("../src/jobs/purge");
    process.env.VIDALO_MOCK = "1";
    delete process.env.SUPABASE_URL;
    await expect(deleteLogin("00000000-0000-4000-8000-000000000001")).resolves.toBeUndefined();
  });
});
