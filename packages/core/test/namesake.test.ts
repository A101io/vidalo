/**
 * Feature 005, CMP-04 and CMP-08: a business Google does not list was checked on its name and town. The report mail says an
 * answer may be about a namesake; an online business gets the line without naming Google (BE-08).
 */
import { describe, expect, it } from "vitest";
import { baselineSummaryEmail } from "../src/reporter/templates";
import { copy, copyFor } from "../src/copy/index.js";

const base = {
  business: { name: "Vloedlijn", place: "Utrecht" },
  checkedAt: "2026-11-16T20:00:00Z",
  totalAnswers: 12,
  wrongAnswers: 0,
  notFoundAnswers: 0,
  visibility: "found" as const,
  findings: [],
  engines: ["chatgpt", "google_ai"] as ("chatgpt" | "google_ai")[],
  links: { dashboardUrl: "https://vidalo.ai/app", factsPageUrl: "https://vidalo.ai/feiten", resultUrl: "https://vidalo.ai/r/x" },
  stip: "groen" as const,
};
const local = { mode: "door" as const, source: "auto" as const, offer: "brood", audience: null, category: "bakkerij" };
const online = { mode: "online" as const, source: "auto" as const, offer: "achtergrondmuziek", audience: "hotels", category: "aanbieder van achtergrondmuziek" };
const neutral = { mode: "online" as const, source: "fallback" as const, offer: null, audience: null, category: null };

describe("the namesake line in the report mail", () => {
  it("is there for a local business Google does not list, in NL and EN", () => {
    const nl = baselineSummaryEmail({ ...base, notListed: true, profile: local });
    expect(nl.text).toContain(copy.result.namesake);
    expect(nl.html).toContain("We vonden dit bedrijf niet op Google");
    expect(baselineSummaryEmail({ ...base, lang: "en", notListed: true, profile: local }).text).toContain(copyFor("en").result.namesake);
  });

  it("is there without Google for an online business (CMP-08, BE-08)", () => {
    const m = baselineSummaryEmail({ ...base, notListed: true, online: true, profile: online });
    expect(m.text).toContain(copy.result.namesakeOnline);
    expect(m.text).not.toContain(copy.result.namesake);
  });

  it("is not there for a business read by nothing: its mail already judges no answer", () => {
    const m = baselineSummaryEmail({ ...base, notListed: true, online: true, profile: neutral });
    expect(m.text).not.toContain(copy.result.namesake);
    expect(m.text).not.toContain(copy.result.namesakeOnline);
  });

  it("is not there for a listed business", () => {
    expect(baselineSummaryEmail({ ...base, profile: local }).text).not.toContain(copy.result.namesake);
    expect(baselineSummaryEmail({ ...base, notListed: false, profile: local }).text).not.toContain(copy.result.namesake);
  });
});
