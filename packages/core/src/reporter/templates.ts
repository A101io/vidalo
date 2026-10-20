/**
 * Dutch, plain-text-first customer e-mails (docs/MESSAGING.md).
 *
 * Rules: informal "je", calm verbs (controleren, vinden, herstellen, laten
 * zien), one number per claim, no exclamation marks, no countdowns, no jargon
 * (no GEO/AEO/LLM/prompt/credits/garantie). Every mail is pure data in → text out.
 */
import type { Business, Engine, EngineStip, Finding, InstableFinding, RecommendationSummary, Severity, Stip, Visibility } from "../types.js";
import { ENGINE_LABEL } from "../types.js";
import { copy } from "../copy/index.js";
import { criteriumFor, severityOf } from "../criteria.js";
import { findingWordsNl, hostOfUrl, notFoundCountNl, visibilityLineNl } from "../shared/facts-nl.js";
import { fixPathForFinding } from "../fixer/paths.js";
import { formatDateNl } from "../publisher/render.js";

export interface Mail {
  subject: string;
  text: string;
  html: string;
}

export interface Links {
  dashboardUrl: string;
  factsPageUrl?: string | null;
  resultUrl?: string | null;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Minimal HTML version of a plain-text mail: paragraphs, links clickable. */
export function textToHtml(text: string): string {
  const paras = text.trim().split(/\n{2,}/);
  const body = paras
    .map((p) => {
      const lines = p.split("\n").map((l) => esc(l).replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1">$1</a>'));
      return `<p style="margin:0 0 1em">${lines.join("<br>")}</p>`;
    })
    .join("\n");
  return `<!doctype html><html lang="nl"><body style="font:16px/1.5 -apple-system,Segoe UI,Roboto,sans-serif;color:#1b1b1b;max-width:40rem;padding:1rem">${body}</body></html>`;
}

function mail(subject: string, text: string): Mail {
  return { subject, text, html: textToHtml(text) };
}

export function engineName(engine: Engine): string {
  return ENGINE_LABEL[engine] ?? engine;
}

/**
 * "12 van 12 antwoorden kloppen" / "2 fouten gevonden, 1 hersteld, 1 in behandeling".
 * Not-found answers are reported next to the wrong ones, never as wrong:
 * "2 fouten gevonden, 3 vragen: AI vindt niets over je".
 */
export function statusLine(stats: { totalAnswers: number; wrongAnswers: number; resolved: number; inProgress: number; unfixable?: number; notFound?: number }): string {
  const notFound = stats.notFound ?? 0;
  if (stats.wrongAnswers === 0 && stats.resolved === 0 && notFound === 0) return `${stats.totalAnswers} van ${stats.totalAnswers} antwoorden kloppen`;
  const parts: string[] = [];
  const found = stats.wrongAnswers + stats.resolved;
  if (found || !notFound) parts.push(`${found} ${found === 1 ? "fout" : "fouten"} gevonden`);
  if (stats.resolved) parts.push(`${stats.resolved} hersteld`);
  if (stats.inProgress) parts.push(`${stats.inProgress} in behandeling`);
  if (stats.unfixable) parts.push(`${stats.unfixable} niet te herstellen`);
  if (notFound) parts.push(notFoundCountNl(notFound));
  return parts.join(", ");
}

function sourceLine(f: Finding): string {
  const host = hostOfUrl(f.sourceUrl);
  switch (f.sourceType) {
    case "none":
      return "uit het geheugen van het model";
    case "other_entity":
      return host ? `een ander bedrijf met dezelfde naam (${host})` : "een ander bedrijf met dezelfde naam";
    case "owned_website":
      return host ? `je eigen website (${host})` : "je eigen website";
    case "owned_facts_page":
      return "je feitenpagina";
    default:
      return host ?? "onbekende bron";
  }
}

/**
 * "Wie AI wel noemt": up to three fixed recommendation questions where the
 * business was left out, with the names given instead and the sites cited.
 */
export function namedParagraph(recs: RecommendationSummary[] | undefined): string {
  const N = copy.result.named;
  const left = (recs ?? []).filter((r) => r.pool === "core" && r.named < r.answers && r.others.length > 0).slice(0, 3);
  if (!left.length) return "";
  const blocks = left.map((r) => {
    const lines = [`Vraag: ${r.prompt}`, N.you(r.named, r.answers), `${N.others}: ${r.others.slice(0, 3).map((o) => `${o.name} (${N.times(o.answers)})`).join(", ")}`];
    if (r.sources.length) lines.push(`${N.sources}: ${r.sources.slice(0, 3).map((x) => x.host).join(", ")}`);
    return lines.join("\n");
  });
  return `${N.h2}\n\n${blocks.join("\n\n")}\n\n${N.note}`;
}

/** One finding as a short block: Vraag / Engine zei / Klopt niet / Bron / Wat we doen. */
export function findingBlock(f: Finding, opts: { promptText?: string | null; nextStep?: string } = {}): string {
  const w = findingWordsNl(f);
  const next = opts.nextStep ?? fixPathForFinding(f).labelNl;
  if (w.recommendation) {
    // The business was not named where its facts say it belongs; the fact itself is the evidence.
    const lines = [
      opts.promptText ? `Vraag: ${opts.promptText}` : `Aanbevelingsvraag over: ${w.what}`,
      `${engineName(f.engine)} noemt je niet (${w.frequency})`,
      `${copy.recommendation.line} Jouw gegeven is: ${w.correct}`,
      f.sourceType === "none" ? copy.recommendation.noSource : `Waar het vandaan komt: ${sourceLine(f)}`,
      `Wat we doen: ${next}`,
    ];
    return lines.join("\n");
  }
  if (w.notFound) {
    // No wrong value and no source: the engine knows nothing about the business.
    const lines = [
      opts.promptText ? `Vraag: ${opts.promptText}` : `Over: ${w.what}`,
      `${engineName(f.engine)} ${w.notFoundLine} (${w.frequency})`,
      `Niet gevonden. Jouw gegeven is: ${w.correct}`,
      `Wat we doen: ${next}`,
    ];
    return lines.join("\n");
  }
  const other = f.sourceType === "other_entity";
  const lines = [
    opts.promptText ? `Vraag: ${opts.promptText}` : `Over: ${w.what}`,
    other ? `${engineName(f.engine)} antwoordde over een ander bedrijf met dezelfde naam (${w.frequency})` : `${engineName(f.engine)} zei: ${w.wrong} (${w.frequency})`,
    other ? `Klopt niet. Jouw gegeven is: ${w.correct}` : `Klopt niet. Het is: ${w.correct}`,
    `Waar het vandaan komt: ${sourceLine(f)}`,
    `Wat we doen: ${next}`,
  ];
  return lines.join("\n");
}

/** "Stip: rood. AI stuurt klanten weg." plus one line per engine that was checked. */
export function stipParagraph(d: { stip?: Stip; engineStips?: EngineStip[] }): string {
  if (!d.stip) return "";
  const lines = [`Stip: ${copy.stip[d.stip].toLowerCase()}. ${copy.stipMeaning[d.stip]}. ${copy.stipLine[d.stip]}`];
  const per = (d.engineStips ?? []).map((e) => `${engineName(e.engine)}: ${copy.stip[e.stip].toLowerCase()}`);
  if (per.length) lines.push(`Per AI: ${per.join(", ")}.`);
  return lines.join("\n");
}

function severityFor(f: Finding): Severity {
  return severityOf(f.criterium ?? criteriumFor(f.factKey, f.subject, null, { otherEntity: f.sourceType === "other_entity" }));
}

/**
 * Findings grouped by severity, worst first, each as a findingBlock. Order:
 * afhakers (one wrong answer and the customer does not come), misleiders,
 * verwarring. Never a score.
 */
export function findingsBySeverityText(findings: Finding[], opts: { max?: number; nextStepFor?: (f: Finding) => string } = {}): string {
  const max = opts.max ?? 8;
  const order: Severity[] = ["afhaker", "misleider", "verwarring"];
  const parts: string[] = [];
  let used = 0;
  for (const sev of order) {
    const list = findings.filter((f) => severityFor(f) === sev);
    if (!list.length) continue;
    const shown = list.slice(0, Math.max(0, max - used));
    if (!shown.length) break;
    used += shown.length;
    parts.push(`${copy.severity[sev]} (${list.length}): ${copy.severityExplain[sev]}\n\n${shown.map((f) => findingBlock(f, { nextStep: opts.nextStepFor?.(f) })).join("\n\n")}`);
  }
  return parts.join("\n\n");
}

/** Lines for instable answers (below the threshold): shown, no fix. */
export function instableText(instable: InstableFinding[] | undefined): string {
  if (!instable?.length) return "";
  const lines = instable.slice(0, 5).map((f) => {
    const w = findingWordsNl(f);
    return `- ${engineName(f.engine)} zei ${w.frequency} "${w.wrong}" over ${w.what}; het is ${w.correct}.`;
  });
  return `${copy.instable} (${instable.length}): ${copy.instableLine}\n${lines.join("\n")}`;
}

/** Paragraph for the baseline / monthly mails when answers came back empty; empty string otherwise. */
export function notFoundParagraph(d: { business: Pick<Business, "name">; notFoundAnswers?: number; visibility?: Visibility; notFoundFindings?: number }): string {
  const n = d.notFoundAnswers ?? 0;
  const v = d.visibility ?? "found";
  if (!n && v === "found") return "";
  const parts: string[] = [];
  if (d.notFoundFindings) parts.push(`${notFoundCountNl(d.notFoundFindings)}.`);
  if (n) parts.push(`${n} ${n === 1 ? "antwoord was" : "antwoorden waren"} leeg: de AI zei dat het geen informatie over je heeft.`);
  const line = visibilityLineNl(v, d.business.name);
  if (line) parts.push(line);
  if (v !== "found") parts.push("Dat tellen we niet als fout, maar het betekent wel dat een klant die het vraagt, geen antwoord krijgt. We maken je feitenpagina, zetten je in Google, Bing, Apple en de Nederlandse gidsen, en controleren na 3 weken of je genoemd wordt.");
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// 1. Welcome after checkout (4 steps)
// ---------------------------------------------------------------------------

export interface WelcomeData {
  business: Pick<Business, "name" | "place" | "domain">;
  links: Links & { confirmFactsUrl: string; googleConnectUrl: string };
  /** CNAME instruction when the owner has a domain */
  cname?: { host: string; target: string } | null;
}

export function welcomeEmail(d: WelcomeData): Mail {
  const subject = `Welkom bij Vidalo: 4 stappen voor ${d.business.name}`;
  const dns = d.cname
    ? `2. Eén DNS-regel
   Maak bij je domeinbeheerder een CNAME aan:
   ${d.cname.host}  →  ${d.cname.target}
   Wij controleren elke 10 minuten of hij er staat. Lukt het niet, dan zetten we de pagina op ons eigen adres.`
    : `2. Feitenpagina
   Je hebt geen eigen domein opgegeven. We zetten je feitenpagina op ${d.links.factsPageUrl ?? "ons adres"}. Later verhuizen kan altijd.`;
  const text = `Hoi,

Bedankt voor je bestelling. Vanaf nu controleren we wat AI over ${d.business.name} zegt en herstellen we fouten bij de bron. Om te starten vragen we 4 dingen van je. Samen ongeveer 5 minuten.

1. Bevestig je gegevens
   Adres, telefoon, openingstijden, wat je wel en niet doet. We hebben ze alvast ingevuld, jij kijkt ze na.
   ${d.links.confirmFactsUrl}

${dns}

3. Log één keer in bij Google
   Daarmee mogen we je Google Bedrijfsprofiel lezen en de openingstijden, het telefoonnummer en de website gelijk zetten.
   ${d.links.googleConnectUrl}

4. Wij doen de rest
   Zodra je DNS-regel staat, is je feitenpagina live. Je Google-profiel werken we direct bij; bij Bing en Apple dienen we de wijziging in en bewaken we de verwerking. De eerste volledige controle draait binnen 48 uur na je bevestiging; het resultaat krijg je per mail.

Je overzicht: ${d.links.dashboardUrl}

Vragen? Antwoord op deze mail.

Groet,
Vidalo
`;
  return mail(subject, text);
}

// ---------------------------------------------------------------------------
// 2. Baseline summary (day 2)
// ---------------------------------------------------------------------------

export interface BaselineData {
  business: Pick<Business, "name" | "place">;
  checkedAt: string;
  totalAnswers: number;
  wrongAnswers: number;
  /** answers in which the engine said it has no information */
  notFoundAnswers?: number;
  visibility?: Visibility;
  findings: Finding[];
  promptsById?: Record<string, string>;
  links: Links;
  engines: Engine[];
  /** colour of the dot; when present the mail opens with it and groups findings by severity */
  stip?: Stip;
  engineStips?: EngineStip[];
  instable?: InstableFinding[];
  /** recommendation questions: who AI named instead of the business */
  recommendations?: RecommendationSummary[];
}

export function baselineSummaryEmail(d: BaselineData): Mail {
  const engines = d.engines.map(engineName).join(", ");
  const notFoundFindings = d.findings.filter((f) => f.verdict === "not_found").length;
  const visibility = d.visibility ?? "found";
  const subject =
    visibility === "unknown"
      ? `Eerste controle van ${d.business.name}: AI vindt (bijna) niets over je`
      : d.wrongAnswers === 0 && !(d.notFoundAnswers ?? 0)
        ? `Eerste controle van ${d.business.name}: alle ${d.totalAnswers} antwoorden kloppen`
        : d.wrongAnswers === 0
          ? `Eerste controle van ${d.business.name}: ${notFoundCountNl(notFoundFindings || d.notFoundAnswers || 0)}`
          : `Eerste controle van ${d.business.name}: ${d.wrongAnswers} ${d.wrongAnswers === 1 ? "antwoord klopt" : "antwoorden kloppen"} niet`;
  const blocks = d.stip ? findingsBySeverityText(d.findings) : d.findings.slice(0, 8).map((f) => findingBlock(f)).join("\n\n");
  const nf = notFoundParagraph({ business: d.business, notFoundAnswers: d.notFoundAnswers, visibility, notFoundFindings });
  const stip = stipParagraph(d);
  const instable = instableText(d.instable);
  const named = namedParagraph(d.recommendations);
  const text = `Hoi,

Op ${formatDateNl(d.checkedAt)} stelden we ${d.totalAnswers} vragen over ${d.business.name} aan ${engines}. ${
    d.wrongAnswers === 0 && !nf
      ? "Alle antwoorden klopten. We controleren volgende maand opnieuw."
      : d.wrongAnswers === 0
        ? "Geen verkeerde antwoorden."
        : `${d.wrongAnswers} ${d.wrongAnswers === 1 ? "antwoord klopte" : "antwoorden klopten"} niet. Dit is wat we vonden en wat we eraan doen.`
  }
${stip ? `\n${stip}\n` : ""}${nf ? `\n${nf}\n` : ""}${blocks ? `\n${blocks}\n` : ""}${d.findings.length > 8 ? `\nEn nog ${d.findings.length - 8} ${d.findings.length - 8 === 1 ? "fout" : "fouten"}, zie je overzicht.\n` : ""}${named ? `\n${named}\n` : ""}${instable ? `\n${instable}\n` : ""}
Elke fout controleren we opnieuw zodra de bron is aangepast. Je hoort van ons als een antwoord is hersteld, met het antwoord van voor en na.

Je overzicht: ${d.links.dashboardUrl}

Groet,
Vidalo
`;
  return mail(subject, text);
}

// ---------------------------------------------------------------------------
// 3. Resolution notice (before / after)
// ---------------------------------------------------------------------------

export interface ResolutionData {
  business: Pick<Business, "name" | "place">;
  finding: Finding;
  before: { quote: string; at: string };
  after: { quote: string; at: string };
  days: number;
  links: Links;
}

export function resolutionNoticeEmail(d: ResolutionData): Mail {
  const w = findingWordsNl(d.finding);
  const engine = engineName(d.finding.engine);
  const subject = `Hersteld: ${engine} zegt nu "${w.correct}" over ${d.business.name}`;
  const text = `Hoi,

${engine} gaf een verkeerd antwoord over ${w.what} van ${d.business.name}. Dat is hersteld.

Voor (${formatDateNl(d.before.at)}):
"${d.before.quote}"

Na (${formatDateNl(d.after.at)}):
"${d.after.quote}"

Bron: ${sourceLine(d.finding)}, hersteld in ${d.days} ${d.days === 1 ? "dag" : "dagen"}.

We blijven dit antwoord elke maand controleren.

Je overzicht: ${d.links.dashboardUrl}

Groet,
Vidalo
`;
  return mail(subject, text);
}

// ---------------------------------------------------------------------------
// 4. Monthly report
// ---------------------------------------------------------------------------

export interface ProofCard {
  findingId: string;
  engine: Engine;
  what: string;
  before: string;
  after: string;
  source: string;
  days: number;
  resolvedAt: string;
}

export interface OpenFindingLine {
  finding: Finding;
  nextStep: string;
  since: string;
}

export interface MonthlyReportData {
  business: Pick<Business, "name" | "place">;
  month: string; // "oktober 2026"
  checkedAt: string;
  totalAnswers: number;
  wrongAnswers: number;
  /** open not_found findings ("3 vragen: AI vindt niets over je") */
  notFound?: number;
  /** answers in which the engine said it has no information */
  notFoundAnswers?: number;
  visibility?: Visibility;
  resolved: number;
  inProgress: number;
  unfixable: number;
  proofCards: ProofCard[];
  openFindings: OpenFindingLine[];
  links: Links;
  engines: Engine[];
  stip?: Stip;
  engineStips?: EngineStip[];
  instable?: InstableFinding[];
  /** recommendation questions: who AI named instead of the business */
  recommendations?: RecommendationSummary[];
}

export function monthlyReportEmail(d: MonthlyReportData): Mail {
  const line = statusLine(d);
  const subject = d.stip ? `${d.business.name} in ${d.month}: ${copy.stip[d.stip].toLowerCase()}, ${line}` : `${d.business.name} in ${d.month}: ${line}`;
  const proofs = d.proofCards
    .map((p) => `${engineName(p.engine)} zei: "${p.before}"\nNu: "${p.after}"\nBron: ${p.source}, hersteld in ${p.days} ${p.days === 1 ? "dag" : "dagen"}.`)
    .join("\n\n");
  const nextStepOf = new Map(d.openFindings.map((o) => [o.finding.id, o.nextStep]));
  const open = d.stip
    ? findingsBySeverityText(
        d.openFindings.map((o) => o.finding),
        { max: 50, nextStepFor: (f) => nextStepOf.get(f.id) ?? fixPathForFinding(f).labelNl },
      )
    : d.openFindings.map((o) => findingBlock(o.finding, { nextStep: o.nextStep })).join("\n\n");
  const nf = notFoundParagraph({ business: d.business, notFoundAnswers: d.notFoundAnswers, visibility: d.visibility, notFoundFindings: d.notFound });
  const stip = stipParagraph(d);
  const instable = instableText(d.instable);
  const named = namedParagraph(d.recommendations);
  const text = `Hoi,

Controle van ${formatDateNl(d.checkedAt)}: ${line}.

We stelden ${d.totalAnswers} vragen over ${d.business.name} aan ${d.engines.map(engineName).join(", ")}.
${stip ? `\n${stip}\n` : ""}${nf ? `\n${nf}\n` : ""}${proofs ? `\nHersteld deze maand\n\n${proofs}\n` : ""}${open ? `\nNog open\n\n${open}\n` : ""}${
    !proofs && !open ? "\nEr is niets te herstellen. Fijn.\n" : ""
  }${named ? `\n${named}\n` : ""}${instable ? `\n${instable}\n` : ""}
Alle antwoorden, met datum en bron: ${d.links.dashboardUrl}

Groet,
Vidalo
`;
  return mail(subject, text);
}

// ---------------------------------------------------------------------------
// 5. Follow-ups for non-customers (day 7 / day 21)
// ---------------------------------------------------------------------------

export interface FollowUpData {
  business: Pick<Business, "name" | "place">;
  wrongAnswers: number;
  totalAnswers: number;
  /** the most striking wrong answer, used in the day-21 subject */
  example: Finding | null;
  links: Links & { resultUrl: string; unsubscribeUrl: string };
  priceSetupEur: number;
  priceMonitorEur: number;
}

export function followUpEmail(d: FollowUpData, day: 7 | 21): Mail {
  const w = d.example ? findingWordsNl(d.example) : null;
  const engine = d.example ? engineName(d.example.engine) : "ChatGPT";
  if (day === 7) {
    const subject = `${d.wrongAnswers} ${d.wrongAnswers === 1 ? "antwoord" : "antwoorden"} over ${d.business.name} ${d.wrongAnswers === 1 ? "klopt" : "kloppen"} niet`;
    const text = `Hoi,

Een week geleden controleerden we wat AI over ${d.business.name} zegt. Van de ${d.totalAnswers} antwoorden klopten er ${d.wrongAnswers} niet.${
      w ? ` ${engine} zei bijvoorbeeld "${w.wrong}" over ${w.what}; het is ${w.correct}.` : ""
    }

Een klant die dit vraagt, krijgt dit antwoord. Niet één keer, elke keer, tot de bron verandert.

Het volledige resultaat, met de bron van elke fout: ${d.links.resultUrl}

Zelf oplossen kan: de bronnen staan erbij. Liever dat wij het doen? Instellen kost ${d.priceSetupEur} euro eenmalig, bewaking ${d.priceMonitorEur} euro per maand, maandelijks opzegbaar. Prijzen excl. btw.

Groet,
Vidalo

Geen mails meer hierover? Afmelden: ${d.links.unsubscribeUrl}
`;
    return mail(subject, text);
  }
  const subject = w ? `Nog steeds "${w.wrong}"` : `Nog steeds ${d.wrongAnswers} ${d.wrongAnswers === 1 ? "fout" : "fouten"} over ${d.business.name}`;
  const text = `Hoi,

Drie weken geleden zagen we dat ${w ? `${engine} "${w.wrong}" zegt over ${w.what} van ${d.business.name}` : `${d.wrongAnswers} antwoorden over ${d.business.name} niet klopten`}. We hebben het vandaag opnieuw gecontroleerd. Het staat er nog.

Resultaat: ${d.links.resultUrl}

Dit is de laatste mail hierover. Wil je dat wij de bronnen herstellen, dan regel je dat via de link. Zo niet, dan laten we je met rust.

Groet,
Vidalo

Geen mails meer hierover? Afmelden: ${d.links.unsubscribeUrl}
`;
  return mail(subject, text);
}

// ---------------------------------------------------------------------------
// 6. Unfixable notice
// ---------------------------------------------------------------------------

export interface UnfixableData {
  business: Pick<Business, "name" | "place">;
  finding: Finding;
  note: string;
  triedDays: number;
  links: Links;
}

export function unfixableNoticeEmail(d: UnfixableData): Mail {
  const w = findingWordsNl(d.finding);
  const engine = engineName(d.finding.engine);
  const subject = `Niet hersteld: ${engine} over ${w.what} van ${d.business.name}`;
  const path = fixPathForFinding(d.finding);
  const text = `Hoi,

${w.notFound ? `${engine} vindt nog steeds niets over ${w.what} van ${d.business.name}. Het is ${w.correct}. We hebben ${d.triedDays} dagen geprobeerd je vindbaar te maken.` : `${engine} zegt nog steeds "${w.wrong}" over ${w.what} van ${d.business.name}. Het is ${w.correct}. We hebben dit ${d.triedDays} dagen geprobeerd te herstellen.`}

Waarom het niet lukte: ${d.note}

Wat we deden: ${path.labelNl}

Wat nu: we laten dit antwoord in je overzicht staan en controleren het elke maand opnieuw. ${
    w.notFound
      ? "Je feitenpagina en je profielen blijven staan. Zodra AI je wel noemt, zie je het in je rapport."
      : d.finding.sourceType === "none"
        ? "Antwoorden uit het geheugen van het model veranderen pas bij een nieuwe versie van dat model. Zodra dat gebeurt, zie je het in je rapport."
        : "Verandert de bron alsnog, dan hoor je het van ons."
  }

Je overzicht: ${d.links.dashboardUrl}

Groet,
Vidalo
`;
  return mail(subject, text);
}
