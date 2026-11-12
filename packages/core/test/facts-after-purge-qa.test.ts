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
      expireOpenCheckouts: async () => 0,
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

  it("V-QA-03: answers not found right after the deletion, also when it served the page a moment before", async () => {
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

describe("V-QA-03: a cached page follows the business", () => {
  it("a churn is redirected at once, not after the cache", async () => {
    const db = new MemDb();
    setDb(db);
    clearServeCache();
    const b = await db.upsertBusiness({ name: "Bakkerij Eind", place: "Haarlem", plan: "monitor", status: "active", factsHost: HOST, factsHostVerifiedAt: "2026-10-01T10:00:00.000Z", domain: "bakkerijeind.nl" });
    await db.insertFacts(b.id, { ...facts, businessId: b.id, name: "Bakkerij Eind", website: "bakkerijeind.nl" }, { verifiedAt: "2026-10-01T10:00:00.000Z" });
    const handler = createFactsHandler();
    const first = await handler(new Request(`https://${HOST}/`));
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("public, max-age=60");
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, status: "churned" });
    const after = await handler(new Request(`https://${HOST}/`));
    expect(after.status).toBe(302);
  });
});
