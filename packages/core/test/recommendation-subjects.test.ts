/**
 * BE-08 leftover (feature 001): every recommendation subject has its own label, in Dutch and in
 * English, wherever subjects are labelled. `existence:geschikt` (online "rec.audience") and
 * `existence:alternatief` used to fall back to "of het bedrijf open is".
 */
import { describe, expect, it } from "vitest";
import { ONLINE_SUBJECT } from "../src/prompts/online";
import { INTENT_SUBJECT } from "../src/types";
import { factLabelNl, findingWordsNl } from "../src/shared/facts-nl";
import { factLabelEn, findingWords } from "../src/shared/facts-en";
import { describeFact } from "../src/scanner/normalize";
import { copyFor } from "../src/copy";

const OPEN_NL = "of het bedrijf open is";
const OPEN_EN = "whether the business is open";
const ONLINE_ONLY = ["geschikt", "alternatief"] as const;
const subjects = [...new Set([...Object.values(INTENT_SUBJECT), ...Object.values(ONLINE_SUBJECT)])];

describe("labels of the recommendation subjects", () => {
  it("covers the subjects the online templates probe", () => {
    expect(subjects).toEqual(expect.arrayContaining(["beste", "betrouwbaar", "betaalbaar", "dichtbij", "geschikt", "alternatief"]));
  });

  it.each(subjects)("existence:%s is not labelled as being open (NL and EN)", (s) => {
    expect(factLabelNl("existence", s)).not.toBe(OPEN_NL);
    expect(factLabelEn("existence", s)).not.toBe(OPEN_EN);
    expect(factLabelNl("existence", s)).toMatch(/genoemd/);
    expect(factLabelEn("existence", s)).toMatch(/named/);
  });

  it.each(subjects)("existence:%s has a question for the stored-prompt fallback in both languages", (s) => {
    for (const lang of ["nl", "en"] as const) {
      const q = copyFor(lang).recommendation.question.intent[s];
      expect(q, `${lang} ${s}`).toBeTypeOf("function");
      expect(q!("Utrecht").length).toBeGreaterThan(5);
    }
  });

  it.each(ONLINE_ONLY)("the online subject %s names no town and no opening hours", (s) => {
    for (const lang of ["nl", "en"] as const) {
      const q = copyFor(lang).recommendation.question.intent[s]!("Utrecht");
      expect(q).not.toMatch(/Utrecht|open|buurt|in de buurt|near/i);
    }
    expect(factLabelNl("existence", s)).not.toMatch(/buurt|open/);
    expect(factLabelEn("existence", s)).not.toMatch(/nearby|open/);
  });

  it.each(ONLINE_ONLY)("a not-named finding for %s says the business is active, not open in this town", (s) => {
    const f = { factKey: "existence" as const, subject: s, wrongValue: "niet genoemd", correctValue: "open", frequency: 3, sampleCount: 4, evidenceKind: "recommendation" as const };
    expect(findingWordsNl(f).correct).toBe("je bent actief");
    expect(findingWords(f, "en").correct).toBe("you are active");
    // the local subjects keep their wording
    expect(findingWordsNl({ ...f, subject: "beste" }).correct).toBe("je bent open en werkt in deze plaats");
  });

  it("the CLI label for the two online subjects is not 'open of gesloten'", () => {
    for (const s of ONLINE_ONLY) expect(describeFact("existence", s)).not.toBe("open of gesloten");
    expect(describeFact("existence", null)).toBe("open of gesloten");
  });
});
