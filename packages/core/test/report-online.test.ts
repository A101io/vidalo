import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { copy, copyFor } from "../src/copy/index.js";
import type { ScanReport } from "../src/types.js";
import { buildReportView } from "../../../apps/web/lib/report";
import { demoGreyReport, demoOnlineReport, demoReport } from "../../../apps/web/lib/demo";

/**
 * Feature 001, FE-02: the report of an online business. The competition block is counts only, the
 * dot is untouched, the heading has no town, the plan panel promises no listing work. Fixtures are
 * built here from the types, with fictional names (compliance C-30).
 */
const BAD = /%|#\d|\bplek\b|\bscore\b|\branking\b|\brank\b|share of voice|\bGEO\b|\bAEO\b|\bLLM\b|\bprompt\b|platform|zichtbaarheid|visibility/i;
const LISTING = /google|bing|apple|gids|gidsen|director|vestiging/i;

const online = (): ScanReport => structuredClone(demoOnlineReport());
const langs = [
  ["nl", copy],
  ["en", copyFor("en")],
] as const;

describe("online report view", () => {
  for (const [lang, c] of langs) {
    describe(lang, () => {
      it("counts per question add up, and the summary adds the rows", () => {
        const r = online();
        const v = buildReportView(r, c);
        const rows = r.recommendations!;
        expect(v.competition!.questions).toHaveLength(rows.length);
        rows.forEach((row, i) => {
          const q = v.competition!.questions[i]!;
          expect(q.question).toBe(row.prompt);
          expect(q.you).toContain(`${row.named} `);
          expect(q.you).toContain(`${row.answers} `);
          expect(row.named + (row.answers - row.named)).toBe(row.answers);
        });
        const n = rows.reduce((s, x) => s + x.named, 0);
        const m = rows.reduce((s, x) => s + x.answers, 0);
        expect(v.competition!.summary).toBe(c.result.competition.summary(n, m));
        expect(v.competition!.summary).toContain(`${n} `);
        expect(v.competition!.summary).toContain(`${m} `);
      });

      it("names:0 still lists the names, and the block has no score, percentage, position or rank word", () => {
        const v = buildReportView(online(), c);
        const zero = v.competition!.questions.find((q) => q.you.includes(" 0 "))!;
        expect(zero.others.length).toBeGreaterThan(0);
        const text = JSON.stringify([v.competition, v.checkedAs, v.checkedAsNote, v.h1]);
        expect(text).not.toMatch(BAD);
      });

      it("shows at most 5 others and 3 quotes per question", () => {
        const r = online();
        const row = r.recommendations![0]!;
        row.others = Array.from({ length: 9 }, (_, i) => ({ name: `Fictief Bedrijf ${i}`, answers: 9 - i }));
        row.quotes = Array.from({ length: 5 }, (_, i) => ({ text: `Zin ${i}`, engine: "chatgpt" as const }));
        const q = buildReportView(r, c).competition!.questions[0]!;
        expect(q.others).toHaveLength(5);
        expect(q.quotes).toHaveLength(3);
        expect(q.quotes[0]!.engine).toContain("ChatGPT");
      });

      it("the dot is not changed by the block (stip passes through)", () => {
        const r = online();
        for (const row of r.recommendations!) row.named = 0;
        expect(buildReportView(r, c).stip).toBe(r.stip);
      });

      it("the heading and every question line are free of the town", () => {
        const r = online();
        const v = buildReportView(r, c);
        expect(v.h1).toContain(r.business.name);
        expect(v.h1).not.toContain(r.business.place);
        for (const row of v.rows) expect(row.question).not.toContain(r.business.place);
        for (const a of v.all) expect(a.question).not.toContain(r.business.place);
        expect(v.rows.some((x) => x.question === (lang === "nl" ? "Wat doet Vloedlijn Audio?" : "What does Vloedlijn Audio do?"))).toBe(true);
        expect(v.rows.some((x) => x.said === c.report.value.otherKind)).toBe(true);
        expect(v.profile).toBeNull();
        expect(v.named).toEqual([]);
      });

      it("Checked as: reads the profile in the page's words, as Vidalo's reading", () => {
        const v = buildReportView(online(), c);
        expect(v.checkedAs).toBe(c.result.checkedAs.line(`aanbieder van achtergrondmuziek ${c.result.checkedAs.forAudience("hotels en horeca")}, ${c.result.checkedAs.mode.online}`));
        expect(v.checkedAsNote).toBe(c.result.checkedAs.how.auto);
      });

      it("an owner profile is worded as such; an online business that could not be read says so and how to fix it (ADR-0007); a fallback with a listing shows the mode words only", () => {
        const r = online();
        r.profile = { ...r.profile!, source: "fallback" };
        const v = buildReportView(r, c);
        expect(v.checkedAs).toBe(c.result.checkedAs.neutral.line);
        expect(v.checkedAsNote).toBe(c.result.checkedAs.neutral.how);
        expect(v.checkedAsNeutral).toBe(true);
        expect(v.checkedAs).not.toContain("achtergrondmuziek");
        r.profile = { ...r.profile!, mode: "door", source: "fallback" };
        const listed = buildReportView(r, c);
        expect(listed.checkedAs).toBe(c.result.checkedAs.line(c.result.checkedAs.modeOnly.door));
        expect(listed.checkedAsNeutral).toBe(false);
        r.profile = { ...r.profile!, mode: "online", source: "owner" };
        expect(buildReportView(r, c).checkedAsNote).toBe(c.result.checkedAs.how.owner);
        expect(buildReportView(r, c).checkedAsNeutral).toBe(false);
      });

      it("the plan panel promises no Google, Bing, Apple or directory work in any state, and says one business", () => {
        const base = online();
        const red = { ...base };
        const green: ScanReport = { ...base, stip: "groen", findings: [], wrongAnswers: 0 };
        const grey: ScanReport = { ...base, stip: "grijs", visibility: "unknown", findings: [], correct: [], wrongAnswers: 0, notFoundAnswers: 11 };
        for (const r of [red, green, grey]) {
          const v = buildReportView(r, c, { domain: "vloedlijn-audio.example" });
          const text = [v.plan.h2, ...v.plan.steps.map((s) => s.text), v.plan.note ?? "", v.plan.excl, ...v.sources.map((s) => s.label)].join("\n");
          expect(text).not.toMatch(LISTING);
          expect(v.plan.excl).toMatch(/^1 (bedrijf|business)/);
        }
      });

      it("a text from AI renders as the same plain text: no markup is made of it", () => {
        const r = online();
        const evil = ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "javascript:alert(1)"];
        r.recommendations![0]!.quotes = [{ text: `Vloedlijn Audio ${evil.join(" ")}`, engine: "chatgpt" }];
        r.recommendations![0]!.others = [{ name: evil[0]!, answers: 3 }];
        const v = buildReportView(r, c);
        expect(v.competition!.questions[0]!.quotes[0]!.text).toBe(`Vloedlijn Audio ${evil.join(" ")}`);
        expect(v.competition!.questions[0]!.others[0]!.name).toBe(evil[0]);
      });
    });
  }

  it("an older report (no profile) renders as before: no block, no line, the town in the heading", () => {
    const r = demoReport();
    const v = buildReportView(r, copy);
    expect(r.profile).toBeUndefined();
    expect(v.checkedAs).toBeNull();
    expect(v.competition).toBeNull();
    expect(v.h1).toContain("Haarlem");
    expect(v.named.length).toBeGreaterThan(0);
    expect(v.profile).toContain("Haarlem");
  });

  it("a local report is unchanged by its profile except for the Checked as line", () => {
    for (const make of [demoReport, demoGreyReport]) {
      const without = buildReportView(make(), copy);
      for (const mode of ["door", "visit"] as const) {
        const withProfile = buildReportView({ ...make(), profile: { mode, offer: null, audience: null, category: "bakker", source: "auto" } }, copy);
        expect(withProfile.checkedAs).toContain("Gecontroleerd als: bakker");
        expect({ ...withProfile, checkedAs: null, checkedAsNote: null }).toEqual(without);
      }
    }
  });

  it("a report with no category or alternative question has no block", () => {
    const r = online();
    r.recommendations = [];
    expect(buildReportView(r, copy).competition).toBeNull();
  });

  it("the page renders strings as React text only", () => {
    const page = readFileSync(new URL("../../../apps/web/app/r/[id]/page.tsx", import.meta.url), "utf8");
    expect(page).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
  });
});
