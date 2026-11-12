import { describe, expect, it } from "vitest";
import { questionSets } from "../src/scanner/question-sets";
import { business, facts } from "./worker-fixtures";

const db = { questionLibrary: async () => [] } as never;

describe("questionSets (free report: 'Dit was een steekproef')", () => {
  it("the free check is a part of the full check, and the full check asks more", async () => {
    const b = { ...business, sector: "horeca" as const, profileAuto: null, profileOwner: null };
    const { free, full } = await questionSets(db, b, { ...facts, sector: "horeca" }, new Date("2026-11-11"));
    const fullTexts = new Set(full.map((p) => p.textNl));
    expect(free.length).toBeGreaterThan(0);
    expect(full.length).toBeGreaterThan(free.length);
    for (const p of free) expect(fullTexts.has(p.textNl)).toBe(true);
    // sector questions the free check leaves out
    expect(full.some((p) => p.kind === "recommendation" && !free.some((f) => f.textNl === p.textNl))).toBe(true);
  });
});
