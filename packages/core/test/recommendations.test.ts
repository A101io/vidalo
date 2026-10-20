import { describe, expect, it } from "vitest";
import { namedBusinesses, promotionCandidates, summarizeRecommendations } from "../src/scanner/recommendations";
import { promptsForFullScan, rotatingPrompts, ROTATE_PER_SCAN } from "../src/prompts/rotation";
import { seasonOf, type Prompt, type RecommendationSummary } from "../src/types";

describe("namedBusinesses", () => {
  it("reads names from numbered and bulleted lists, bold names and markdown links", () => {
    const answer = [
      "Een paar goede opties in Rotterdam:",
      "1. **Golden Dragon** – bekend om de dim sum.",
      "2. [Wah Nam Hong](https://wahnamhong.nl): groot aanbod.",
      "3. Restaurant Asia (Rotterdam-Zuid), betaalbaar",
      "- Tip: reserveer op vrijdag.",
      "Ook **Dim Sum Palace** krijgt goede reviews.",
    ].join("\n");
    expect(namedBusinesses(answer)).toEqual(["Golden Dragon", "Wah Nam Hong", "Restaurant Asia", "Dim Sum Palace"]);
  });

  it("skips labels, questions and duplicates", () => {
    expect(namedBusinesses("- **Openingstijden**: 9-17\n- Adres: Markt 1\n1. Jansen\n2. jansen\n3. Wie is open?")).toEqual(["Jansen"]);
  });
});

describe("summarizeRecommendations", () => {
  const prompts = [
    { id: "p1", textNl: "Wat is het beste restaurant in Rotterdam?", kind: "recommendation", intent: "quality", pool: "core", probes: ["existence:beste"] },
    { id: "p2", textNl: "Is Golden Dragon in Rotterdam open?", kind: "about", intent: null, pool: "core", probes: ["existence"] },
    { id: "p3", textNl: "Waar kan ik lekker eten in Rotterdam?", kind: "recommendation", intent: "quality", pool: "bank", probes: ["existence:beste"] },
  ] as Pick<Prompt, "id" | "textNl" | "kind" | "intent" | "pool" | "probes">[];
  const samples = [
    { id: "s1", promptId: "p1", answerText: "1. Wah Nam Hong\n2. Dim Sum Palace\n3. Golden Dragon", citations: ["https://www.tripadvisor.nl/x", "https://rotterdam.nl/top10"] },
    { id: "s2", promptId: "p1", answerText: "1. Wah Nam Hong\n2. Restaurant Asia", citations: ["https://tripadvisor.nl/y"] },
    { id: "s3", promptId: "p3", answerText: "- **Wah Nam Hong**\n- **Fu Lu Shou**", citations: [] },
    { id: "s4", promptId: "p3", answerText: "1. Fu Lu Shou", citations: [] },
    { id: "s5", promptId: "p3", answerText: "1. Fu Lu Shou", citations: [] },
    { id: "s6", promptId: "p2", answerText: "Ja, open.", citations: [] },
  ];
  const verdicts = new Map([["s1", "correct"], ["s2", "wrong"], ["s3", "wrong"], ["s4", "wrong"], ["s5", "wrong"], ["s6", "correct"]]);
  const summaries = summarizeRecommendations({ samples, prompts, verdicts, facts: { name: "Golden Dragon", place: "Rotterdam" } });

  it("counts named answers, other names and cited sites per recommendation question, core first", () => {
    expect(summaries.map((s) => s.promptId)).toEqual(["p1", "p3"]);
    expect(summaries[0]).toMatchObject({ answers: 2, named: 1, intent: "quality", pool: "core", probe: "existence:beste" });
    expect(summaries[0]!.others).toEqual([
      { name: "Wah Nam Hong", answers: 2 },
      { name: "Dim Sum Palace", answers: 1 },
      { name: "Restaurant Asia", answers: 1 },
    ]);
    expect(summaries[0]!.sources[0]).toMatchObject({ host: "tripadvisor.nl", answers: 2 });
  });

  it("promotes a bank question where the business is mostly not named", () => {
    expect(promotionCandidates(summaries)).toEqual(["p3"]);
    const few = summaries.map((s) => ({ ...s, answers: 2 })) as RecommendationSummary[];
    expect(promotionCandidates(few)).toEqual([]);
  });
});

describe("rotation", () => {
  const bank = Array.from({ length: 20 }, (_, i) => ({ textNl: `Vraag ${String(i).padStart(2, "0")}?`, pool: "bank" as const, season: null }));
  const seasonal = [
    { textNl: "Terras in de zon?", pool: "bank" as const, season: "zomer" as const },
    { textNl: "Verwarming kapot?", pool: "bank" as const, season: "winter" as const },
  ];
  const core = [{ textNl: "Kern?", pool: "core" as const, season: null }];

  it("knows the season", () => {
    expect(seasonOf(new Date("2026-01-10"))).toBe("winter");
    expect(seasonOf(new Date("2026-04-10"))).toBe("lente");
    expect(seasonOf(new Date("2026-07-10"))).toBe("zomer");
    expect(seasonOf(new Date("2026-10-10"))).toBe("herfst");
    expect(seasonOf(new Date("2026-12-10"))).toBe("winter");
  });

  it("asks a different slice each month and covers the whole bank over a few months", () => {
    const seen = new Set<string>();
    let previous: string[] = [];
    for (let m = 0; m < 4; m++) {
      const picked = rotatingPrompts(bank, new Date(Date.UTC(2026, 3 + m, 15)));
      expect(picked).toHaveLength(ROTATE_PER_SCAN);
      expect(picked.map((p) => p.textNl)).not.toEqual(previous);
      previous = picked.map((p) => p.textNl);
      for (const p of picked) seen.add(p.textNl);
    }
    expect(seen.size).toBe(bank.length);
  });

  it("puts in-season questions first and leaves out-of-season ones out", () => {
    const july = rotatingPrompts([...bank, ...seasonal], new Date("2026-07-15")).map((p) => p.textNl);
    expect(july[0]).toBe("Terras in de zon?");
    expect(july).not.toContain("Verwarming kapot?");
    const full = promptsForFullScan([...core, ...bank, ...seasonal], new Date("2026-01-15"));
    expect(full[0]!.textNl).toBe("Kern?");
    expect(full[1]!.textNl).toBe("Verwarming kapot?");
    expect(full).toHaveLength(1 + ROTATE_PER_SCAN);
  });
});

describe("namedParagraph (mails)", () => {
  it("lists who AI named instead, for fixed questions where the business was left out, without jargon", async () => {
    const { namedParagraph } = await import("../src/reporter/templates");
    const recs: RecommendationSummary[] = [
      { promptId: "a", prompt: "Wat is de beste bakker in Haarlem?", intent: "quality", pool: "core", probe: "existence:beste", answers: 9, named: 1, others: [{ name: "Bakkerij Van der Berg", answers: 7 }], sources: [{ host: "tripadvisor.nl", url: "https://tripadvisor.nl", answers: 6 }] },
      { promptId: "b", prompt: "Welke bakker in Haarlem is op zondag open?", intent: "now", pool: "core", probe: "hours.6", answers: 9, named: 9, others: [{ name: "X", answers: 1 }], sources: [] },
      { promptId: "c", prompt: "Waar haal ik oliebollen in Haarlem?", intent: "specialty", pool: "bank", probe: "service:oliebollen", answers: 9, named: 0, others: [{ name: "Y", answers: 9 }], sources: [] },
    ];
    const text = namedParagraph(recs);
    expect(text).toContain("Wie AI wel noemt");
    expect(text).toContain("Vraag: Wat is de beste bakker in Haarlem?");
    expect(text).toContain("Jij: in 1 van de 9 antwoorden");
    expect(text).toContain("Wel genoemd: Bakkerij Van der Berg (7×)");
    expect(text).toContain("Haalt het uit: tripadvisor.nl");
    expect(text).not.toContain("zondag");
    expect(text).not.toContain("oliebollen");
    expect(text).not.toMatch(/!|\b(GEO|AEO|LLM|prompt|credits|zichtbaarheid|platform|agent|score)\b/i);
    expect(namedParagraph([])).toBe("");
  });
});
