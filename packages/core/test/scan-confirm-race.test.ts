import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withMockDb, createDb, type Db } from "../src/db";
import { SCAN_CONFIRM_EVENT, confirmOnce, newConfirmToken, pendingPayload } from "../src/shared/index.js";

/**
 * Security SEC-01 (11 Nov 2026): 60 parallel presses of one confirmation link started 60
 * free checks, because the link was marked used only after the start. confirmOnce claims
 * it under Db.withLock. Runs on MemDb and, with TEST_DATABASE_URL, on PgDb.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "question_use, google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";

let pg: Db | undefined;
let raw: ReturnType<typeof postgres> | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      raw ??= postgres(PG_URL, { max: 1, onnotice: () => {} });
      await raw.unsafe(`truncate ${TABLES} restart identity cascade`);
      pg ??= createDb(PG_URL, { max: 10 });
      return pg;
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
  await raw?.end();
});

const PRESSES = 30;

async function pendingLink(db: Db) {
  const b = await db.upsertBusiness({ name: "Bakkerij Race", place: "Haarlem" });
  const { hash } = newConfirmToken(b.id);
  await db.logEvent(b.id, SCAN_CONFIRM_EVENT, pendingPayload({ email: "a@b.nl", marketing: false }, "nl", hash));
  return { businessId: b.id, hash };
}

/** A start that takes a few round trips, like startFreeCheck: the window the race needs. */
function slowStart(db: Db, businessId: string, starts: { n: number }) {
  return async () => {
    await db.listEvents(businessId, 10);
    await new Promise((r) => setTimeout(r, 5));
    starts.n += 1;
    await db.logEvent(businessId, "scan.requested", { via: "test" });
    return `/scan/run-${starts.n}`;
  };
}

describe.each(backends)("%s: one confirmation link, many presses at once", (_n, makeDb) => {
  let db: Db;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("starts exactly one check; every press goes where the first went", async () => {
    const { businessId, hash } = await pendingLink(db);
    const starts = { n: 0 };
    const out = await Promise.all(Array.from({ length: PRESSES }, () => confirmOnce(db, businessId, hash, slowStart(db, businessId, starts), "/scan/druk")));
    expect(starts.n).toBe(1);
    expect(new Set(out)).toEqual(new Set(["/scan/run-1"]));
  });

  it("control: without the lock the same presses start more than one check", async () => {
    const { businessId, hash } = await pendingLink(db);
    const starts = { n: 0 };
    const unlocked = { listEvents: db.listEvents.bind(db), logEvent: db.logEvent.bind(db), withLock: <T>(_k: string, fn: () => Promise<T>) => fn() };
    await Promise.all(Array.from({ length: PRESSES }, () => confirmOnce(unlocked, businessId, hash, slowStart(db, businessId, starts), "/scan/druk")));
    expect(starts.n).toBeGreaterThan(1);
  });

  it("a refusal leaves the link usable", async () => {
    const { businessId, hash } = await pendingLink(db);
    expect(await confirmOnce(db, businessId, hash, async () => "/scan/druk", "/scan/druk")).toBe("/scan/druk");
    expect(await confirmOnce(db, businessId, hash, async () => "/scan/ok", "/scan/druk")).toBe("/scan/ok");
    expect(await confirmOnce(db, businessId, hash, async () => "/scan/again", "/scan/druk")).toBe("/scan/ok");
  });

  it("an unknown link starts nothing", async () => {
    const { businessId } = await pendingLink(db);
    let started = false;
    expect(await confirmOnce(db, businessId, "nope", async () => ((started = true), "/x"), "/scan/druk")).toBeNull();
    expect(started).toBe(false);
  });

  it("withLock: a failing holder releases the lock", async () => {
    await expect(db.withLock("t", async () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(await db.withLock("t", async () => 7)).toBe(7);
  });
});
