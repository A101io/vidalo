/**
 * BE-08 (feature 001): the CLI summary and out/scans/*.md of an online business say how the
 * business was read, list the questions as asked and name no town. A local business keeps its heading.
 */
import { describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { buildReport, prepareBusiness, runScan } from "../src/scanner";
import { markdownNl, summarizeNl } from "../src/cli/scan";

async function scanned(name: string, place: string) {
  const db = new MemDb();
  const p = await prepareBusiness({ name, place, db });
  const run = await runScan({ businessId: p.business.id, kind: "free", db });
  const report = await buildReport(run.scanRunId, db);
  const asked = new Set((await db.listSamples(run.scanRunId)).map((x) => x.promptId));
  const questions = (await db.listPrompts(p.business.id)).filter((x) => asked.has(x.id)).map((x) => x.textNl);
  return { report, questions };
}

describe("CLI summary of an online business", () => {
  it("heads with the name only, reads the business as a reading, lists the six questions, and says 'in <town>' nowhere", async () => {
    const { report, questions } = await scanned("Vloedlijn Music", "Utrecht");
    expect(report.profile?.mode).toBe("online");
    expect(questions).toHaveLength(6);
    for (const out of [summarizeNl(report, questions), markdownNl(report, questions)]) {
      expect(out).toContain("Gecontroleerd als: aanbieder van achtergrondmuziek voor hotels, restaurants en winkels, online");
      expect(out).toContain("Gestelde vragen");
      for (const q of questions) expect(out).toContain(q);
      expect(out).toMatch(/Zo lazen wij je bedrijf/);
    }
    const md = markdownNl(report, questions);
    expect(md.split("\n")[0]).toBe("# Vloedlijn Music");
    expect(summarizeNl(report, questions).split("\n")[0]).toBe("Vloedlijn Music");
    // the town is nowhere outside the names the mock AI made up for other businesses and the website it got wrong
    const own = md.split("\n").filter((l) => !/^- (Wat is een goed alternatief|Wat is de beste|Welke aanbieder)/.test(l) && !/website/.test(l)).join("\n");
    expect(own).not.toContain("Utrecht");
    expect(own).not.toMatch(/ in Utrecht/);
  });

  it("a finding line about another business or about nothing found says 'in <town>' only for a local business", async () => {
    for (const [name, place, online] of [["Vloedlijn Music", "Utrecht", true], ["Bakkerij De Vries", "Haarlem", false]] as const) {
      const { report } = await scanned(name, place);
      const base = report.findings[0]!;
      const other = { ...base, sourceType: "other_entity" as const, verdict: "wrong" as const };
      const nothing = { ...base, verdict: "not_found" as const, sourceType: "none" as const };
      const text = summarizeNl({ ...report, findings: [other, nothing], findingsBySeverity: { afhaker: [other, nothing], misleider: [], verwarring: [] } });
      expect(text.includes(`${name} in ${place}`)).toBe(!online);
      expect(text).toContain(`${name}`);
      expect(text).toMatch(/door elkaar met een ander bedrijf/);
      expect(text).toMatch(/vindt niets over/);
    }
  });

  it("a local business keeps its heading with the town, and gets no question list", async () => {
    const { report, questions } = await scanned("Bakkerij De Vries", "Haarlem");
    expect(summarizeNl(report, questions).split("\n")[0]).toBe("Bakkerij De Vries (Haarlem)");
    expect(markdownNl(report, questions).split("\n")[0]).toBe("# Bakkerij De Vries – Haarlem");
    expect(summarizeNl(report, questions)).not.toContain("Gestelde vragen");
    expect(summarizeNl(report, questions)).toContain("Gecontroleerd als: een bedrijf met een locatie waar klanten langskomen");
  });
});
