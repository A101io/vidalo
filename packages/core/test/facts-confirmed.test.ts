import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared/db";
import { publishFactsPage } from "../src/publisher";
import { clearServeCache, createFactsHandler } from "../src/publisher/serve";
import { facts } from "./worker-fixtures";

// A facts page says "zoals vastgelegd door de eigenaar". Until the owner has
// confirmed facts, the draft the free check made from Google is neither
// published nor served; after confirmation it is (control).
describe("facts page before and after the owner confirms", () => {
  let db: MemDb;
  const HOST = "feiten.bakkerijjansen.nl";
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    clearServeCache(HOST);
    process.env.VIDALO_OUT_DIR = "out/test";
  });

  const get = () => createFactsHandler()(new Request(`https://${HOST}/`, { headers: { host: HOST } }));

  it("waits with only the draft, then publishes and serves the confirmed version", async () => {
    const b = await db.upsertBusiness({ name: "Bakkerij Jansen", place: "Haarlem", status: "active", factsHost: HOST, factsHostVerifiedAt: "2026-10-01T10:00:00.000Z" });
    await db.insertFacts(b.id, { ...facts, phone: "023-1111111", verifiedAt: null }, { provisional: true });

    const waiting = await publishFactsPage(b.id);
    expect(waiting).toMatchObject({ waiting: true, factsVersion: 0 });
    expect((await db.listEvents(b.id)).some((e) => e.type === "facts_page.waiting")).toBe(true);
    expect((await get()).status).not.toBe(200);

    await db.insertFacts(b.id, { ...facts, phone: "023-2222222" }, { provisional: false, verifiedAt: "2026-11-06T10:00:00.000Z" });
    const published = await publishFactsPage(b.id);
    expect(published.waiting).toBeUndefined();
    expect(published.factsVersion).toBe(2);
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("023-1111111");

    // A newer draft (a later free check) does not replace the confirmed page.
    await db.insertFacts(b.id, { ...facts, phone: "023-3333333", verifiedAt: null }, { provisional: true });
    clearServeCache(HOST);
    expect(await (await get()).text()).not.toContain("023-3333333");
  });
});
