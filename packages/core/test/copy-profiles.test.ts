import { describe, expect, it } from "vitest";
import { copy, copyFor } from "../src/copy/index.js";
import { buildKnowledge } from "../src/chat/index.js";

/**
 * Feature 001 (business profiles), AC-7: every new customer-facing string is free of the
 * forbidden words and of any promise that Vidalo makes AI name the business.
 * The keys are listed explicitly. FE-01 (waiting page), FE-02 (report) and FE-03 (profile form)
 * add their own keys to PROFILE_KEYS when they add copy.
 */
const BANNED = /\b(GEO|AEO|LLM|prompt|platform|zichtbaarheid|visibility|ranking|share of voice|score)\b|%|#\d/i;
const PROMISE = /(zorgen dat|we make sure|garanderen|guarantee).{0,40}(genoemd|named|aanbevolen|recommended)/i;

const FAQ_NL = "Werkt dit ook als ik geen winkel heb?";
const FAQ_EN = "Does this work if I have no shop?";

type C = ReturnType<typeof copyFor>;
const PROFILE_KEYS: Record<string, (c: C, lang: "nl" | "en") => string[]> = {
  "landing.werkt.steps[0].body (FE-04)": (c) => [c.landing.werkt.steps[0].body],
  "landing.werkt.steps[2].body (FE-04)": (c) => [c.landing.werkt.steps[2].body],
  "result.competition (FE-02)": (c) => {
    const k = c.result.competition;
    return [k.h2, k.body, k.summary(4, 30), k.summary(0, 1), k.you(0, 12), k.others, k.times(3, 12), k.quotesTitle, k.quoteBy("ChatGPT"), k.quotesNote, k.note, k.demoCaption];
  },
  "result.checkedAs (FE-02)": (c) => {
    const k = c.result.checkedAs;
    return [k.line("x"), k.forAudience("x"), ...Object.values(k.mode), ...Object.values(k.modeOnly), ...Object.values(k.how), k.fixOwner, k.fixOther];
  },
  "result.hero online headings (FE-02)": (c) => [c.result.hero.h1Online("X", "rood"), c.result.hero.h1Online("X", "groen"), c.result.hero.h1GreyOnline("X"), c.result.hero.h1UncheckedOnline("X")],
  "result.plan.online (FE-02)": (c) => {
    const o = c.result.plan.online;
    return [o.stepFacts(null), o.stepFacts("x.nl"), ...o.stepsGreen, o.stepsGrey.facts, o.stepsGrey.publish(null), o.stepsGrey.recheck(6), o.exclVat, o.exclVatGrey];
  },
  "report.identity kind lines (FE-02)": (c) => [c.report.question.identityKind("X"), c.report.value.otherKind, c.report.value.sameKind],
  "mails.online (BE-08)": (c) => {
    const k = c.mails.online;
    const w = k.welcome;
    return [k.notCounted, k.reading, k.howWeFix.title, ...k.howWeFix.items.flatMap((i) => [i.when, i.what]), w.subject("X"), w.preheader, w.intro("X"), w.facts.title, w.facts.line, w.rest.title, w.rest.line];
  },
  "recommendation.question.intent geschikt, alternatief (BE-08)": (c) => [c.recommendation.question.intent.geschikt!("x"), c.recommendation.question.intent.alternatief!("x")],
  "landing.vragen.items[no shop] (FE-04)": (c, lang) => {
    const item = c.landing.vragen.items.find((i) => i.q === (lang === "nl" ? FAQ_NL : FAQ_EN));
    return item ? [item.q, item.a] : [];
  },
  "scan.stages (FE-01)": (c) => [c.scan.stages.understand, c.scan.stages.choose, c.scan.stages.ask([]), c.scan.stages.ask(["ChatGPT"]), c.scan.stages.ask(["ChatGPT", "Google AI"]), c.scan.stages.compare, c.scan.stages.done],
  "scan.choose website field (ADR-0007)": (c) => [c.scan.choose.websiteTitle, c.scan.choose.websiteLabel, c.scan.choose.websiteHint, c.scan.choose.websiteError],
  "result.checkedAs.neutral (ADR-0007)": (c) => [c.result.checkedAs.neutral.line, c.result.checkedAs.neutral.how],
  "scan.live (FE-01)": (c) => Object.values(c.scan.live),
  "scan.state, answers, moreQuestions, refresh (FE-01)": (c) => [...Object.values(c.scan.state), c.scan.answers(1), c.scan.answers(7), c.scan.moreQuestions(1), c.scan.moreQuestions(4), c.scan.refresh],
  "scan.profileSentence (FE-01)": (c) => [
    c.scan.profileSentence({ offer: "achtergrondmuziek", audience: "hotels", category: null }, "Sonable") ?? "",
    c.scan.profileSentence({ offer: "background music", audience: null, category: null }, "Sonable") ?? "",
    c.scan.profileSentence({ offer: null, audience: null, category: "bakkerij" }, "De Vries") ?? "",
  ],
  "facts.profile (FE-03)": (c) => {
    const k = c.facts.profile;
    const d = "11 november 2026";
    return [
      k.title, k.intro, k.modeLegend, ...Object.values(k.modes).flatMap((m) => [m.label, m.hint]), k.offer, k.offerHint, k.audience, k.audienceHint, k.category, k.categoryHint,
      k.sourceAuto(d), k.sourceOwner(d), k.sourceFallback(d), k.sourceNone, k.submit, k.saved, k.errorTitle,
      ...Object.values(k.errors.required), ...Object.values(k.errors.refused), k.errors.tooLong(120),
    ];
  },
};

describe("copy of feature 001: jargon and promises", () => {
  for (const lang of ["nl", "en"] as const) {
    const c = copyFor(lang);
    for (const [key, get] of Object.entries(PROFILE_KEYS)) {
      it(`${lang} ${key} has text, no forbidden word, no promise`, () => {
        const strings = get(c, lang);
        expect(strings.length).toBeGreaterThan(0);
        for (const s of strings) {
          expect(s.length).toBeGreaterThan(0);
          expect(s).not.toMatch(BANNED);
          expect(s).not.toMatch(PROMISE);
          expect(s).not.toContain("!");
        }
      });
    }
  }

  it("the patterns catch what they are meant to catch", () => {
    for (const bad of ["ons ranking", "je score", "30% van de keren", "#1 in ChatGPT", "better visibility", "een prompt"]) {
      expect(bad).toMatch(BANNED);
    }
    expect("We zorgen dat AI je noemt, genoemd worden is gegarandeerd").toMatch(/zorgen dat.{0,40}genoemd/i);
    expect("We make sure AI gets you named").toMatch(PROMISE);
    expect("Wij garanderen dat je genoemd wordt").toMatch(PROMISE);
    expect("We guarantee you are recommended").toMatch(PROMISE);
    expect("Of AI je noemt, kunnen wij niet bepalen").not.toMatch(PROMISE);
  });

  it("the assistant knows the new FAQ entry in both languages", () => {
    expect(buildKnowledge(copy, "nl")).toContain(FAQ_NL);
    expect(buildKnowledge(copyFor("en"), "en")).toContain(FAQ_EN);
  });
});
