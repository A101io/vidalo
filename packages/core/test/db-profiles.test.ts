import { afterAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { withMockDb, createDb, type Db } from "../src/db";
import type { BusinessProfile } from "../src/types";
import type { QuestionUseInput } from "../src/db/types";

/**
 * Migration 0015 / BE-02. The shared cases run on MemDb and, when TEST_DATABASE_URL
 * carries supabase/migrations, on PgDb. The constraint and privilege cases need Postgres.
 */
const PG_URL = process.env.TEST_DATABASE_URL;
const TABLES = "question_use, google_index, claim, sample, fix, finding, channel, event, scan_run, prompt, facts, job, business, waitlist";

const profile = (over: Partial<BusinessProfile> = {}): BusinessProfile => ({
  mode: "online",
  offer: "achtergrondmuziek voor winkels",
  audience: "winkeliers",
  category: "aanbieder van achtergrondmuziek",
  competitors: ["Soundtrack Your Brand"],
  website: "sonable.io",
  confidence: "high",
  basis: ["google", "website"],
  source: "auto",
  grounded: true,
  decidedAt: "2026-11-11T09:00:00.000Z",
  ...over,
});

const use = (scanRunId: string, over: Partial<QuestionUseInput> = {}): QuestionUseInput => ({
  scanRunId,
  category: "aanbieder van achtergrondmuziek",
  mode: "online",
  templateKey: "online.rec_category.1",
  templateNl: "Welke {categorie} is het beste?",
  family: "rec_category",
  intent: "quality",
  asked: 10,
  usable: 8,
  ...over,
});

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

describe.each(backends)("%s: business profile and question library", (_n, makeDb) => {
  let db: Db;
  beforeEach(async () => {
    db = await makeDb();
  });

  it("setAutoProfile and setOwnerProfile each write only their own column; upsertBusiness writes neither", async () => {
    const b = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    expect(b.profileAuto).toBeNull();
    expect(b.profileOwner).toBeNull();
    await db.setAutoProfile(b.id, profile());
    let got = (await db.getBusiness(b.id))!;
    expect(got.profileAuto).toEqual(profile());
    expect(got.profileOwner).toBeNull();
    await db.setOwnerProfile(b.id, profile({ source: "owner", category: "muziekdienst" }));
    await db.setAutoProfile(b.id, profile({ category: "nieuwe automatische categorie" }));
    got = (await db.getBusiness(b.id))!;
    expect(got.profileOwner).toMatchObject({ source: "owner", category: "muziekdienst" });
    expect(got.profileAuto).toMatchObject({ category: "nieuwe automatische categorie" });
    await db.upsertBusiness({ id: b.id, slug: b.slug, name: b.name, place: b.place, status: "trial", profileAuto: null, profileOwner: null } as never);
    got = (await db.getBusiness(b.id))!;
    expect(got.profileAuto).not.toBeNull();
    expect(got.profileOwner).not.toBeNull();
  });

  it("a scan run keeps the profile it was created with; template_key travels with a prompt", async () => {
    const b = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    const run = await db.createScanRun({ businessId: b.id, kind: "baseline", engines: ["chatgpt"], samplesPerPrompt: 3, profile: profile() });
    expect(run.profile).toEqual(profile());
    expect((await db.getScanRun(run.id))?.profile).toEqual(profile());
    expect((await db.listScanRuns(b.id))[0]?.profile).toEqual(profile());
    const bare = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 3 });
    expect((await db.getScanRun(bare.id))?.profile ?? null).toBeNull();
    const [p, q] = await db.insertPrompts(b.id, [
      { category: "existence", textNl: "Welke aanbieder?", probes: ["existence:beste"], active: true, templateKey: "online.rec_category.1" },
      { category: "existence", textNl: "Wat doet Sonable?", probes: ["what:x"], active: true },
    ]);
    expect(p!.templateKey).toBe("online.rec_category.1");
    expect(q!.templateKey ?? null).toBeNull();
    expect((await db.listPrompts(b.id)).map((x) => x.templateKey ?? null).sort()).toEqual([null, "online.rec_category.1"].sort());
  });

  it("recordQuestionUse inserts one row per (run, template); a repeat changes nothing; the library sums per template", async () => {
    const b = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    const r1 = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 3 });
    const r2 = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 3 });
    await db.recordQuestionUse([use(r1.id), use(r1.id, { templateKey: "online.rec_category.2", asked: 5, usable: 1 })]);
    await db.recordQuestionUse([use(r1.id, { asked: 99, usable: 99 })]); // retry of the same run
    await db.recordQuestionUse([use(r2.id, { asked: 10, usable: 4 })]);
    await db.recordQuestionUse([]);
    const lib = await db.questionLibrary({ category: "aanbieder van achtergrondmuziek", mode: "online" });
    expect(lib).toHaveLength(2);
    expect(lib.find((x) => x.templateKey === "online.rec_category.1")).toMatchObject({ asked: 20, usable: 12, family: "rec_category", intent: "quality" });
    expect(lib.find((x) => x.templateKey === "online.rec_category.2")).toMatchObject({ asked: 5, usable: 1 });
    expect(await db.questionLibrary({ category: "iets anders" })).toEqual([]);
    expect(await db.questionLibrary({ mode: "door" })).toEqual([]);
    expect((await db.questionLibrary()).length).toBe(2);
    expect(lib.every((x) => x.businesses === 1)).toBe(true);
  });

  it("the library counts different businesses, not scans; deleting a business keeps the counts but unlinks the rows", async () => {
    const a = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    const b = await db.upsertBusiness({ name: "Mood", place: "Utrecht" });
    const runs = [await db.createScanRun({ businessId: a.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1 }), await db.createScanRun({ businessId: a.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1 }), await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1 })];
    for (const r of runs) await db.recordQuestionUse([use(r.id)]);
    expect((await db.questionLibrary())[0]).toMatchObject({ asked: 30, businesses: 2 });
    await db.deleteBusiness(a.id);
    expect((await db.questionLibrary())[0]).toMatchObject({ asked: 30, businesses: 2 });
    await db.deleteBusiness(b.id);
    expect((await db.questionLibrary())[0]).toMatchObject({ asked: 30, businesses: 2 });
  });
});

describe.skipIf(!PG_URL)("PgDb only: constraints, deletion and privileges of migration 0015", () => {
  let db: Db;
  let sql: ReturnType<typeof postgres>;
  beforeEach(async () => {
    db = await backends[1]![1]();
    sql = raw!;
  });

  const bad: [string, Partial<BusinessProfile>][] = [
    ["a mode outside door/visit/online", { mode: "shop" as never }],
    ["a 121-char offer", { offer: "x".repeat(121) }],
    ["an 81-char audience", { audience: "x".repeat(81) }],
    ["a 61-char category", { category: "x".repeat(61) }],
    ["four competitors", { competitors: ["a", "b", "c", "d"] }],
    ["markup in a slot", { offer: "<script>alert(1)</script>" }],
    ["a quote in a slot", { audience: 'say "hi"' }],
    ["a slash in a slot", { category: "a/b" }],
  ];

  it.each(bad)("business.profile_auto and profile_owner refuse %s", async (_label, over) => {
    const b = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    await expect(db.setAutoProfile(b.id, profile(over))).rejects.toThrow(/business_profile_auto_shape/);
    await expect(db.setOwnerProfile(b.id, profile(over))).rejects.toThrow(/business_profile_owner_shape/);
    const run = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1 }).catch(() => null);
    expect(run).not.toBeNull();
    await expect(db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1, profile: profile(over) })).rejects.toThrow(/scan_run_profile_shape/);
    expect((await db.getBusiness(b.id))?.profileAuto).toBeNull();
  });

  it("refuses a profile with no mode at all (a NULL check result would otherwise pass)", async () => {
    const b = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    await expect(sql`update business set profile_auto = '{"offer":"x"}'::jsonb where id = ${b.id}`).rejects.toThrow(/business_profile_auto_shape/);
  });

  it("accepts the boundary values", async () => {
    const b = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    await db.setAutoProfile(b.id, profile({ offer: "x".repeat(120), audience: "y".repeat(80), category: "z".repeat(60), competitors: ["a", "b", "c"] }));
    expect((await db.getBusiness(b.id))?.profileAuto?.offer).toHaveLength(120);
  });

  it("a prompt's template_key is capped at 80 characters", async () => {
    const b = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    await expect(db.insertPrompts(b.id, [{ category: "existence", textNl: "x", probes: [], active: true, templateKey: "k".repeat(81) }])).rejects.toThrow(/prompt_template_key_len/);
  });

  it("question_use refuses usable > asked, bad mode, bad family and an empty key", async () => {
    const b = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    const r = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1 });
    await expect(db.recordQuestionUse([use(r.id, { asked: 3, usable: 4 })])).rejects.toThrow(/check/);
    await expect(db.recordQuestionUse([use(r.id, { mode: "shop" as never })])).rejects.toThrow(/check/);
    await expect(db.recordQuestionUse([use(r.id, { family: "bogus" as never })])).rejects.toThrow(/check/);
    await expect(db.recordQuestionUse([use(r.id, { templateKey: "" })])).rejects.toThrow(/check/);
    expect(await db.questionLibrary()).toEqual([]);
  });

  it("deleting a business keeps its question_use rows with scan_run_id null, and nothing keeps the profile", async () => {
    const b = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    await db.setAutoProfile(b.id, profile({ offer: "uniekeaanbodtekst" }));
    await db.setOwnerProfile(b.id, profile({ offer: "uniekeaanbodtekst", source: "owner" }));
    const r = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1, profile: profile({ offer: "uniekeaanbodtekst" }) });
    await db.recordQuestionUse([use(r.id)]);
    await db.deleteBusiness(b.id);
    const rows = await sql`select scan_run_id, template_key from question_use`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scan_run_id).toBeNull();
    expect((await sql`select count(*)::int as n from business where profile_auto::text like '%uniekeaanbodtekst%' or profile_owner::text like '%uniekeaanbodtekst%'`)[0]!.n).toBe(0);
    expect((await sql`select count(*)::int as n from scan_run where profile::text like '%uniekeaanbodtekst%'`)[0]!.n).toBe(0);
    expect((await sql`select count(*)::int as n from question_use where to_jsonb(question_use)::text like '%uniekeaanbodtekst%' or to_jsonb(question_use)::text like '%Sonable%'`)[0]!.n).toBe(0);
  });

  it("after the business is deleted nothing left can tell which business a ledger row was (its question_ref is gone with it)", async () => {
    const b = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    const r = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1 });
    await db.recordQuestionUse([use(r.id)]);
    const ref = (await sql`select business_ref from question_use`)[0]!.business_ref as string;
    expect((await sql`select count(*)::int as n from business where question_ref = ${ref}`)[0]!.n).toBe(1);
    await db.deleteBusiness(b.id);
    expect((await sql`select count(*)::int as n from business where question_ref = ${ref}`)[0]!.n).toBe(0);
    expect((await sql`select count(*)::int as n from question_use where business_ref = ${ref}`)[0]!.n).toBe(1);
  });

  it("RLS is on for question_use and neither anon nor authenticated can read or write it or the view", async () => {
    expect((await sql`select relrowsecurity as on from pg_class where relname = 'question_use'`)[0]!.on).toBe(true);
    expect((await sql`select count(*)::int as n from pg_policies where tablename = 'question_use'`)[0]!.n).toBe(0);
    const b = await db.upsertBusiness({ name: "Sonable", place: "Utrecht" });
    const r = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 1 });
    await db.recordQuestionUse([use(r.id)]);
    // control: the owner (the test connection) sees the row
    expect((await sql`select count(*)::int as n from question_library`)[0]!.n).toBe(1);
    for (const role of ["anon", "authenticated"]) {
      for (const stmt of [
        "select count(*) from question_use",
        "select count(*) from question_library",
        "insert into question_use (category, mode, template_key, template_nl, family, asked, usable) values ('c','online','k','t','what',1,1)",
        "update question_use set asked = 0",
        "delete from question_use",
      ]) {
        const err = await sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`);
          await tx.unsafe(stmt);
        }).then(() => null, (e: Error) => e.message);
        expect(err, `${role}: ${stmt}`).toMatch(/permission denied/);
      }
    }
  });
});
