/**
 * BE-08 (feature 001): the mails of an online business. No town, no opening hours, no Google, Bing,
 * Apple or directories; the profile as "Gecontroleerd als"; the competition block as counts only;
 * the same counts as the report; escaped like every other interpolation (security S-34).
 * Names here are made up (compliance C-30).
 */
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared";
import { buildReport, prepareBusiness, runScan } from "../src/scanner";
import { baselineSummaryEmail, followUpEmail, monthlyReportEmail, notFoundParagraph, welcomeEmail, type Mail } from "../src/reporter/templates";
import { sendBaselineSummary, sendFollowUp, sendMonthlyReport, sendWelcome } from "../src/reporter";
import { competitionCountsOf, isUncheckedGrey, uncheckedAnswersOf, type ProfileSummary } from "../src/types";
import { business as paidBusiness, finding } from "./worker-fixtures";

const NAME = "Vloedlijn Music";
const PLACE = "Utrecht";
const profile: ProfileSummary = { mode: "online", offer: "achtergrondmuziek voor hotels", audience: "hotels en horeca", category: "aanbieder van achtergrondmuziek", source: "auto" };
const links = { dashboardUrl: "https://vidalo.ai/app", factsPageUrl: "https://vidalo.ai/feiten/x", resultUrl: "https://vidalo.ai/r/x" };
const biz = { name: NAME, place: PLACE };
const NAMED_ELSEWHERE = "Voorbeeld Klankwerk";

/** What an online mail must never say, in either language. "Google AI" is an AI system, not Google. */
const LOCAL_WORDS = /openingstijd|opening hours|vestiging|branch\b|\bBing\b|\bApple\b|Google(?! AI)|\bgids|directories|directory|bedrijfsprofiel|business profile|Adres, telefoon|Address, phone/i;
/** No score, percentage, position or promise (compliance C-29, C-34). */
const NO_SCORE = /%|score|ranking|share of voice|#\d|\bplek\b|positie|position|we make sure|zorgen dat/i;

const recs = [
  { promptId: "p1", prompt: `Wat is een goed alternatief voor ${NAME}?`, intent: "alternative" as const, family: "alternative" as const, quotes: [], pool: "core" as const, probe: "existence:alternatief", answers: 4, named: 2, others: [{ name: NAMED_ELSEWHERE, answers: 3 }], sources: [] },
  { promptId: "p2", prompt: "Wat is de beste aanbieder van achtergrondmuziek?", intent: "quality" as const, family: "rec_category" as const, quotes: [], pool: "core" as const, probe: "existence:beste", answers: 4, named: 1, others: [{ name: NAMED_ELSEWHERE, answers: 2 }], sources: [] },
];

function base(over: Partial<Parameters<typeof baselineSummaryEmail>[0]> = {}): Parameters<typeof baselineSummaryEmail>[0] {
  return {
    business: biz,
    checkedAt: "2026-11-11T08:00:00Z",
    totalAnswers: 12,
    wrongAnswers: 1,
    findings: [{ ...finding, factKey: "website", subject: null, wrongValue: "vloedlijn-music-utrecht.com", correctValue: "vloedlijn-music.io", sourceType: "none", sourceUrl: null, criterium: 8 }],
    engines: ["chatgpt", "google_ai"],
    links,
    stip: "oranje",
    online: true,
    profile,
    competition: competitionCountsOf({ recommendations: recs }),
    recommendations: recs,
    ...over,
  };
}
/** What a reader sees: subject, plain text and the HTML without its tags (a CSS font stack names -apple-system). */
/** The plain-text part of a written .eml, with its headers (the HTML part carries CSS font stacks). */
const plain = (eml: string) => eml.split("Content-Type: text/html")[0]!;
const all = (m: Mail) => `${m.subject}\n${m.text}\n${m.html.replace(/<[^>]*>/g, " ").replace(/&#\d+;/g, "")}`;

describe("competitionCountsOf", () => {
  it("counts the category and alternative questions only, never the town questions, and says nothing without them", () => {
    const town = { ...recs[0]!, family: "rec_town" as const, answers: 10, named: 10 };
    expect(competitionCountsOf({ recommendations: [...recs, town] })).toEqual({ named: 3, answers: 8, questions: 2 });
    expect(competitionCountsOf({ recommendations: [town] })).toBeNull();
    expect(competitionCountsOf({})).toBeNull();
  });
});

describe("free-check mail of an online business", () => {
  for (const lang of ["nl", "en"] as const) {
    describe(lang, () => {
      const m = baselineSummaryEmail(base({ lang }));
      it("names no town, no local wording and no listing work", () => {
        expect(all(m)).not.toContain(PLACE);
        expect(all(m)).not.toMatch(LOCAL_WORDS);
      });
      it("shows the profile as Vidalo's reading, with the Gecontroleerd-als line", () => {
        expect(m.text).toContain(lang === "en" ? "Checked as: aanbieder van achtergrondmuziek for hotels en horeca, online" : "Gecontroleerd als: aanbieder van achtergrondmuziek voor hotels en horeca, online");
        expect(m.text).toMatch(lang === "en" ? /our reading of your business, not a fact/ : /onze lezing van je bedrijf, geen feit/);
      });
      it("shows the competition as counts only: n of m, no name of another business, no score", () => {
        expect(m.text).toContain(lang === "en" ? "Named in 3 of 8 answers" : "Genoemd in 3 van 8 antwoorden");
        expect(all(m)).not.toContain(NAMED_ELSEWHERE);
        expect(all(m)).not.toMatch(NO_SCORE);
      });
      it("leaves the colour to the facts: the competition card does not touch the dot", () => {
        expect(m.text).toMatch(lang === "en" ? /Dot: orange/ : /Stip: oranje/);
      });
    });
  }

  it("a local business keeps its mail text for text: names of others, Google, Bing and Apple", () => {
    const m = baselineSummaryEmail(base({ online: false, profile: null, competition: null }));
    expect(m.text).toContain(NAMED_ELSEWHERE);
    expect(m.text).toMatch(/Google, Bing, Apple/);
    expect(m.text).not.toContain("Gecontroleerd als");
    expect(m.text).not.toContain("Genoemd in 3 van 8");
  });

  it("a fallback reading names the kind of business only (compliance B4)", () => {
    const m = baselineSummaryEmail(base({ profile: { ...profile, source: "fallback", offer: "iets uit het niets", category: null, audience: null } }));
    expect(m.text).toContain("Gecontroleerd als: een online bedrijf");
    expect(m.text).not.toContain("iets uit het niets");
    expect(m.text).toMatch(/konden je bedrijf niet met zekerheid lezen/);
  });

  it("escapes the profile and the name (security S-34)", () => {
    const evil = `<img src=x onerror=alert(1)> & "q"`;
    const m = baselineSummaryEmail(base({ business: { name: evil, place: PLACE }, profile: { ...profile, category: evil, audience: "<script>x</script>", offer: evil } }));
    expect(m.html).not.toMatch(/<img|<script/i);
    expect(m.html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;");
    expect(m.html).toContain("&lt;script&gt;x&lt;/script&gt;");
  });

  it("grey for answers that could not be checked is never 'AI kent je niet'", () => {
    for (const lang of ["nl", "en"] as const) {
      const m = baselineSummaryEmail(base({ lang, findings: [], wrongAnswers: 0, stip: "grijs", uncheckedAnswers: 12, uncheckedQuestions: 3, uncheckedGrey: true, visibility: "found" }));
      expect(all(m)).not.toMatch(/kent je niet|vindt \(bijna\) niets|does not know you|finds (almost )?nothing/i);
      expect(all(m)).not.toMatch(lang === "en" ? /answers are right|were right/ : /antwoorden kloppen\b(?! niet)/);
      expect(all(m)).not.toMatch(LOCAL_WORDS);
    }
  });

  it("the not-found sentence of an online business names no listing work", () => {
    for (const lang of ["nl", "en"] as const) {
      const p = notFoundParagraph({ business: biz, notFoundAnswers: 5, visibility: "partial", lang, online: true });
      expect(p).not.toMatch(LOCAL_WORDS);
      expect(p.length).toBeGreaterThan(20);
      expect(notFoundParagraph({ business: biz, notFoundAnswers: 5, visibility: "partial", lang })).toMatch(/Google/);
    }
  });
});

describe("the other mails of an online business", () => {
  it("welcome: three steps, no address, opening hours or Google login", () => {
    for (const lang of ["nl", "en"] as const) {
      const m = welcomeEmail({ lang, online: true, business: { name: NAME, place: PLACE, domain: "vloedlijn.example" }, links: { ...links, confirmFactsUrl: "https://vidalo.ai/app/gegevens", googleConnectUrl: "https://vidalo.ai/api/google/connect" }, cname: { host: "feiten.vloedlijn.example", target: "feiten.vidalo.io" } });
      expect(all(m)).not.toMatch(LOCAL_WORDS);
      expect(all(m)).not.toContain(PLACE);
      expect(m.subject).toMatch(/3/);
      expect(m.text).not.toMatch(/4\./);
      expect(m.text).not.toContain("api/google/connect");
    }
  });
  it("welcome: a local business still gets its four steps", () => {
    const m = welcomeEmail({ business: biz, links: { ...links, confirmFactsUrl: "x", googleConnectUrl: "https://vidalo.ai/api/google/connect" } });
    expect(m.text).toContain("4. Wij doen de rest");
    expect(m.text).toContain("api/google/connect");
  });
  it("monthly report: the not-found sentence has no listing work", () => {
    for (const lang of ["nl", "en"] as const) {
      const m = monthlyReportEmail({ lang, online: true, business: biz, month: "november 2026", checkedAt: "2026-11-11T08:00:00Z", totalAnswers: 12, wrongAnswers: 0, resolved: 0, inProgress: 0, unfixable: 0, proofCards: [], openFindings: [], links, engines: ["chatgpt"], visibility: "partial", notFoundAnswers: 5 });
      expect(all(m)).not.toMatch(LOCAL_WORDS);
      expect(all(m)).not.toContain(PLACE);
    }
  });
  it("follow-ups: how we fix it names no Google, Bing, Apple or directories", () => {
    for (const lang of ["nl", "en"] as const) {
      for (const day of [7, 21] as const) {
        const m = followUpEmail({ lang, online: true, business: biz, wrongAnswers: 2, totalAnswers: 18, example: { ...finding, factKey: "website", subject: null, wrongValue: "x.com", correctValue: "x.io", sourceType: "none", sourceUrl: null, criterium: 8 }, links: { ...links, resultUrl: "https://vidalo.ai/r/x", unsubscribeUrl: "https://vidalo.ai/u" }, priceSetupEur: 149, priceMonitorEur: 49 }, day);
        expect(all(m)).not.toMatch(LOCAL_WORDS);
        expect(all(m)).not.toContain(PLACE);
      }
    }
  });
  it("follow-up of a local business keeps the directory line", () => {
    const m = followUpEmail({ business: biz, wrongAnswers: 2, totalAnswers: 18, example: null, links: { ...links, resultUrl: "x", unsubscribeUrl: "y" }, priceSetupEur: 149, priceMonitorEur: 49 }, 7);
    expect(m.text).toMatch(/Google, Bing, Apple/);
  });
});

describe("through the real pipeline (mock mode)", () => {
  let db: MemDb;
  let outDir: string;
  beforeEach(async () => {
    db = new MemDb();
    setDb(db);
    outDir = await mkdtemp(path.join(tmpdir(), "vidalo-mail-online-"));
    process.env.VIDALO_OUT_DIR = outDir;
    process.env.UNSUBSCRIBE_SECRET ??= "test-secret";
  });

  async function onlineRun() {
    const p = await prepareBusiness({ name: NAME, place: PLACE, db });
    const run = await runScan({ businessId: p.business.id, kind: "free", db });
    return { business: p.business, run, report: await buildReport(run.scanRunId, db) };
  }

  it("the free-check mail goes to the asker, counts like the report, and says nothing local", async () => {
    const { run, report } = await onlineRun();
    expect(report.profile?.mode).toBe("online");
    const res = await sendBaselineSummary(run.scanRunId, { email: "vraagt@example.nl", lang: "nl" });
    const eml = await readFile(res!.file!, "utf8");
    expect(eml).toMatch(/^To: vraagt@example\.nl/m);
    const text = eml;
    // the mail's own numbers are the report's
    const checked = report.totalAnswers - uncheckedAnswersOf(report);
    expect(text).toContain(`${checked} antwoorden gecontroleerd`);
    expect(text).toContain(`stelden we ${report.totalAnswers} vragen`);
    // the headline counts the report's wrong answers, out of the report's answers
    if (report.wrongAnswers > 0) expect(text).toContain(`${report.wrongAnswers} van de ${report.totalAnswers} antwoorden over ${NAME}`);
    const c = competitionCountsOf(report)!;
    expect(text).toContain(`Genoemd in ${c.named} van ${c.answers} antwoorden`);
    expect(c.answers).toBeGreaterThan(0);
    expect(plain(eml)).not.toContain(PLACE);
    expect(plain(eml)).not.toMatch(LOCAL_WORDS);
    if (isUncheckedGrey(report)) expect(eml).not.toMatch(/kent je niet/);
  });

  it("the monthly mail of the same business uses the report's total, too", async () => {
    const { business, run, report } = await onlineRun();
    await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ownerEmail: "eigenaar@example.nl", plan: "monitor" });
    const res = await sendMonthlyReport(business.id, { scanRunId: run.scanRunId, monthLabel: "november 2026" });
    const eml = await readFile(res!.file!, "utf8");
    expect(eml).toContain(`We stelden ${report.totalAnswers} vragen`);
    expect(plain(eml)).not.toContain(PLACE);
    expect(plain(eml)).not.toMatch(LOCAL_WORDS);
  });

  it("the follow-ups of the same business say nothing about listings either", async () => {
    const { business, run } = await onlineRun();
    // the mock leaves some businesses with nothing wrong; a follow-up needs one finding
    if (!(await db.listFindings(business.id)).length)
      await db.upsertFindings([{ businessId: business.id, scanRunId: run.scanRunId, factKey: "website", subject: null, engine: "chatgpt", wrongValue: "x.example", correctValue: "y.example", frequency: 2, sampleCount: 3, sourceUrl: null, sourceType: "none", evidenceBefore: null }]);
    await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ownerEmail: "eigenaar@example.nl", status: "scanned" });
    for (const day of [7, 21] as const) {
      const res = await sendFollowUp(business.id, day);
      expect(res, `day ${day}`).not.toBeNull();
      const eml = plain(await readFile(res!.file!, "utf8"));
      expect(eml).not.toMatch(LOCAL_WORDS);
      expect(eml).not.toContain(PLACE);
    }
  });

  it("the welcome mail of a paying online business has three steps", async () => {
    const { business } = await onlineRun();
    await db.upsertBusiness({ id: business.id, slug: business.slug, name: business.name, place: business.place, ownerEmail: "eigenaar@example.nl", plan: "monitor" });
    const res = await sendWelcome(business.id);
    const eml = await readFile(res!.file!, "utf8");
    expect(eml).toMatch(/Subject: Welkom bij Vidalo: 3 stappen/);
    expect(plain(eml)).not.toMatch(LOCAL_WORDS);
  });

  it("a local business still gets the four steps and the directory line", async () => {
    const p = await prepareBusiness({ name: "Bakkerij De Vries", place: "Haarlem", db });
    await db.upsertBusiness({ id: p.business.id, slug: p.business.slug, name: p.business.name, place: p.business.place, ownerEmail: "eigenaar@example.nl", plan: "monitor" });
    const res = await sendWelcome(p.business.id);
    expect(await readFile(res!.file!, "utf8")).toMatch(/Subject: Welkom bij Vidalo: 4 stappen/);
  });
});

void paidBusiness;
