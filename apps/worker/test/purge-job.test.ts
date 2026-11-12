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

describe("V-COMP-04: a failing purge job shows in the overdue count and is logged when it gives up", () => {
  it("a fallback job that keeps failing → overdue 1 the next day, account.delete_failed when retired", async () => {
    const db = new MemDb();
    setDb(db);
    const saved = { mock: process.env.VIDALO_MOCK, key: process.env.STRIPE_SECRET_KEY };
    delete process.env.VIDALO_MOCK; // Stripe cannot be asked: the job throws and retries
    delete process.env.STRIPE_SECRET_KEY;
    const lines: string[] = [];
    const orig = console.error;
    const origLog = console.log;
    console.error = (l: string) => void lines.push(String(l));
    console.log = (l: string) => void lines.push(String(l));
    try {
      const b = await db.upsertBusiness({ name: "Vast", place: "Haarlem", plan: "setup", status: "trial", stripeCustomerId: "cus_vast" });
      const job = await db.enqueueJob("purge", { businessId: b.id, guard: "no_subscription" });
      const { processJob } = await import("../src/loop");
      expect(await db.countOverdueDeletions(new Date())).toBe(0);
      for (let i = 0; i < job.maxAttempts; i++) {
        db.jobs.get(job.id)!.runAt = new Date(0).toISOString();
        const claimed = (await db.claimJob(["purge"]))!;
        await processJob(claimed);
      }
      expect(db.jobs.get(job.id)!.doneAt).not.toBeNull();
      expect(await db.getBusiness(b.id)).not.toBeNull();
      expect(await db.countOverdueDeletions(new Date(Date.now() + 86_400_000 + 1000))).toBe(1);
      const failed = lines.filter((l) => l.includes('"account.delete_failed"'));
      expect(failed).toHaveLength(1);
      expect(failed[0]).toContain(b.id);
      expect(failed[0]).not.toContain("@");
    } finally {
      console.error = orig;
      console.log = origLog;
      process.env.VIDALO_MOCK = saved.mock;
      if (saved.key !== undefined) process.env.STRIPE_SECRET_KEY = saved.key;
    }
  });
});

describe("R1 (V2-SEC-01): with the production env per Worker, the worker revokes at Google", () => {
  const saved = { mock: process.env.VIDALO_MOCK, gid: process.env.GOOGLE_OAUTH_CLIENT_ID, fetch: globalThis.fetch };
  afterEach(() => {
    process.env.VIDALO_MOCK = saved.mock;
    if (saved.gid === undefined) delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    else process.env.GOOGLE_OAUTH_CLIENT_ID = saved.gid;
    globalThis.fetch = saved.fetch;
  });
  it("google_disconnect without GOOGLE_OAUTH_CLIENT_ID (web-only in the manifest) and VIDALO_MOCK unset calls Google's revoke endpoint", async () => {
    delete process.env.VIDALO_MOCK;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    const called: string[] = [];
    globalThis.fetch = (async (url: string) => (called.push(String(url)), new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    const db = new MemDb();
    setDb(db);
    const b = await db.upsertBusiness({ name: "Churned G", place: "Haarlem", plan: "monitor", status: "churned" });
    await db.upsertChannel({ businessId: b.id, type: "gbp", name: "Google", externalId: null, url: null, meta: { refreshToken: "rt-r1" } });
    expect(await handlerFor("google_disconnect")!({ businessId: b.id, reason: "churn" }, job("google_disconnect", {}))).toEqual({ disconnected: 1 });
    expect(called).toEqual(["https://oauth2.googleapis.com/revoke"]);
  });
  it("in mock mode it is still only recorded", async () => {
    process.env.VIDALO_MOCK = "1";
    const called: string[] = [];
    globalThis.fetch = (async (url: string) => (called.push(String(url)), new Response("{}"))) as unknown as typeof fetch;
    const db = new MemDb();
    setDb(db);
    const b = await db.upsertBusiness({ name: "Churned M", place: "Haarlem", plan: "monitor", status: "churned" });
    await db.upsertChannel({ businessId: b.id, type: "gbp", name: "Google", externalId: null, url: null, meta: { refreshToken: "rt-m" } });
    await handlerFor("google_disconnect")!({ businessId: b.id, reason: "churn" }, job("google_disconnect", {}));
    expect(called).toEqual([]);
  });
});

describe("R2 (V2-COMP-01): the login_delete job", () => {
  it("deletes a login that has no business left; skips one that has; a payload needs the userId", async () => {
    const db = new MemDb();
    setDb(db);
    process.env.VIDALO_MOCK = "1";
    const gone = "00000000-0000-4000-8000-0000000000b1";
    await db.recordSignIn({ sessionId: "00000000-0000-4000-8000-0000000000c1", userId: gone, browser: "chrome", os: "macos", at: new Date() });
    expect(await handlerFor("login_delete")!({ userId: gone }, job("login_delete", {}))).toEqual({ deleted: true });
    expect(await db.listSignIns(gone, 10)).toHaveLength(0);
    const kept = "00000000-0000-4000-8000-0000000000b2";
    await db.upsertBusiness({ name: "Nog een", place: "Haarlem", ownerUserId: kept });
    expect(await handlerFor("login_delete")!({ userId: kept }, job("login_delete", {}))).toEqual({ skipped: "member" });
    expect(validatePayload("login_delete", {})).toMatch(/userId/);
  });
  it("retired after its attempts: account.delete_failed and still overdue", async () => {
    const db = new MemDb();
    setDb(db);
    delete process.env.VIDALO_MOCK; // no Admin key: deleteLogin throws
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const lines: string[] = [];
    const [e, l] = [console.error, console.log];
    console.error = (x: string) => void lines.push(String(x));
    console.log = (x: string) => void lines.push(String(x));
    try {
      const j = await db.enqueueJob("login_delete", { userId: "00000000-0000-4000-8000-0000000000b3" });
      const { processJob } = await import("../src/loop");
      for (let i = 0; i < j.maxAttempts; i++) {
        db.jobs.get(j.id)!.runAt = new Date(0).toISOString();
        await processJob((await db.claimJob(["login_delete"]))!);
      }
      expect(db.jobs.get(j.id)!.doneAt).not.toBeNull();
      expect(lines.filter((x) => x.includes('"account.delete_failed"'))).toHaveLength(1);
      expect(await db.countOverdueDeletions(new Date())).toBe(1);
    } finally {
      console.error = e;
      console.log = l;
    }
  });
});
