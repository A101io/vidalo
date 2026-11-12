import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared/db";
import { purgeBusiness, type PurgeDeps } from "../src/shared/purge";
import { clearServeCache, createFactsHandler } from "../src/publisher/serve";
import { facts } from "./worker-fixtures";

/**
 * Feature 002 QA (phase 4), AC-5(d): "after a deletion … the facts page's hosts answer 'not found'". The facts handler
 * keeps a per-isolate page cache for 10 minutes (publisher/serve.ts CACHE_TTL_MS) and the purge does not clear it, so a
 * host that was served shortly before the deletion keeps serving the deleted business's page (V-QA-03).
 *
 * The first case is the AC. It fails on 6b6446e, so it is marked `it.fails` to keep `pnpm -r test` usable while
 * V-QA-03 is open: vitest then reports it as passing BECAUSE it fails, and as failing the day the fix lands.
 * Whoever fixes V-QA-03 changes `it.fails` to `it`. The second case pins today's upper bound (10 minutes).
 */
const HOST = "bakkerij-weg-haarlem-feiten.vidalo.io";

describe("AC-5(d): a deleted business's facts host", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    clearServeCache();
  });

  async function seedAndServe(now: () => Date) {
    const user = randomUUID();
    const b = await db.upsertBusiness({ name: "Bakkerij Weg", place: "Haarlem", plan: "setup", status: "trial", ownerUserId: user, ownerEmail: "weg@example.nl", factsHost: HOST, factsHostVerifiedAt: "2026-10-01T10:00:00.000Z" });
    await db.insertFacts(b.id, { ...facts, businessId: b.id, name: "Bakkerij Weg" }, { verifiedAt: "2026-10-01T10:00:00.000Z" });
    const handler = createFactsHandler({ now });
    const before = await handler(new Request(`https://${HOST}/`));
    expect(before.status).toBe(200);
    expect(await before.text()).toContain("Bakkerij Weg");
    const deps: PurgeDeps = {
      db,
      now: new Date(),
      dryRunRetention: true,
      stripeLive: async () => false,
      revokeGoogle: async () => {},
      deleteCustomHostname: async () => {},
      deleteLogin: async () => {},
      sendDeletedMail: async () => {},
      isOwnFactsHost: (h) => h.endsWith("-feiten.vidalo.io"),
    };
    expect((await purgeBusiness(deps, b.id, "no_subscription")).done).toBe(true);
    expect(await db.getBusiness(b.id)).toBeNull();
    return handler;
  }

  it.fails("V-QA-03 open: answers not found right after the deletion, also when it served the page a moment before", async () => {
    const handler = await seedAndServe(() => new Date());
    for (const path of ["/", "/llms.txt", "/feiten.json"]) {
      const after = await handler(new Request(`https://${HOST}${path}`));
      expect(after.status, `${path} after the deletion`).toBe(404);
    }
  });

  it("today's bound: after the 10-minute cache it answers not found", async () => {
    let t = Date.now();
    const handler = await seedAndServe(() => new Date(t));
    t += 11 * 60_000;
    expect((await handler(new Request(`https://${HOST}/`))).status).toBe(404);
  });
});
