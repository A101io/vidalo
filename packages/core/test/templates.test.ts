import { describe, expect, it } from "vitest";
import {
  baselineSummaryEmail,
  followUpEmail,
  monthlyReportEmail,
  resolutionNoticeEmail,
  statusLine,
  unfixableNoticeEmail,
  welcomeEmail,
  type Mail,
} from "../src/reporter/templates";
import { correctionRequestEmail, correctionFollowUpEmail, directoryCorrectionEmail, ownerWebsiteInstructionEmail, ownerWebsiteReminderEmail } from "../src/fixer/email-templates";
import { business, finding } from "./worker-fixtures";

const BANNED = /\b(GEO|AEO|LLM|LLMs|prompt|prompts|credits|garantie|gegarandeerd|zichtbaarheid|ranking|optimaliseren)\b/i;

const links = { dashboardUrl: "https://vidalo.io/dashboard", factsPageUrl: "https://feiten.bakkerijjansen.nl/", resultUrl: "https://vidalo.io/scan/bakkerij-jansen-haarlem" };
const ctx = { business: { name: business.name, place: business.place, ownerEmail: business.ownerEmail, kvk: business.kvk }, factsPageUrl: "https://feiten.bakkerijjansen.nl/" };

const notFoundFinding = { ...finding, id: "f2", verdict: "not_found" as const, wrongValue: "niet gevonden", sourceType: "none" as const, sourceUrl: null, frequency: 8 };
const recommendationFinding = { ...finding, id: "f5", factKey: "service" as const, subject: "desembrood", wrongValue: "niet genoemd", correctValue: "yes", sourceType: "none" as const, sourceUrl: null, frequency: 7, evidenceKind: "recommendation" as const, criterium: 6 as const };
const phoneFinding = { ...finding, id: "f6", factKey: "phone" as const, subject: null, wrongValue: "+31231234568", correctValue: "+31231234567", frequency: 2, criterium: 2 as const };
const instableFinding = { ...finding, id: undefined, status: undefined, firstSeenAt: undefined, resolvedAt: undefined, evidenceAfter: undefined, factKey: "price" as const, subject: "Desembrood", wrongValue: "5.5", correctValue: "4.5", frequency: 1, sampleCount: 10, instable: true as const, criterium: 9 as const };

const baselineStipData: Parameters<typeof baselineSummaryEmail>[0] = {
    business,
    checkedAt: "2026-10-02T03:00:00Z",
    totalAnswers: 100,
    wrongAnswers: 3,
    findings: [{ ...finding, criterium: 3 }, recommendationFinding, phoneFinding],
    engines: ["chatgpt", "gemini", "perplexity", "google_ai", "copilot"],
    links,
    stip: "rood",
    engineStips: [
      { engine: "chatgpt", stip: "rood", usage: 0.83, counts: true },
      { engine: "gemini", stip: "groen", usage: 0.12, counts: true },
      { engine: "perplexity", stip: "oranje", usage: 0.04, counts: false },
      { engine: "google_ai", stip: "groen", usage: 0.6, counts: true },
      { engine: "copilot", stip: "grijs", usage: 0.15, counts: true },
    ],
    instable: [instableFinding as never],
  };

const all: Record<string, Mail | { subject: string; text: string }> = {
  welcome: welcomeEmail({
    business,
    cname: { host: "feiten.bakkerijjansen.nl", target: "feiten.vidalo.io" },
    links: { ...links, confirmFactsUrl: "https://vidalo.io/dashboard/feiten", googleConnectUrl: "https://vidalo.io/dashboard/google" },
  }),
  baseline: baselineSummaryEmail({ business, checkedAt: "2026-10-02T03:00:00Z", totalAnswers: 100, wrongAnswers: 1, findings: [finding], engines: ["chatgpt", "gemini", "perplexity", "google_ai", "copilot"], links }),
  baselineClean: baselineSummaryEmail({ business, checkedAt: "2026-10-02T03:00:00Z", totalAnswers: 100, wrongAnswers: 0, findings: [], engines: ["chatgpt"], links }),
  baselineNotFound: baselineSummaryEmail({
    business,
    checkedAt: "2026-10-02T03:00:00Z",
    totalAnswers: 100,
    wrongAnswers: 1,
    notFoundAnswers: 70,
    visibility: "unknown",
    findings: [finding, notFoundFinding, { ...notFoundFinding, id: "f3", factKey: "phone", subject: null }, { ...notFoundFinding, id: "f4", factKey: "address", subject: null }],
    engines: ["chatgpt", "gemini", "perplexity", "google_ai", "copilot"],
    links,
  }),
  baselineStip: baselineSummaryEmail(baselineStipData),
  resolution: resolutionNoticeEmail({
    business,
    finding: { ...finding, status: "resolved", resolvedAt: "2026-10-14T03:00:00Z" },
    before: { quote: "Op zondag open van 10:00 tot 14:00.", at: "2026-10-02T03:00:00Z" },
    after: { quote: "Op zondag gesloten.", at: "2026-10-14T03:00:00Z" },
    days: 12,
    links,
  }),
  report: monthlyReportEmail({
    business,
    month: "oktober 2026",
    checkedAt: "2026-10-07T03:00:00Z",
    totalAnswers: 100,
    wrongAnswers: 1,
    resolved: 1,
    inProgress: 1,
    unfixable: 0,
    proofCards: [{ findingId: "f0", engine: "chatgpt", what: "de openingstijden op zondag", before: "gesloten op maandag", after: "open 9–18", source: "openingstijden.nl", days: 12, resolvedAt: "2026-10-01T00:00:00Z" }],
    openFindings: [{ finding, nextStep: "We vragen de bron uit jouw naam om de gegevens te corrigeren.", since: finding.firstSeenAt }],
    engines: ["chatgpt", "gemini", "perplexity", "google_ai", "copilot"],
    links,
  }),
  reportNotFound: monthlyReportEmail({
    business,
    month: "oktober 2026",
    checkedAt: "2026-10-07T03:00:00Z",
    totalAnswers: 100,
    wrongAnswers: 0,
    notFound: 3,
    notFoundAnswers: 40,
    visibility: "partial",
    resolved: 0,
    inProgress: 3,
    unfixable: 0,
    proofCards: [],
    openFindings: [{ finding: notFoundFinding, nextStep: "Niet gevonden: we maken je vindbaar", since: notFoundFinding.firstSeenAt }],
    engines: ["chatgpt", "gemini", "perplexity", "google_ai", "copilot"],
    links,
  }),
  unfixableNotFound: unfixableNoticeEmail({ business, finding: notFoundFinding, note: "AI noemt je na 60 dagen nog steeds niet. Je feitenpagina en profielen staan goed; we blijven elke maand controleren.", triedDays: 61, links }),
  reportClean: monthlyReportEmail({ business, month: "oktober 2026", checkedAt: "2026-10-07T03:00:00Z", totalAnswers: 12, wrongAnswers: 0, resolved: 0, inProgress: 0, unfixable: 0, proofCards: [], openFindings: [], engines: ["chatgpt"], links }),
  followup7: followUpEmail({ business, wrongAnswers: 3, totalAnswers: 12, example: finding, links: { ...links, unsubscribeUrl: "https://vidalo.io/afmelden?b=b1&t=tok" }, priceSetupEur: 149, priceMonitorEur: 49 }, 7),
  followup21: followUpEmail({ business, wrongAnswers: 3, totalAnswers: 12, example: finding, links: { ...links, unsubscribeUrl: "https://vidalo.io/afmelden?b=b1&t=tok" }, priceSetupEur: 149, priceMonitorEur: 49 }, 21),
  unfixable: unfixableNoticeEmail({ business, finding: { ...finding, sourceType: "none", sourceUrl: null }, note: "Dit antwoord komt uit het geheugen van het model, niet van een bron die wij kunnen aanpassen.", triedDays: 45, links }),
  correction: correctionRequestEmail(finding, ctx),
  correctionFollowUp: correctionFollowUpEmail(finding, ctx, "2026-10-02T10:00:00Z"),
  directoryCorrection: directoryCorrectionEmail("openingstijden.nl", "https://www.openingstijden.nl/bakkerij-jansen", [{ field: "hours.6", current: "10:00-14:00", expected: "gesloten" }, { field: "phone", current: null, expected: "023 123 45 67" }], ctx),
  ownerInstruction: ownerWebsiteInstructionEmail({ ...finding, sourceType: "owned_website", sourceUrl: "https://www.bakkerijjansen.nl/contact" }, business, links.dashboardUrl),
  ownerReminder: ownerWebsiteReminderEmail({ ...finding, sourceType: "owned_website", sourceUrl: "https://www.bakkerijjansen.nl/contact" }, business, links.dashboardUrl, 14),
};

describe("email templates", () => {
  for (const [name, m] of Object.entries(all)) {
    it(`${name}: Dutch, no jargon, no exclamation marks`, () => {
      expect(m.subject.length).toBeGreaterThan(5);
      expect(m.subject + "\n" + m.text).not.toMatch(BANNED);
      expect(m.subject).not.toContain("!");
      expect(m.text).not.toContain("!");
      expect(m.text).not.toContain("undefined");
      expect(m.text).not.toContain("null");
      expect(m.text).not.toMatch(/\bcontrol\b/i);
    });
  }

  it("snapshots", () => {
    for (const [name, m] of Object.entries(all)) {
      expect(`${m.subject}\n\n${m.text}`).toMatchSnapshot(name);
    }
  });

  it("welcome lists 4 steps and the CNAME", () => {
    const t = all.welcome!.text;
    expect(t).toMatch(/1\. Bevestig je gegevens/);
    expect(t).toMatch(/2\. Eén DNS-regel/);
    expect(t).toMatch(/3\. Log één keer in bij Google/);
    expect(t).toMatch(/4\. Wij doen de rest/);
    expect(t).toContain("feiten.bakkerijjansen.nl  →  feiten.vidalo.io");
  });

  it("status line follows the messaging brief", () => {
    expect(statusLine({ totalAnswers: 12, wrongAnswers: 0, resolved: 0, inProgress: 0 })).toBe("12 van 12 antwoorden kloppen");
    expect(statusLine({ totalAnswers: 12, wrongAnswers: 1, resolved: 1, inProgress: 1 })).toBe("2 fouten gevonden, 1 hersteld, 1 in behandeling");
    expect(statusLine({ totalAnswers: 12, wrongAnswers: 0, resolved: 0, inProgress: 3, notFound: 3 })).toBe("3 in behandeling, 3 vragen: AI vindt niets over je");
    expect(statusLine({ totalAnswers: 12, wrongAnswers: 1, resolved: 0, inProgress: 1, notFound: 1 })).toBe("1 fout gevonden, 1 in behandeling, 1 vraag: AI vindt niets over je");
  });

  it("the baseline mail is a summary: the colour, at most 3 examples worst first, one button to everything, never a score", () => {
    const b = all.baselineStip!;
    expect(b.text).toContain("Stip: rood. AI stuurt klanten weg.");
    expect(b.text).toContain("Per AI: ChatGPT: rood, Gemini: groen, Perplexity: oranje, Google AI: groen, Copilot: grijs.");
    // The full listing (severity groups, every finding, what we do, instable answers) lives in the account, not the mail.
    expect(b.text).not.toMatch(/Afhaker \(|Misleider \(|Instabiel \(|Wat we doen:/);
    const examples = b.text.split("De belangrijkste fouten")[1]?.split(/\n\n(?=En nog|Wie AI wel noemt|Bekijk)/)[0] ?? "";
    expect(examples.split("\n\n").filter(Boolean).length).toBeLessThanOrEqual(3);
    expect(b.text).toMatch(/Bekijk (je volledige resultaat|alles in je overzicht): https:\/\/vidalo\.io\//);
    expect(b.html.match(/background:#2563eb"><a /g)?.length).toBe(1); // one primary button
    expect(b.text).not.toMatch(/score|\d+ ?\/ ?100|punten/i);
  });

  it("the baseline mail of a paying owner points to the account and shows what happens next, with dates", () => {
    const paid = baselineSummaryEmail({ ...baselineStipData, paying: true });
    expect(paid.text).toContain("Bekijk alles in je overzicht: https://vidalo.io/dashboard");
    expect(paid.text).toContain("Wat er nu gebeurt");
    expect(paid.text).toMatch(/- Rond \d+ \w+ 2026: Je volgende maandcontrole\./);
    expect(paid.text).not.toContain("euro eenmalig");
    const free = baselineSummaryEmail({ ...baselineStipData, links: { ...baselineStipData.links, resultUrl: "https://vidalo.io/r/run1" }, offer: { setupEur: 149, monitorEur: 49 } });
    expect(free.text).toContain("Bekijk je volledige resultaat: https://vidalo.io/r/run1");
    expect(free.text).toContain("Zo herstellen wij het");
    expect(free.text).toContain("149 euro eenmalig");
  });

  it("not found is named as such, never as a wrong value or a source", () => {
    const b = all.baselineNotFound!;
    expect(b.subject).toBe("Eerste controle van Bakkerij Jansen: AI vindt (bijna) niets over je");
    expect(b.text).toContain("3 vragen: AI vindt niets over je");
    expect(b.text).toContain("70 antwoorden waren leeg");
    expect(b.text).toContain("AI vindt (bijna) niets over Bakkerij Jansen. Je bestaat niet in het antwoord.");
    expect(b.text).toContain("ChatGPT vond niets over de openingstijden op zondag (8 van de 10 keer)");
    expect(b.text).not.toContain("Wat we doen:");
    expect(b.text).not.toContain('zei: niet gevonden');
    const r = all.reportNotFound!;
    expect(r.subject).toContain("3 vragen: AI vindt niets over je");
    expect(r.text).toContain("AI kent Bakkerij Jansen maar half");
    expect(r.text).not.toContain("Waar het vandaan komt: uit het geheugen van het model");
  });

  it("resolution shows before and after with dates", () => {
    const t = all.resolution!.text;
    expect(t).toContain("Voor (2 oktober 2026)");
    expect(t).toContain("Na (14 oktober 2026)");
    expect(t).toContain("hersteld in 12 dagen");
    expect(all.resolution!.subject).toBe('Hersteld: ChatGPT zegt nu "gesloten" over Bakkerij Jansen');
  });

  it("follow-ups use the brief's subjects", () => {
    expect(all.followup7!.subject).toBe("3 antwoorden over Bakkerij Jansen kloppen niet");
    expect(all.followup21!.subject).toBe('Nog steeds "10:00 tot 14:00"');
    expect(all.followup7!.text).toContain("149 euro eenmalig");
    // Commercial mail: both follow-ups carry the opt-out link.
    for (const m of [all.followup7!, all.followup21!]) expect(m.text).toContain("Afmelden: https://vidalo.io/afmelden?b=b1&t=tok");
  });

  it("correction request carries wrong value, correct value, reference and one reason", () => {
    const t = all.correction!.text;
    expect(t).toContain("Wat er staat (de openingstijden op zondag): 10:00 tot 14:00");
    expect(t).toContain("Wat het moet zijn: gesloten");
    expect(t).toContain("https://feiten.bakkerijjansen.nl/");
    expect(t).toContain("Pagina: https://www.openingstijden.nl/bakkerij-jansen-haarlem");
    expect(t).toContain("de eigenaar van Bakkerij Jansen");
    expect(t).toContain("eigenaar@bakkerijjansen.nl");
  });

  it("owner instruction says page X / staat Y / moet Z", () => {
    const t = all.ownerInstruction!.text;
    expect(t).toContain("Op pagina https://www.bakkerijjansen.nl/contact staat: 10:00 tot 14:00");
    expect(t).toContain("Dit moet zijn: gesloten");
  });

  it("html version exists for customer mails, in the Vidalo branding", () => {
    const html = (all.report as Mail).html;
    expect(html).toContain('<a href="https://vidalo.io/dashboard"');
    expect(html).toContain('data-brand="vidalo"');
    expect(html).toContain("A101 B.V.");
    expect(html).toContain('<meta name="color-scheme" content="light">');
  });

  it("branded html: headings, the colour dot, code blocks, nothing unescaped", async () => {
    const { textToHtml } = await import("../src/reporter/templates");
    const html = textToHtml("Hoi,\n\nStip: rood. AI stuurt klanten weg.\n\n1. Bevestig je gegevens\nAdres en telefoon.\n\nUser-agent: OAI-SearchBot\nAllow: /\n\nA <b>&</b> B");
    expect(html).toContain("background:#d41b44");
    expect(html).toContain('<strong style="color:#111827;font-weight:700">1. Bevestig je gegevens</strong>');
    expect(html).toMatch(/<pre[^>]*>User-agent: OAI-SearchBot\nAllow: \/<\/pre>/);
    expect(html).not.toContain("<strong style=\"color:#111827;font-weight:700\">Hoi,");
    expect(html).toContain("A &lt;b&gt;&amp;&lt;/b&gt; B");
  });
});

// ---------------------------------------------------------------------------
// English: the same mails for an owner who chose English (business.language)
// ---------------------------------------------------------------------------

const BANNED_EN = /\b(GEO|AEO|LLM|LLMs|prompt|prompts|credits|platform|agent|agents|guarantee|guaranteed|visibility|ranking|optimi[sz]e)\b/i;
/** Dutch words that must not survive in an English mail (the asked question in "Who AI names instead" is the one exception, not used here). */
const DUTCH = /\b(je|jouw|niet|klopt|kloppen|hersteld|overzicht|gegevens|Hoi|Groet|antwoorden|controle|feitenpagina)\b/;
const linksEn = { dashboardUrl: "https://vidalo.io/en/app", factsPageUrl: "https://feiten.bakkerijjansen.nl/", resultUrl: "https://vidalo.io/en/r/run1" };
const en = "en" as const;

const allEn: Record<string, Mail | { subject: string; text: string }> = {
  welcome: welcomeEmail({ lang: en, business, cname: { host: "feiten.bakkerijjansen.nl", target: "feiten.vidalo.io" }, links: { ...linksEn, confirmFactsUrl: "https://vidalo.io/en/app/gegevens", googleConnectUrl: "https://vidalo.io/en/app/google" } }),
  welcomeNoDomain: welcomeEmail({ lang: en, business, cname: null, links: { ...linksEn, confirmFactsUrl: "https://vidalo.io/en/app/gegevens", googleConnectUrl: "https://vidalo.io/en/app/google" } }),
  baseline: baselineSummaryEmail({ ...baselineStipData, lang: en, links: linksEn, offer: { setupEur: 149, monitorEur: 49 } }),
  baselinePaying: baselineSummaryEmail({ ...baselineStipData, lang: en, links: linksEn, paying: true }),
  baselineClean: baselineSummaryEmail({ lang: en, business, checkedAt: "2026-10-02T03:00:00Z", totalAnswers: 100, wrongAnswers: 0, findings: [], engines: ["chatgpt"], links: linksEn }),
  baselineNotFound: baselineSummaryEmail({
    lang: en,
    business,
    checkedAt: "2026-10-02T03:00:00Z",
    totalAnswers: 100,
    wrongAnswers: 1,
    notFoundAnswers: 70,
    visibility: "unknown",
    findings: [finding, notFoundFinding, { ...notFoundFinding, id: "f3", factKey: "phone", subject: null }],
    engines: ["chatgpt", "gemini"],
    links: linksEn,
  }),
  resolution: resolutionNoticeEmail({
    lang: en,
    business,
    finding: { ...finding, status: "resolved", resolvedAt: "2026-10-14T03:00:00Z" },
    before: { quote: "Open on Sunday from 10:00 to 14:00.", at: "2026-10-02T03:00:00Z" },
    after: { quote: "Closed on Sunday.", at: "2026-10-14T03:00:00Z" },
    days: 12,
    links: linksEn,
  }),
  report: monthlyReportEmail({
    lang: en,
    business,
    month: "October 2026",
    checkedAt: "2026-10-07T03:00:00Z",
    totalAnswers: 100,
    wrongAnswers: 1,
    resolved: 1,
    inProgress: 1,
    unfixable: 0,
    stip: "oranje",
    proofCards: [{ findingId: "f0", engine: "chatgpt", what: "the opening hours on Sunday", before: "closed on Monday", after: "open 9–18", source: "openingstijden.nl", days: 12, resolvedAt: "2026-10-01T00:00:00Z" }],
    openFindings: [{ finding, nextStep: "We ask the source, on your behalf, to correct the details.", since: finding.firstSeenAt }],
    engines: ["chatgpt", "gemini"],
    links: linksEn,
  }),
  reportNotFound: monthlyReportEmail({ lang: en, business, month: "October 2026", checkedAt: "2026-10-07T03:00:00Z", totalAnswers: 100, wrongAnswers: 0, notFound: 3, notFoundAnswers: 40, visibility: "partial", resolved: 0, inProgress: 3, unfixable: 0, proofCards: [], openFindings: [{ finding: notFoundFinding, nextStep: "", since: notFoundFinding.firstSeenAt }], engines: ["chatgpt"], links: linksEn }),
  reportClean: monthlyReportEmail({ lang: en, business, month: "October 2026", checkedAt: "2026-10-07T03:00:00Z", totalAnswers: 12, wrongAnswers: 0, resolved: 0, inProgress: 0, unfixable: 0, proofCards: [], openFindings: [], engines: ["chatgpt"], links: linksEn }),
  followup7: followUpEmail({ lang: en, business, wrongAnswers: 3, totalAnswers: 12, example: finding, links: { ...linksEn, unsubscribeUrl: "https://vidalo.io/en/unsubscribe?b=b1&t=tok" }, priceSetupEur: 149, priceMonitorEur: 49 }, 7),
  followup21: followUpEmail({ lang: en, business, wrongAnswers: 3, totalAnswers: 12, example: finding, links: { ...linksEn, unsubscribeUrl: "https://vidalo.io/en/unsubscribe?b=b1&t=tok" }, priceSetupEur: 149, priceMonitorEur: 49 }, 21),
  unfixable: unfixableNoticeEmail({ lang: en, business, finding: { ...finding, sourceType: "none", sourceUrl: null }, note: "Dit antwoord komt uit het geheugen van het model, niet van een bron die wij kunnen aanpassen.", triedDays: 45, links: linksEn }),
  unfixableNotFound: unfixableNoticeEmail({ lang: en, business, finding: notFoundFinding, note: "AI noemt je na 60 dagen nog steeds niet. Je feitenpagina en profielen staan goed; we blijven elke maand controleren.", triedDays: 61, links: linksEn }),
  ownerInstruction: ownerWebsiteInstructionEmail({ ...finding, sourceType: "owned_website", sourceUrl: "https://www.bakkerijjansen.nl/contact" }, business, linksEn.dashboardUrl, en),
  ownerReminder: ownerWebsiteReminderEmail({ ...finding, sourceType: "owned_website", sourceUrl: "https://www.bakkerijjansen.nl/contact" }, business, linksEn.dashboardUrl, 14, en),
};

describe("email templates in English", () => {
  for (const [name, m] of Object.entries(allEn)) {
    it(`${name}: English, no jargon, no exclamation marks, no Dutch left`, () => {
      expect(m.subject.length).toBeGreaterThan(5);
      expect(m.subject + "\n" + m.text).not.toMatch(BANNED_EN);
      expect(m.subject + m.text).not.toContain("!");
      expect(m.text).not.toMatch(/undefined|null|NaN/);
      expect(m.text).not.toMatch(/\bcontrol\b/i);
      expect(m.text.startsWith("Hi,\n")).toBe(true);
      expect(m.text).toContain("Best,\nVidalo");
      // Only the business, the town and the URLs are Dutch.
      expect((m.subject + "\n" + m.text).replace(/https?:\/\/\S+/g, "")).not.toMatch(DUTCH);
      if ("html" in m && m.html) {
        expect(m.html).toContain('<html lang="en">');
        expect(m.html).toContain("the Netherlands");
      }
    });
  }

  it("snapshots", () => {
    for (const [name, m] of Object.entries(allEn)) expect(`${m.subject}\n\n${m.text}`).toMatchSnapshot(`en ${name}`);
  });

  it("dates and prices are written the English way", () => {
    expect(allEn.resolution!.text).toContain("Before (2 October 2026)");
    expect(allEn.resolution!.text).toContain("After (14 October 2026)");
    expect(allEn.resolution!.text).toContain("fixed in 12 days");
    expect(allEn.resolution!.subject).toBe('Fixed: ChatGPT now says "closed" about Bakkerij Jansen');
    expect(allEn.baseline!.text).toContain("On 2 October 2026 we put 100 questions about Bakkerij Jansen to ChatGPT");
    expect(allEn.baseline!.text).toContain("€149 once, monitoring €49 a month");
    expect(allEn.baselinePaying!.text).toMatch(/- Around \d+ (October|November) 2026: Your next monthly check\./);
    expect(allEn.followup21!.subject).toBe('Still "10:00 to 14:00"');
    expect(allEn.report!.subject).toBe("Bakkerij Jansen in October 2026: orange, 2 errors found, 1 fixed, 1 in progress");
    expect(allEn.baselineNotFound!.text).toContain("ChatGPT found nothing about the opening hours on Sunday (8 of 10 times)");
  });

  it("the stored Dutch fix-path note becomes English; the dot line is English", () => {
    expect(allEn.unfixable!.text).toContain("Why it did not work: This answer comes from the model's memory, not from a source we can change.");
    expect(allEn.unfixable!.text).toContain("What we did: This answer comes from the model's memory.");
    expect(allEn.baseline!.text).toContain("Dot: red. AI sends customers away. At least one answer sends customers away.");
  });

  it("the follow-ups carry the English unsubscribe line", () => {
    for (const m of [allEn.followup7!, allEn.followup21!]) expect(m.text).toContain("No more emails about this? Unsubscribe: https://vidalo.io/en/unsubscribe?b=b1&t=tok");
    expect((allEn.followup7 as Mail).html).toContain(">Unsubscribe</a>");
  });

  it("the Dutch mail is unchanged when no language is given", () => {
    expect(welcomeEmail({ ...(all.welcome as never), business, cname: null, links: { ...links, confirmFactsUrl: "x", googleConnectUrl: "y" } }).html).toContain('<html lang="nl">');
    expect(statusLine({ totalAnswers: 12, wrongAnswers: 1, resolved: 1, inProgress: 1 }, "en")).toBe("2 errors found, 1 fixed, 1 in progress");
  });

  it("textToHtml follows the language", async () => {
    const { textToHtml } = await import("../src/reporter/templates");
    expect(textToHtml("Hi,\n\nText", "en")).toContain('<html lang="en">');
    expect(textToHtml("Hi,\n\nText", "en")).toContain("Prices excl. VAT");
    expect(textToHtml("Hoi,\n\nTekst")).toContain('<html lang="nl">');
  });

  it("letters to third parties stay Dutch: they take no language", () => {
    expect(correctionRequestEmail.length).toBe(2);
    expect(all.correction!.text).toContain("Geachte heer/mevrouw");
    expect(all.directoryCorrection!.text).toContain("Geachte heer/mevrouw");
  });
});

describe("mail links per language", () => {
  it("an English owner gets the English URLs, the same the web app makes", async () => {
    const { mailPath, dashboardUrl, unsubscribeUrl, resultUrl, loginUrl } = await import("../src/reporter/links");
    const { localizeHref } = await import("../../../apps/web/lib/lang-paths");
    for (const route of ["/app", "/app/gegevens", "/app/google", "/app/domein", "/inloggen", "/afmelden", "/r/run1", "/api/afmelden"]) {
      expect(mailPath(route, "en")).toBe(localizeHref(route, "en"));
      expect(mailPath(route, "nl")).toBe(route);
    }
    expect(dashboardUrl({ slug: "x", language: "en" })).toMatch(/\/en\/app$/);
    expect(dashboardUrl({ slug: "x", language: "nl" })).toMatch(/[^n]\/app$/);
    expect(resultUrl("run1", "en")).toMatch(/\/en\/r\/run1$/);
    expect(loginUrl(undefined, "en")).toMatch(/\/en\/login$/);
    expect(unsubscribeUrl({ id: "b1", language: "en" })).toMatch(/\/en\/unsubscribe\?b=b1&t=/);
  });
});
