import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { withMockDb, createDb, type Db } from "../src/db";

/**
 * Feature 002, lane A: the account tables and methods (migrations 0018, 0019). Every case runs
 * on MemDb and, when TEST_DATABASE_URL carries supabase/migrations (pnpm verify:pg), on PgDb.
 * Every case has a control that must stay untouched.
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

const MIN = 60_000;

describe.each(backends)("%s: sign-ins (0018)", (_n, makeDb) => {
  let db: Db;
  const user = randomUUID();
  const other = randomUUID();
  beforeEach(async () => {
    db = await makeDb();
  });

  it("records once per session id; a second record never reopens or moves it", async () => {
    const sid = randomUUID();
    const t0 = new Date("2026-11-01T10:00:00.000Z");
    await db.recordSignIn({ sessionId: sid, userId: user, browser: "safari", os: "ios", at: t0 });
    await db.recordSignIn({ sessionId: sid, userId: user, browser: "chrome", os: "macos", at: new Date(t0.getTime() + 5 * MIN) });
    let rows = await db.listSignIns(user, 10);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sessionId: sid, browser: "safari", os: "ios", signedInAt: t0.toISOString(), endedAt: null });
    expect(await db.endSignIns(user, "signed_out", { sessionId: sid })).toBe(1);
    await db.recordSignIn({ sessionId: sid, userId: user, browser: "safari", os: "ios", at: new Date() });
    rows = await db.listSignIns(user, 10);
    expect(rows[0]!.endedReason).toBe("signed_out");
    expect(rows[0]!.signedInAt).toBe(t0.toISOString());
    // Control: a new id is open.
    const fresh = randomUUID();
    await db.recordSignIn({ sessionId: fresh, userId: user, browser: "chrome", os: "macos", at: new Date() });
    expect((await db.getSignIn(fresh))!.endedAt).toBeNull();
  });

  it("ending one session leaves the other open; ending all ends all; another user is untouched", async () => {
    const [a, b, c] = [randomUUID(), randomUUID(), randomUUID()];
    const now = new Date();
    await db.recordSignIn({ sessionId: a, userId: user, browser: "chrome", os: "macos", at: now });
    await db.recordSignIn({ sessionId: b, userId: user, browser: "firefox", os: "windows", at: now });
    await db.recordSignIn({ sessionId: c, userId: other, browser: "edge", os: "windows", at: now });
    expect(await db.endSignIns(user, "signed_out", { sessionId: a })).toBe(1);
    expect((await db.getSignIn(a))!.endedReason).toBe("signed_out");
    expect((await db.getSignIn(b))!.endedAt).toBeNull();
    expect(await db.endSignIns(user, "signed_out_everywhere")).toBe(1);
    expect((await db.getSignIn(b))!.endedReason).toBe("signed_out_everywhere");
    expect((await db.getSignIn(a))!.endedReason).toBe("signed_out");
    expect((await db.getSignIn(c))!.endedAt).toBeNull();
  });

  it("lists newest first, at most the limit; keeps the 10 newest ended rows and every open one", async () => {
    const base = Date.parse("2026-10-01T08:00:00.000Z");
    const ids: string[] = [];
    for (let i = 0; i < 13; i++) {
      const id = randomUUID();
      ids.push(id);
      await db.recordSignIn({ sessionId: id, userId: user, browser: "chrome", os: "macos", at: new Date(base + i * 60 * MIN) });
      // All but the first two end: those two stay open however old they are.
      if (i >= 2) await db.endSignIns(user, "signed_out", { sessionId: id });
    }
    const control = randomUUID();
    await db.recordSignIn({ sessionId: control, userId: other, browser: "safari", os: "macos", at: new Date(base) });
    await db.endSignIns(other, "signed_out");
    // One more sign-in triggers the prune.
    await db.recordSignIn({ sessionId: randomUUID(), userId: user, browser: "chrome", os: "macos", at: new Date(base + 20 * 60 * MIN) });
    const all = await db.listSignIns(user, 50);
    expect(all.map((r) => r.signedInAt)).toEqual([...all.map((r) => r.signedInAt)].sort().reverse());
    expect(await db.getSignIn(ids[0]!)).not.toBeNull();
    expect(await db.getSignIn(ids[1]!)).not.toBeNull();
    // 14 rows, 10 newest kept + the two open old ones; ended rows beyond the 10 newest are gone.
    expect(all).toHaveLength(12);
    expect(await db.getSignIn(ids[2]!)).toBeNull();
    expect(await db.getSignIn(ids[3]!)).toBeNull();
    expect(await db.listSignIns(user, 10)).toHaveLength(10);
    expect(await db.getSignIn(control)).not.toBeNull();
  });

  it("touches only when an hour has passed, and never an ended sign-in", async () => {
    const sid = randomUUID();
    const t0 = new Date("2026-11-10T10:00:00.000Z");
    await db.recordSignIn({ sessionId: sid, userId: user, browser: "chrome", os: "macos", at: t0 });
    await db.touchSignIn(sid, new Date(t0.getTime() + 30 * MIN));
    expect((await db.getSignIn(sid))!.lastSeenAt).toBe(t0.toISOString());
    const later = new Date(t0.getTime() + 61 * MIN);
    await db.touchSignIn(sid, later);
    expect((await db.getSignIn(sid))!.lastSeenAt).toBe(later.toISOString());
    expect((await db.getSignIn(sid))!.signedInAt).toBe(t0.toISOString());
    await db.endSignIns(user, "idle", { sessionId: sid });
    await db.touchSignIn(sid, new Date(t0.getTime() + 300 * MIN));
    expect((await db.getSignIn(sid))!.lastSeenAt).toBe(later.toISOString());
  });

  it("deleteSignIns removes one user's rows only", async () => {
    const [a, c] = [randomUUID(), randomUUID()];
    await db.recordSignIn({ sessionId: a, userId: user, browser: "chrome", os: "macos", at: new Date() });
    await db.recordSignIn({ sessionId: c, userId: other, browser: "chrome", os: "macos", at: new Date() });
    await db.deleteSignIns(user);
    expect(await db.listSignIns(user, 10)).toHaveLength(0);
    expect(await db.getSignIn(c)).not.toBeNull();
  });

  it("an unknown or malformed id is simply not found", async () => {
    expect(await db.getSignIn(randomUUID())).toBeNull();
    expect(await db.getSignIn("not-a-uuid")).toBeNull();
    expect(await db.endSignIns(user, "signed_out", { sessionId: "x'; drop table auth_session;--" })).toBe(0);
  });
});

describe.each(backends)("%s: sign-in link limit (0018)", (_n, makeDb) => {
  let db: Db;
  beforeEach(async () => {
    db = await makeDb();
  });
  const hour = () => new Date(Date.now() - 3_600_000);

  it("counts per key, this request included; another key is its own count", async () => {
    const [addr, ip, other] = ["a".repeat(64), "b".repeat(64), "c".repeat(64)];
    let counts: number[] = [];
    for (let i = 0; i < 6; i++) counts = await db.throttleAuth([addr, ip], hour());
    expect(counts).toEqual([6, 6]);
    expect(await db.throttleAuth([other, ip], hour())).toEqual([1, 7]);
  });

  it("after the window the address is under again (fake clock: the window starts 61 minutes later)", async () => {
    const addr = "d".repeat(64);
    for (let i = 0; i < 6; i++) await db.throttleAuth([addr], hour());
    const later = new Date(Date.now() + 61 * 60_000 - 3_600_000);
    expect(await db.throttleAuth([addr], later)).toEqual([1]);
  });

  it("prunes only rows older than the cut-off", async () => {
    const addr = "e".repeat(64);
    await db.throttleAuth([addr], hour());
    expect(await db.pruneAuthThrottle(new Date(Date.now() - 24 * 3_600_000))).toBe(0);
    expect(await db.pruneAuthThrottle(new Date(Date.now() + 1000))).toBeGreaterThanOrEqual(1);
    expect(await db.throttleAuth([addr], hour())).toEqual([1]);
  });
});
