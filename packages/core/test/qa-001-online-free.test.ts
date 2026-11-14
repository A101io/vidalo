/**
 * QA, feature 001, verify round 1 (2026-11-15). Checks through the real scan path in mock mode:
 * AC-2 / AC-A5 for "Sonable, Rotterdam" with and without a website (ADR-0007), AC-5 on a report the
 * scanner built (not the demo), and an honest name that trips the instruction-word list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withMockDb } from "../src/db";
import { copy, copyFor } from "../src/copy/index.js";
import { createMockEngine } from "../src/scanner/engines";
import { runScan } from "../src/scanner";
import { prepareBusiness } from "../src/scanner/onboard";
import { NL_CITIES } from "../src/scanner/extract";
import { buildReportView } from "../../../apps/web/lib/report";

const ENGINES = ["chatgpt", "gemini", "perplexity"] as const;
const clients = () => ENGINES.map((e) => createMockEngine(e));
const SHOP_FRONT = /openingstijd|zondag|\bopen\b|pinnen|betal|adres|telefoon/i;
const BAD = /%|#\d|\bplek\b|\bscore\b|\branking\b|\brank\b|positie|position/i;

describe("QA 001: a free check of Sonable, Rotterdam through runScan (mock mode)", () => {
  beforeEach(() => {
    vi.stubEnv("VIDALO_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in QA"));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  async function freeCheck(website?: string) {
    const db = withMockDb();
    const prep = await prepareBusiness({ name: "Sonable", place: "Rotterdam", ...(website ? { website } : {}), db });
    let asked: string[] = [];
    const report = await runScan({
      businessId: prep.business.id, kind: "free", engines: [...ENGINES], clients: clients(), db,
      onProgress: (ev) => { if (ev.type === "questions") asked = ev.questions.map((q) => q.text); },
    });
    const samples = await db.listSamples(report.scanRunId);
    const prompts = await db.listPrompts(prep.business.id);
    const askedIds = new Set(samples.map((s) => s.promptId));
    const askedTexts = prompts.filter((p) => askedIds.has(p.id)).map((p) => p.textNl);
    return { db, report, asked, askedTexts, samples };
  }

  it("AC-2/AC-A5 with sonable.io given on /scan/kies: 6 questions, none with a town or a shop-front topic", async () => {
    const { report, asked, askedTexts } = await freeCheck("https://sonable.io");
    expect(report.profile).toMatchObject({ mode: "online", source: "auto" });
    expect(asked).toHaveLength(6);
    expect(new Set(askedTexts)).toEqual(new Set(asked));
    expect(asked[0]).toBe("Bestaat Sonable nog?");
    expect(asked).toContain("Wat doet Sonable?");
    expect(asked).toContain("Wat is de website van Sonable?");
    expect(asked).toContain("Wat is een goed alternatief voor Sonable?");
    const category = asked.filter((q) => !q.includes("Sonable"));
    expect(category).toHaveLength(2);
    for (const q of asked) {
      expect(q).not.toMatch(SHOP_FRONT);
      for (const city of NL_CITIES) expect(q).not.toMatch(new RegExp(`(?<![\\p{L}])${city}(?![\\p{L}])`, "iu"));
    }
  });

  it("ADR-0007 without a website: the neutral set of 3, shown unchecked (AC-2's '6 questions' does not hold for this input)", async () => {
    const { report, asked } = await freeCheck();
    expect(report.profile).toMatchObject({ mode: "online", source: "fallback" });
    expect(asked).toEqual(["Bestaat Sonable nog?", "Wat doet Sonable?", "Wat is de website van Sonable?"]);
    expect(report.findings).toEqual([]);
  });

  it("AC-5 on a report the scanner built: per question named + 'without' = answers = samples of that question, <= 5 others, <= 3 quotes with an engine, no % or rank (NL and EN)", async () => {
    const { report, samples } = await freeCheck("https://sonable.io");
    const rows = (report.recommendations ?? []).filter((r) => r.family === "rec_category" || r.family === "alternative");
    expect(rows.length).toBe(3);
    for (const r of rows) {
      const n = samples.filter((s) => s.promptId === r.promptId).length;
      expect(r.answers).toBe(n);
      expect(r.named).toBeGreaterThanOrEqual(0);
      expect(r.named).toBeLessThanOrEqual(r.answers);
      for (const o of r.others) expect(o.answers).toBeLessThanOrEqual(r.answers);
    }
    for (const c of [copy, copyFor("en")]) {
      const v = buildReportView(report, c);
      expect(v.competition).not.toBeNull();
      expect(v.competition!.questions).toHaveLength(rows.length);
      v.competition!.questions.forEach((q, i) => {
        const r = rows[i]!;
        expect(q.you).toBe(c.result.competition.you(r.named, r.answers));
        expect(q.others.length).toBeLessThanOrEqual(5);
        expect(q.quotes.length).toBeLessThanOrEqual(3);
        for (const quote of q.quotes) expect(quote.engine.length).toBeGreaterThan(0);
      });
      const named = rows.reduce((s, r) => s + r.named, 0);
      const answers = rows.reduce((s, r) => s + r.answers, 0);
      expect(v.competition!.summary).toBe(c.result.competition.summary(named, answers));
      expect(JSON.stringify(v.competition)).not.toMatch(BAD);
      // local "Wie AI wel noemt" is not shown for an online business
      expect(v.named).toEqual([]);
    }
  });
});

describe("QA 001: an honest name with an instruction word and no listing", () => {
  beforeEach(() => {
    vi.stubEnv("VIDALO_MOCK", "1");
    vi.stubEnv("OPENAI_API_KEY", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  // V1-QA-02: typedBusinessProblem lets "Prompt Uitzendbureau" through (honest name), but every online/neutral template
  // needs the name slot, which sanitizeSlot refuses, so the check asks nothing and still finishes.
  it.fails("asks at least one question (fails today: 0 questions, see V1-QA-02)", async () => {
    const db = withMockDb();
    const prep = await prepareBusiness({ name: "Prompt Uitzendbureau", place: "Utrecht", db });
    expect(prep.business.googlePlaceId).toBeNull();
    let asked: string[] = [];
    const report = await runScan({
      businessId: prep.business.id, kind: "free", engines: ["chatgpt"], clients: [createMockEngine("chatgpt")], db,
      onProgress: (ev) => { if (ev.type === "questions") asked = ev.questions.map((q) => q.text); },
    });
    expect((await db.getScanRun(report.scanRunId))!.status).toBe("done");
    expect(asked.length).toBeGreaterThan(0);
  });
});
