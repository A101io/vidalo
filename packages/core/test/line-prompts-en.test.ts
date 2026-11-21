import { describe, expect, it } from "vitest";
import { LINE_TEMPLATES, lineTemplates } from "../src/prompts/line";
import { LINE_TEMPLATES_EN } from "../src/prompts/line.en";

const slotsOf = (text: string) => [...text.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]!).sort();

/** Feature 006 BE-03: a change to line.ts is made in line.en.ts too, like sectors.ts and sectors.en.ts. */
describe("line question templates: Dutch and English in step", () => {
  it("have the same keys in the same order", () => {
    expect(LINE_TEMPLATES_EN.map((t) => t.key)).toEqual(LINE_TEMPLATES.map((t) => t.key));
    expect(LINE_TEMPLATES.map((t) => t.key)).toEqual(["line.rec.use", "line.rec.quality", "line.spec", "line.cert", "line.outlet", "line.successor"]);
  });

  it("have the same kind, category, probe and criterium per key", () => {
    LINE_TEMPLATES.forEach((t, i) => {
      const en = LINE_TEMPLATES_EN[i]!;
      expect({ kind: en.kind, category: en.category, probe: en.probe, criterium: en.criterium }, t.key).toEqual({ kind: t.kind, category: t.category, probe: t.probe, criterium: t.criterium });
    });
  });

  it("use the same slots per key (the probe's slots are among them)", () => {
    LINE_TEMPLATES.forEach((t, i) => {
      expect(slotsOf(LINE_TEMPLATES_EN[i]!.text), t.key).toEqual(slotsOf(t.text));
      for (const s of slotsOf(t.probe)) if (s !== "spec_label" && s !== "market") expect(slotsOf(t.text), `${t.key} probe slot ${s}`).toContain(s);
    });
  });

  it("have non-empty texts and pick the table by scan language", () => {
    for (const t of [...LINE_TEMPLATES, ...LINE_TEMPLATES_EN]) expect(t.text.length).toBeGreaterThan(10);
    expect(lineTemplates("nl")).toBe(LINE_TEMPLATES);
    expect(lineTemplates("en")).toBe(LINE_TEMPLATES_EN);
    expect(LINE_TEMPLATES_EN.map((t) => t.text).join(" ")).not.toMatch(/\b(van|heeft|Welk|Waar koop)\b/);
  });
});
