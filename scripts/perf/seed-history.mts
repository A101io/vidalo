/**
 * Seeds the database that `pnpm verify:pg` builds (or any LOCAL Postgres carrying the migrations) with two businesses for
 * the owner-page timings (feature 002, B-03 / AC-7):
 *   perf-groot  36 monthly checks, each 10 questions × 5 AI systems × 10 answers with claims, 500 findings, 2,000 events
 *   perf-klein  3 checks
 * Both are summarised per check (migration 0017) and owned by a mock login (scripts/perf/owner-pages.mts signs in as them).
 *
 *   DATABASE_URL=postgresql://postgres@localhost:5432/vidalo_verify pnpm tsx scripts/perf/seed-history.mts
 *
 * Refuses a database that is not on this machine: the root .env points at production and tsx does not read it, but a pasted URL could.
 */
import { createDb } from "@vidalo/core/db";
import { seedHistory } from "../../packages/core/test/helpers/counting-db.ts";

export const PERF_OWNERS = {
  groot: { email: "perf-groot@example.nl", userId: "aaaaaaaa-0000-4000-8000-000000000001", name: "Perf Groot", place: "Haarlem" },
  klein: { email: "perf-klein@example.nl", userId: "aaaaaaaa-0000-4000-8000-000000000002", name: "Perf Klein", place: "Leiden" },
} as const;

export function assertLocal(url: string | undefined): string {
  if (!url) throw new Error("DATABASE_URL is not set. Pass the local verify:pg database on purpose; this script never reads .env.");
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(host)) throw new Error(`Refusing ${host}: the timings run on a local database only.`);
  return url;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const db = createDb(assertLocal(process.env.DATABASE_URL));
  try {
    for (const [key, o] of Object.entries(PERF_OWNERS)) {
      if (await db.getBusiness(`${o.name.toLowerCase().replace(/ /g, "-")}-${o.place.toLowerCase()}`)) {
        console.log(`${o.name}: already there, left as it is`);
        continue;
      }
      const t = Date.now();
      const big = key === "groot";
      const { runIds } = await seedHistory(db, { name: o.name, place: o.place, checks: big ? 36 : 3, findings: big ? 500 : 20, events: big ? 2000 : 40, answers: 10, samplesForEvery: true, ownerUserId: o.userId, ownerEmail: o.email });
      console.log(`${o.name}: ${runIds.length} checks seeded in ${Math.round((Date.now() - t) / 1000)} s`);
    }
  } finally {
    await db.close();
  }
}
