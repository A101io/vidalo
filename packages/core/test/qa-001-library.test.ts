/**
 * QA, feature 001, verify round 1 (2026-11-15): the question library after a template is retired.
 * recordScanUse (src/prompts/library.ts) builds `wasRetired` from a filter that reads `wasRetired` itself, so the
 * moment any template of the category is already retired, every later scan throws a ReferenceError after the rows
 * are written; the catch logs `library.record_failed`, and a second template that retires later is never logged as
 * `library.retired` (the existing "logs it once" test passes because of this throw). See V1-QA-03.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withMockDb, type Db } from "../src/db";
import { libraryStatus } from "../src/prompts/library";
import { loadPrompts, runScan } from "../src/scanner";
import type { EngineClient } from "../src/scanner/engines/types";
import type { BusinessProfile, Facts } from "../src/types";
import { sampleFacts } from "./scanner-fixtures";

const NOW = new Date("2026-03-15T12:00:00.000Z");
const CATEGORY = "aanbieder van achtergrondmuziek";
const profile = (): BusinessProfile => ({
  mode: "online", offer: "achtergrondmuziek voor winkels", audience: "winkeliers", category: CATEGORY, competitors: [], website: null,
  confidence: "high", basis: ["website"], source: "auto", grounded: true, decidedAt: "2026-11-11T08:00:00.000Z",
});
const onlineFacts = (name: string): Facts =>
  sampleFacts({ name, place: "Utrecht", address: null, postcode: null, phone: null, hours: [], servicesYes: [], servicesNo: [], prices: [], policies: [], paymentMethods: [], profile: profile() });

const client = (usable: (key: string) => boolean): EngineClient => ({
  engine: "chatgpt",
  available: () => true,
  ask: async (_t, ctx) => {
    const key = ctx.prompt?.templateKey ?? "";
    if (ctx.prompt?.kind === "recommendation") return { answerText: usable(key) ? "1. Mood Media\n2. Soundtrack Your Brand" : "Daar heb ik geen informatie over.", citations: [], costCents: 0 };
    return { answerText: "Ja, dat bedrijf bestaat en is actief.", citations: [], costCents: 0 };
  },
});

async function scanOnline(db: Db, name: string, usable: (key: string) => boolean) {
  const facts = onlineFacts(name);
  const b = await db.upsertBusiness({ name: facts.name, place: facts.place });
  await db.insertFacts(b.id, { ...facts, businessId: b.id }, { provisional: false, verifiedAt: "2026-11-11T08:00:00.000Z" });
  await db.setOwnerProfile(b.id, { ...facts.profile!, source: "owner" });
  const chosen = await loadPrompts(db, b.id, facts, "baseline", null, undefined, NOW, facts.profile);
  await runScan({ businessId: b.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 2, firstSamples: 2, clients: [client(usable)], db, promptIds: chosen.map((x) => x.id) });
  return b;
}
const row = async (db: Db, key: string) => (await db.questionLibrary({ category: CATEGORY, mode: "online" })).find((r) => r.templateKey === key)!;

describe("QA 001: the library ledger after a retirement (MemDb)", () => {
  let db: Db;
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("VIDALO_MOCK", "1");
    db = withMockDb();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("control: ten businesses retire online.rec.price and log library.retired once", async () => {
    for (let i = 1; i <= 10; i++) await scanOnline(db, `Zaak ${i}`, (k) => k !== "online.rec.price");
    expect(libraryStatus(await row(db, "online.rec.price"))).toBe("retired");
    expect(await db.countEventsSince("library.retired", new Date(0))).toBe(1);
    expect(await db.countEventsSince("library.record_failed", new Date(0))).toBe(0);
  });

  // V1-QA-03: fails today. Observed: the eleventh scan logs library.record_failed (ReferenceError on wasRetired, swallowed).
  it.fails("the scan after a retirement records without a library.record_failed event (fails today, V1-QA-03)", async () => {
    for (let i = 1; i <= 10; i++) await scanOnline(db, `Zaak ${i}`, (k) => k !== "online.rec.price");
    const b11 = await scanOnline(db, "Zaak 11", (k) => k !== "online.rec.price");
    expect((await db.listEvents(b11.id, 100)).filter((e) => e.type === "library.record_failed")).toEqual([]);
  });

  // V1-QA-03: fails today. A second template that falls below the line later is never logged, so it is never "listed for Julian" as an event.
  it.fails("a second template retired later is logged too (fails today, V1-QA-03)", async () => {
    // price fails from the start; trust works for the first five businesses, then stops giving usable answers
    for (let i = 1; i <= 10; i++) await scanOnline(db, `Zaak ${i}`, (k) => k !== "online.rec.price");
    for (let i = 11; i <= 40; i++) await scanOnline(db, `Zaak ${i}`, (k) => k !== "online.rec.price" && k !== "online.rec.trust");
    expect(libraryStatus(await row(db, "online.rec.trust"))).toBe("retired");
    expect(await db.countEventsSince("library.retired", new Date(0))).toBe(2);
  });

  it("observed today: the rows are still written (the throw comes after recordQuestionUse), the error is logged per scan", async () => {
    for (let i = 1; i <= 10; i++) await scanOnline(db, `Zaak ${i}`, (k) => k !== "online.rec.price");
    const before = (await row(db, "online.alt.self")).asked;
    await scanOnline(db, "Zaak 11", (k) => k !== "online.rec.price");
    await scanOnline(db, "Zaak 12", (k) => k !== "online.rec.price");
    expect((await row(db, "online.alt.self")).asked).toBe(before + 4);
    expect(await db.countEventsSince("library.record_failed", new Date(0))).toBe(2);
  });
});
