/**
 * Mock seed for the owner area (lane B): runs after seedDomainStatus. Mock only. Idempotent.
 *  - a second business on the demo owner's login (Amsterdam), with a finished check, so the switcher shows;
 *  - a third business on another login (ander@example.nl, mock-user-2) as the control that must never be
 *    listed, chosen or reached by a changed value.
 *  - an English-speaking login (owner@harbour.example, mock-user-3) with two businesses whose language is "en",
 *    so the switcher and the archive can be checked in English without touching the shared demo owner
 *    (an owner's pages follow business.language, so /en/app for a Dutch business goes back to /app).
 * The demo owner's own businesses are older/newer on purpose: Haarlem stays the newest, so it is the
 * default active business and every existing page and test sees what it saw before.
 */
import type { Db } from "@vidalo/core/db";
import { backfillRunSummaries, prepareBusiness, runScan, createMockEngine } from "@vidalo/core/scanner";
import { ENGINES } from "@vidalo/core/types";
import { openFixesForScan } from "@vidalo/core/fixer";
import { DEMO_OWNER_EMAIL, DEMO_SLUG } from "./demo";

export const DEMO_SECOND = { slug: "bakkerij-de-vries-amsterdam", name: "Bakkerij de Vries", place: "Amsterdam" } as const;
export const DEMO_CONTROL = { slug: "kapsalon-ander-utrecht", name: "Kapsalon Ander", place: "Utrecht", email: "ander@example.nl", userId: "mock-user-2" } as const;

export const DEMO_EN = {
  email: "owner@harbour.example",
  userId: "mock-user-3",
  first: { name: "Harbour Bakery", place: "Rotterdam" },
  second: { name: "Harbour Bakery", place: "Leiden" },
} as const;

async function oneFreeCheck(db: Db, businessId: string, at: string, wrongPairRate = 0.2): Promise<string> {
  const clients = (["chatgpt", "google_ai", "perplexity"] as const).map((e) => createMockEngine(e, { wrongPairRate }));
  const report = await runScan({ businessId, kind: "free", samplesPerPrompt: 3, clients, db });
  await db.updateScanRun(report.scanRunId, { startedAt: at, finishedAt: at });
  return report.scanRunId;
}

/** Back-date a business so Haarlem stays the newest of the demo owner's businesses (list order is newest first). */
async function setCreatedAt(db: Db, businessId: string, iso: string): Promise<void> {
  if (db.kind === "mem") {
    const mem = db as unknown as { businesses: Map<string, { createdAt: string }> };
    const row = mem.businesses.get(businessId);
    if (row) row.createdAt = iso;
  } else {
    const sql = (db as unknown as { sql: (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }).sql;
    await sql`update business set created_at = ${iso} where id = ${businessId}`;
  }
}

/**
 * More kinds of check on the demo owner's main business, for the archive: an extra (on-demand) check, a
 * recheck and a check that failed, dated between the last two monthly checks so the dashboard's "latest
 * check" and the progress view keep what they showed. The free check from seven months ago is the owner's
 * old free report that must still open for the owner (AC-1); the seed's history already holds it.
 */
async function archiveKinds(db: Db, businessId: string): Promise<void> {
  const runs = (await db.listScanRuns(businessId, 50)).filter((r) => r.status === "done").sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const last = runs[runs.length - 1];
  const before = runs[runs.length - 2];
  if (!last || !before) return;
  const mid = (k: number) => new Date(Date.parse(before.startedAt) + ((Date.parse(last.startedAt) - Date.parse(before.startedAt)) * k) / 4).toISOString();
  const clients = (["chatgpt", "google_ai", "perplexity"] as const).map((e) => createMockEngine(e, { wrongPairRate: 0.1 }));
  // A scan reads the business again and would replace the profile the demo seed set (shown on /app/gegevens): put it back.
  const profileAuto = (await db.getBusiness(businessId))?.profileAuto ?? null;
  const extra = await runScan({ businessId, kind: "ondemand", engines: ENGINES, samplesPerPrompt: 3, clients, db });
  await db.updateScanRun(extra.scanRunId, { startedAt: mid(1), finishedAt: mid(1) });
  if (profileAuto) await db.setAutoProfile(businessId, profileAuto);
  const recheck = await db.createScanRun({ businessId, kind: "recheck", engines: ["chatgpt"], samplesPerPrompt: 3, status: "done" });
  await db.updateScanRun(recheck.id, { startedAt: mid(2), finishedAt: mid(2) });
  const failed = await db.createScanRun({ businessId, kind: "monthly", engines: ["chatgpt"], samplesPerPrompt: 3, status: "failed" });
  await db.updateScanRun(failed.id, { status: "failed", startedAt: mid(3), finishedAt: mid(3), error: "mock: the AI system did not answer" });
}

export async function seedOwnerArea(db: Db): Promise<void> {
  const main = await db.getBusiness(DEMO_SLUG);
  if (!main || (await db.getBusiness(DEMO_SECOND.slug))) return;
  await archiveKinds(db, main.id);
  const earlier = new Date(Date.parse(main.createdAt) - 86_400_000).toISOString();

  const second = (await prepareBusiness({ name: DEMO_SECOND.name, place: DEMO_SECOND.place, db })).business;
  await db.upsertBusiness({ id: second.id, slug: second.slug, name: second.name, place: second.place, ownerEmail: DEMO_OWNER_EMAIL, ownerUserId: "mock-user-1", plan: "monitor", status: "trial" });
  await oneFreeCheck(db, second.id, new Date(Date.now() - 3 * 86_400_000).toISOString());
  await setCreatedAt(db, second.id, earlier);

  const control = (await prepareBusiness({ name: DEMO_CONTROL.name, place: DEMO_CONTROL.place, db })).business;
  await db.upsertBusiness({ id: control.id, slug: control.slug, name: control.name, place: control.place, ownerEmail: DEMO_CONTROL.email, ownerUserId: DEMO_CONTROL.userId, plan: "monitor", status: "trial" });
  await oneFreeCheck(db, control.id, new Date().toISOString());

  // English login: Leiden is created first (older), Rotterdam second, so Rotterdam is the default. Both have proven
  // ownership, so the owner's buttons work (saving facts, "Check now", "I fixed this"), and both have findings to act on.
  for (const place of [DEMO_EN.second, DEMO_EN.first]) {
    const b = (await prepareBusiness({ name: place.name, place: place.place, db })).business;
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ownerEmail: DEMO_EN.email, ownerUserId: DEMO_EN.userId, plan: "monitor", status: "trial", language: "en", ownerVerifiedAt: new Date().toISOString(), ownerVerifiedVia: "mock" });
    const run = await oneFreeCheck(db, b.id, new Date(Date.now() - 86_400_000).toISOString(), 0.6);
    // The fix round the worker runs after a check: a fix per open finding, so "I fixed this" has something to recheck.
    if (db.kind === "mem") await openFixesForScan(run);
  }

  // The summaries the scanner stored were taken when the checks ran; the seed back-dates them, so redo them with the dates.
  await backfillRunSummaries(db, { all: true });
}
