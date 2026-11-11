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
import { prepareBusiness, runScan, createMockEngine } from "@vidalo/core/scanner";
import { DEMO_OWNER_EMAIL, DEMO_SLUG } from "./demo";

export const DEMO_SECOND = { slug: "bakkerij-de-vries-amsterdam", name: "Bakkerij de Vries", place: "Amsterdam" } as const;
export const DEMO_CONTROL = { slug: "kapsalon-ander-utrecht", name: "Kapsalon Ander", place: "Utrecht", email: "ander@example.nl", userId: "mock-user-2" } as const;

export const DEMO_EN = {
  email: "owner@harbour.example",
  userId: "mock-user-3",
  first: { name: "Harbour Bakery", place: "Rotterdam" },
  second: { name: "Harbour Bakery", place: "Leiden" },
} as const;

async function oneFreeCheck(db: Db, businessId: string, at: string): Promise<string> {
  const clients = (["chatgpt", "google_ai", "perplexity"] as const).map((e) => createMockEngine(e, { wrongPairRate: 0.2 }));
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

export async function seedOwnerArea(db: Db): Promise<void> {
  const main = await db.getBusiness(DEMO_SLUG);
  if (!main || (await db.getBusiness(DEMO_SECOND.slug))) return;
  const earlier = new Date(Date.parse(main.createdAt) - 86_400_000).toISOString();

  const second = (await prepareBusiness({ name: DEMO_SECOND.name, place: DEMO_SECOND.place, db })).business;
  await db.upsertBusiness({ id: second.id, slug: second.slug, name: second.name, place: second.place, ownerEmail: DEMO_OWNER_EMAIL, ownerUserId: "mock-user-1", plan: "monitor", status: "trial" });
  await oneFreeCheck(db, second.id, new Date(Date.now() - 3 * 86_400_000).toISOString());
  await setCreatedAt(db, second.id, earlier);

  const control = (await prepareBusiness({ name: DEMO_CONTROL.name, place: DEMO_CONTROL.place, db })).business;
  await db.upsertBusiness({ id: control.id, slug: control.slug, name: control.name, place: control.place, ownerEmail: DEMO_CONTROL.email, ownerUserId: DEMO_CONTROL.userId, plan: "monitor", status: "trial" });
  await oneFreeCheck(db, control.id, new Date().toISOString());

  // English login: Leiden is created first (older), Rotterdam second, so Rotterdam is the default.
  for (const place of [DEMO_EN.second, DEMO_EN.first]) {
    const b = (await prepareBusiness({ name: place.name, place: place.place, db })).business;
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, ownerEmail: DEMO_EN.email, ownerUserId: DEMO_EN.userId, plan: "monitor", status: "trial", language: "en" });
    await oneFreeCheck(db, b.id, new Date(Date.now() - 86_400_000).toISOString());
  }
}
