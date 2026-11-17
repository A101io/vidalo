/**
 * Feature 005, CMP-04 and CMP-08: a business Google does not list was checked on its name and town. The report mail says an
 * answer may be about a namesake; an online business gets the line without naming Google (BE-08).
 */
import { describe, expect, it } from "vitest";
import { baselineSummaryEmail, followUpEmail } from "../src/reporter/templates";
import { copy, copyFor } from "../src/copy/index.js";
import { finding } from "./worker-fixtures";

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

describe("the follow-up's inbox layer for a possible namesake (CMP-11) and no claimed re-check (CMP-10)", () => {
  const closed = { ...finding, factKey: "website" as const, subject: null, wrongValue: "definitief-gesloten.nl", correctValue: "vloedlijn.nl", sourceType: "none" as const, sourceUrl: null, criterium: 8 as const };
  const fu = { business: base.business, wrongAnswers: 2, totalAnswers: 12, example: closed, links: { ...base.links, resultUrl: "https://vidalo.ai/r/x", unsubscribeUrl: "https://vidalo.ai/u" }, priceSetupEur: 149, priceMonitorEur: 49 };
  for (const day of [7, 21] as const) {
    it(`day ${day}: without a listing the wrong value stays out of subject, preview and headline, but is in the body`, () => {
      const m = followUpEmail({ ...fu, notListed: true, profile: local }, day);
      expect(m.subject).not.toContain("definitief-gesloten.nl");
      expect(m.html.match(/<div style="display:none[^>]*>([^<]*)/)?.[1] ?? "").not.toContain("definitief-gesloten.nl");
      expect(m.text.split("\n").slice(0, 3).join(" ")).not.toContain("definitief-gesloten.nl");
      expect(m.text).toContain("definitief-gesloten.nl");
      expect(m.text).toContain(copy.result.namesake);
    });
  }
  it("a listed business keeps the quote in the day-21 subject", () => {
    expect(followUpEmail({ ...fu, notListed: false, profile: local }, 21).subject).toContain("definitief-gesloten.nl");
  });
  it("day 21 never says it checked again today", () => {
    for (const lang of ["nl", "en"] as const) {
      const m = followUpEmail({ ...fu, lang, profile: local }, 21);
      expect(`${m.subject} ${m.text}`).not.toMatch(/opnieuw gecontroleerd|nog steeds|staat er nog|checked it again|still/i);
    }
  });
});

describe("the namesake line in the follow-up mails (day 7 and 21, QA-R2-04)", () => {
  const fu = { business: base.business, wrongAnswers: 2, totalAnswers: 12, example: null, links: { ...base.links, resultUrl: "https://vidalo.ai/r/x", unsubscribeUrl: "https://vidalo.ai/u" }, priceSetupEur: 149, priceMonitorEur: 49 };
  for (const day of [7, 21] as const) {
    it(`day ${day}: local without a listing gets it, online gets the version without Google, listed and neutral get none`, () => {
      expect(followUpEmail({ ...fu, notListed: true, profile: local }, day).text).toContain(copy.result.namesake);
      expect(followUpEmail({ ...fu, lang: "en", notListed: true, profile: local }, day).text).toContain(copyFor("en").result.namesake);
      const on = followUpEmail({ ...fu, online: true, notListed: true, profile: online }, day).text;
      expect(on).toContain(copy.result.namesakeOnline);
      expect(on).not.toContain(copy.result.namesake);
      expect(followUpEmail({ ...fu, notListed: false, profile: local }, day).text).not.toContain(copy.result.namesake);
      expect(followUpEmail({ ...fu, notListed: true, profile: neutral }, day).text).not.toContain(copy.result.namesake);
    });
  }
});
