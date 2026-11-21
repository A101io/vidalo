import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createDb, withMockDb, type Db } from "../src/db";
import { PRODUCT_LINE_LIMITS } from "../src/shared/product-lines";
import type { ProductLineData } from "../src/types";

/**
 * QA, feature 006 (ADR-0012, S-10): the active-line limit holds under concurrency.
 * The two-way race in db-product-lines.test.ts caught a PgDb saveProductLine without withLock in only 2 of 6 runs
 * (QA control, 21 Nov 2026). Here the race is run many times on fresh businesses, so a missing lock goes red on
 * practically every run. Runs on PgDb when TEST_DATABASE_URL is set (pnpm verify:pg), on MemDb always.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
let pg: Db | undefined;
const backends: [string, () => Promise<Db>][] = [["MemDb", async () => withMockDb()]];
if (PG_URL) {
  backends.push([
    "PgDb",
    async () => {
      const raw = postgres(PG_URL, { max: 1, onnotice: () => {} });
      await raw.unsafe("truncate claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist restart identity cascade");
      await raw.end();
      pg ??= createDb(PG_URL);
      return pg;
    },
  ]);
}
afterAll(async () => {
  await pg?.close();
});

const MAX = PRODUCT_LINE_LIMITS.lines;
const data = (name: string): ProductLineData => ({
  name,
  category: "persfittingsysteem",
  useCases: [],
  markets: ["NL"],
  specs: [],
  certificates: [],
  outlets: [],
  replaces: [],
  replacedBy: null,
});

describe.each(backends)("%s: the active-line limit under repeated races (QA)", (_n, makeDb) => {
  it("30 rounds of parallel saves and reactivations never leave more than the limit active", async () => {
    const db = await makeDb();
    for (let round = 0; round < 30; round++) {
      const b = await db.upsertBusiness({ name: `Race ${round}`, place: "Zwolle" });
      // One place left, then MAX + 1 saves at once: exactly one may win.
      for (let i = 0; i < MAX - 1; i++) expect((await db.saveProductLine({ businessId: b.id, productLineId: null, data: data(`Vast ${i}`), maxActive: MAX })).ok).toBe(true);
      const out = await Promise.all(
        Array.from({ length: MAX + 1 }, (_, i) => db.saveProductLine({ businessId: b.id, productLineId: null, data: data(`Nieuw ${i}`), maxActive: MAX })),
      );
      expect(out.filter((r) => r.ok)).toHaveLength(1);
      const lines = await db.listProductLines(b.id);
      expect(lines.filter((l) => l.status === "active")).toHaveLength(MAX);
      // Discontinue all, add MAX - 1 new ones (one place left), then reactivate every old one at once: exactly one may
      // come back. (With no place left, as in db-product-lines.test.ts, there is nothing to race and a missing lock passes.)
      for (const l of lines) await db.setProductLineStatus({ businessId: b.id, productLineId: l.id, status: "discontinued", maxActive: MAX });
      for (let i = 0; i < MAX - 1; i++) expect((await db.saveProductLine({ businessId: b.id, productLineId: null, data: data(`Vervanger ${i}`), maxActive: MAX })).ok).toBe(true);
      const back = await Promise.all(lines.map((l) => db.setProductLineStatus({ businessId: b.id, productLineId: l.id, status: "active", maxActive: MAX })));
      expect(back.filter((r) => r.ok)).toHaveLength(1);
      expect((await db.listProductLines(b.id)).filter((l) => l.status === "active")).toHaveLength(MAX);
    }
  }, 60_000);
});
