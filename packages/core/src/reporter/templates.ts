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
import { BRAND, renderMail } from "./layout.js";

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

/**
 * Design G in an e-mail (docs/DESIGN_G.md): white, ink, one blue accent,
 * 1.5px lines, Plus Jakarta Sans where the client has it. The mark (a dot
 * with one straight corner) and the wordmark are HTML, not an image, so they
 * show without loading anything; Outlook desktop draws the mark square.
 * Light only, like the site. Colours are the tokens in apps/web/app/globals.css.
 */

function linkify(line: string): string {
  return esc(line).replace(/(https?:\/\/[^\s)]+)/g, `<a href="$1" style="color:${BRAND.blue};text-decoration:underline;word-break:break-all">$1</a>`);
}

/** The branded HTML version of a plain-text mail: logo, paragraphs with clickable links, the colour dot, the company line. */
export function textToHtml(text: string): string {
  const paras = text.trim().split(/\n{2,}/);
  const body = paras
    .map((p) => {
      const raw = p.split("\n");
      const lines = raw.map(linkify);
      // "Stip: rood. ..." gets its dot in the status colour (status colours only in dots).
      const stip = /^Stip: (rood|oranje|groen|grijs)\b/i.exec(p)?.[1]?.toLowerCase() as Stip | undefined;
      const dot = stip ? `<span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${BRAND.stip[stip]};margin-right:8px;vertical-align:0"></span>` : "";
      // Structure without new wording: a short line opening a block ("Over: ...", "1. Bevestig je gegevens") and a
      // short title on its own ("Wie AI wel noemt", "Afhaker (6): ...") are set in ink, bold. Greetings keep their weight.
      // Lines to paste (robots.txt) are code: monospace on the panel colour, never a heading.
      if (raw.every((l) => /^(User-agent|Allow|Disallow|Sitemap):/i.test(l)))
        return `<pre style="margin:0 0 12px;padding:10px 12px;background:#f4f1ec;border-radius:8px;font:14px/1.5 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:${BRAND.ink};white-space:pre-wrap">${raw.map(esc).join("\n")}</pre>`;
      const first = raw[0]!;
      const opener = raw.length > 1 && first.length <= 90 && !/[,.]$/.test(first) && !/https?:/.test(first) && !stip;
      const title = raw.length === 1 && (/^(Afhaker|Misleider|Verwarring) \(\d+\):/.test(first) || (/^\d+\. /.test(first) && !/[.:?]$/.test(first)) || (first.length <= 40 && !/[.,:?]$/.test(first) && !/https?:/.test(first)));
      if (opener || title) lines[0] = `<strong style="color:${BRAND.ink};font-weight:700">${lines[0]}</strong>`;
      return `<p style="margin:${title ? "24px" : "0"} 0 16px;font-size:16px;line-height:1.55;color:${BRAND.ink2}">${dot}${lines.join("<br>")}</p>`;
    })
    .join("\n");
  const mark = `<span style="display:inline-block;width:17px;height:17px;background:${BRAND.blue};border-radius:999px 999px 999px 2px;vertical-align:-1px;margin-right:6px"></span>`;
  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${BRAND.font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${BRAND.font}">
<tr><td data-brand="vidalo" style="padding:0 0 20px;border-bottom:1.5px solid ${BRAND.line}"><span style="font-size:22px;line-height:1;font-weight:800;letter-spacing:-0.02em;color:${BRAND.ink}">${mark}vidalo</span></td></tr>
<tr><td style="padding:24px 0 8px">${body}</td></tr>
<tr><td style="padding:16px 0 0;border-top:1.5px solid ${BRAND.line};font-size:13px;line-height:1.5;color:${BRAND.muted}">${esc(copy.landing.footer.legal)}</td></tr>
</table></td></tr></table></body></html>`;
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
// shared pieces of the customer mails (layout.ts renders them)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const plus = (iso: string, days: number) => formatDateNl(new Date(Date.parse(iso) + days * DAY_MS).toISOString());
const SEVERITY_ORDER: Record<Severity, number> = { afhaker: 0, misleider: 1, verwarring: 2 };
const SEVERITY_TONE: Record<Severity, Stip> = { afhaker: "rood", misleider: "oranje", verwarring: "grijs" };

/** The most serious findings first (afhakers, then how often the answer came), at most `max`, as cards in the wording of findingBlock. */
export function exampleCards(findings: Finding[], max = 3): { title: string; lines: string[]; tone: Stip }[] {
  return [...findings]
    .sort((a, b) => SEVERITY_ORDER[severityFor(a)] - SEVERITY_ORDER[severityFor(b)] || b.frequency / (b.sampleCount || 1) - a.frequency / (a.sampleCount || 1))
    .slice(0, max)
    .map((f) => {
      const [title, ...lines] = findingBlock(f).split("\n");
      return { title: title!, lines: lines.filter((l) => !l.startsWith("Wat we doen:")), tone: SEVERITY_TONE[severityFor(f)] };
    });
}

/** "Wie AI wel noemt" for the first recommendation question where the business was left out: one card that shows what is at stake. */
function namedCard(recs: RecommendationSummary[] | undefined): { title: string; lines: string[] } | null {
  const N = copy.result.named;
  const r = (recs ?? []).find((x) => x.pool === "core" && x.named < x.answers && x.others.length > 0);
  if (!r) return null;
  return { title: `Vraag: ${r.prompt}`, lines: [N.you(r.named, r.answers), `${N.others}: ${r.others.slice(0, 3).map((o) => `${o.name} (${N.times(o.answers)})`).join(", ")}`] };
}

/** What happens once Vidalo works on it, in the order and the time the fix paths take (fixer/paths.ts: 7 to 30 days). */
const HOW_WE_FIX = {
  title: "Zo herstellen wij het",
  items: [
    { when: "Dag 1", what: "We leggen je gegevens vast en zetten je feitenpagina live." },
    { when: "Week 1", what: "We dienen correcties in bij de bronnen: de gidsen, Google, Bing en Apple." },
    { when: "Week 1 tot 4", what: "We controleren elke bron opnieuw. Je ziet per antwoord of het weer klopt." },
    { when: "Elke maand", what: "Een nieuwe controle van alle vragen, met een kort rapport." },
  ],
};

const offerNote = (setup: number, monitor: number) => `Liever dat wij het herstellen? Instellen kost ${setup} euro eenmalig, bewaking ${monitor} euro per maand, maandelijks opzegbaar. Prijzen excl. btw.`;


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
    ? { title: "2. Eén DNS-regel", lines: ["Maak bij je domeinbeheerder een CNAME aan:", `${d.cname.host}  →  ${d.cname.target}`, "Wij controleren elke 10 minuten of hij er staat. Lukt het niet, dan zetten we de pagina op ons eigen adres."] }
    : { title: "2. Feitenpagina", lines: [`Je hebt geen eigen domein opgegeven. We zetten je feitenpagina op ${d.links.factsPageUrl ?? "ons adres"}. Later verhuizen kan altijd.`] };
  return renderMail({
    subject,
    preheader: `Vier stappen, samen ongeveer 5 minuten. Daarna doen wij de rest.`,
    headline: `Welkom. Zo starten we voor ${d.business.name}.`,
    blocks: [
      { kind: "p", text: `Bedankt voor je bestelling. Vanaf nu controleren we wat AI over ${d.business.name} zegt en herstellen we fouten bij de bron. Om te starten vragen we 4 dingen van je. Samen ongeveer 5 minuten.` },
      {
        kind: "cards",
        items: [
          { title: "1. Bevestig je gegevens", lines: ["Adres, telefoon, openingstijden, wat je wel en niet doet. We hebben ze alvast ingevuld, jij kijkt ze na."] },
          dns,
          { title: "3. Log één keer in bij Google", lines: ["Daarmee mogen we je Google Bedrijfsprofiel lezen en de openingstijden, het telefoonnummer en de website gelijk zetten.", d.links.googleConnectUrl] },
          { title: "4. Wij doen de rest", lines: ["Zodra je DNS-regel staat, is je feitenpagina live. Je Google-profiel werken we direct bij; bij Bing en Apple dienen we de wijziging in en bewaken we de verwerking."] },
        ],
      },
      { kind: "cta", label: "Bevestig je gegevens", url: d.links.confirmFactsUrl, note: `Je overzicht, met alles wat we doen: ${d.links.dashboardUrl}` },
      {
        kind: "steps",
        title: "Wat je daarna van ons krijgt",
        items: [
          { when: "Binnen 48 uur", what: "Je eerste volledige controle, per mail, met de belangrijkste fouten." },
          { when: "Daarna", what: "Een mail zodra een antwoord weer klopt, met het antwoord van voor en na." },
          { when: "Elke maand", what: "Een nieuwe controle en een kort rapport. Alles staat in je overzicht." },
        ],
      },
      { kind: "note", text: "Vragen? Antwoord op deze mail." },
    ],
  });
}

// ---------------------------------------------------------------------------
// 2. Baseline summary (day 2)
// ---------------------------------------------------------------------------

export interface BaselineData {
  business: Pick<Business, "name" | "place">;
  /** a paying customer: the button goes to the account, else to the report page (links.resultUrl) with the offer */
  paying?: boolean;
  offer?: { setupEur: number; monitorEur: number };
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
  const nf = notFoundParagraph({ business: d.business, notFoundAnswers: d.notFoundAnswers, visibility, notFoundFindings });
  // Paying: the full picture is the account. Before that: the report page, which needs no account.
  const full = d.paying ? { label: "Bekijk alles in je overzicht", url: d.links.dashboardUrl, where: "in je overzicht" } : { label: "Bekijk je volledige resultaat", url: d.links.resultUrl ?? d.links.dashboardUrl, where: "in je resultaat" };
  const cards = exampleCards(d.findings);
  const more = d.findings.length - cards.length;
  const named = namedCard(d.recommendations);
  const per = (d.engineStips ?? []).map((e) => `${engineName(e.engine)}: ${copy.stip[e.stip].toLowerCase()}`);
  const recheck = d.findings.map((f) => fixPathForFinding(f).recheckDays).filter((n) => n > 0);
  const headline =
    d.wrongAnswers > 0
      ? `${d.wrongAnswers} van de ${d.totalAnswers} antwoorden over ${d.business.name} kloppen niet`
      : visibility === "unknown"
        ? `AI vindt (bijna) niets over ${d.business.name}`
        : nf
          ? `AI vindt een deel van ${d.business.name} niet`
          : `Alle ${d.totalAnswers} antwoorden over ${d.business.name} kloppen`;
  return renderMail({
    subject,
    preheader: d.wrongAnswers > 0 ? `De belangrijkste fouten staan in deze mail, de rest ${full.where}.` : `We controleren elke maand opnieuw.`,
    headline,
    stip: d.stip,
    stipText: d.stip ? `${copy.stipMeaning[d.stip]}. ${copy.stipLine[d.stip]}` : undefined,
    blocks: [
      { kind: "p", text: `Op ${formatDateNl(d.checkedAt)} stelden we ${d.totalAnswers} vragen over ${d.business.name} aan ${engines}.` },
      ...(per.length ? [{ kind: "note" as const, text: `Per AI: ${per.join(", ")}.` }] : []),
      {
        kind: "stats",
        items: [
          { value: String(d.totalAnswers), label: "antwoorden gecontroleerd" },
          { value: String(d.wrongAnswers), label: d.wrongAnswers === 1 ? "klopte niet" : "klopten niet" },
          ...(d.notFoundAnswers ? [{ value: String(d.notFoundAnswers), label: "waren leeg" }] : []),
        ],
      },
      ...(nf ? [{ kind: "p" as const, text: nf }] : []),
      ...(cards.length ? [{ kind: "cards" as const, title: cards.length === 1 ? "De fout" : "De belangrijkste fouten", items: cards }] : []),
      ...(more > 0 ? [{ kind: "p" as const, text: `En nog ${more} ${more === 1 ? "fout" : "fouten"}. Alles staat ${full.where}, met de bron van elke fout en wat we eraan doen.` }] : []),
      ...(named ? [{ kind: "cards" as const, title: copy.result.named.h2, items: [named] }] : []),
      { kind: "cta", label: full.label, url: full.url, note: d.paying ? undefined : d.offer ? offerNote(d.offer.setupEur, d.offer.monitorEur) : undefined },
      d.paying
        ? {
            kind: "steps",
            title: "Wat er nu gebeurt",
            items: [
              { when: "Vandaag", what: "We dienen de eerste correcties in bij de bronnen.", done: true },
              ...(recheck.length ? [{ when: `Rond ${plus(d.checkedAt, Math.min(...recheck))}`, what: "De eerste hercontroles. Je hoort het zodra een antwoord weer klopt." }] : []),
              // The last rechecks only get their own line when they fall before the monthly check.
              ...(recheck.length && Math.max(...recheck) > Math.min(...recheck) && Math.max(...recheck) < 30 ? [{ when: `Rond ${plus(d.checkedAt, Math.max(...recheck))}`, what: "De laatste bronnen opnieuw gecontroleerd." }] : []),
              { when: `Rond ${plus(d.checkedAt, 30)}`, what: "Je volgende maandcontrole." },
            ],
          }
        : { kind: "steps", ...HOW_WE_FIX },
    ],
  });
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
  return renderMail({
    subject,
    preheader: `Van "${d.before.quote.slice(0, 60)}" naar het goede antwoord, in ${d.days} ${d.days === 1 ? "dag" : "dagen"}.`,
    headline: `${engine} geeft weer het goede antwoord over ${w.what}`,
    blocks: [
      { kind: "p", text: `${engine} gaf een verkeerd antwoord over ${w.what} van ${d.business.name}. Dat is hersteld.` },
      {
        kind: "cards",
        items: [
          { title: `Voor (${formatDateNl(d.before.at)})`, lines: [`"${d.before.quote}"`], tone: "rood" },
          { title: `Na (${formatDateNl(d.after.at)})`, lines: [`"${d.after.quote}"`], tone: "groen" },
        ],
      },
      { kind: "p", text: `Bron: ${sourceLine(d.finding)}, hersteld in ${d.days} ${d.days === 1 ? "dag" : "dagen"}. We blijven dit antwoord elke maand controleren.` },
      { kind: "cta", label: "Bekijk je overzicht", url: d.links.dashboardUrl },
    ],
  });
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
  const nf = notFoundParagraph({ business: d.business, notFoundAnswers: d.notFoundAnswers, visibility: d.visibility, notFoundFindings: d.notFound });
  const proofs = d.proofCards.slice(0, 3).map((p) => ({ title: `${engineName(p.engine)} over ${p.what}`, lines: [`Was: "${p.before}"`, `Nu: "${p.after}"`, `Bron: ${p.source}, hersteld in ${p.days} ${p.days === 1 ? "dag" : "dagen"}.`], tone: "groen" as Stip }));
  const open = exampleCards(d.openFindings.map((o) => o.finding));
  const moreOpen = d.openFindings.length - open.length;
  const moreProofs = d.proofCards.length - proofs.length;
  return renderMail({
    subject,
    preheader: `${line}. Wat er hersteld is en wat er nu gebeurt.`,
    headline: `${d.month[0]!.toUpperCase()}${d.month.slice(1)}: ${line}`,
    stip: d.stip,
    stipText: d.stip ? `${copy.stipMeaning[d.stip]}. ${copy.stipLine[d.stip]}` : undefined,
    blocks: [
      { kind: "p", text: `Controle van ${formatDateNl(d.checkedAt)}. We stelden ${d.totalAnswers} vragen over ${d.business.name} aan ${d.engines.map(engineName).join(", ")}.` },
      {
        kind: "stats",
        items: [
          { value: String(d.resolved), label: "hersteld" },
          { value: String(d.inProgress), label: "in behandeling" },
          ...(d.unfixable ? [{ value: String(d.unfixable), label: "niet te herstellen" }] : []),
        ],
      },
      ...(nf ? [{ kind: "p" as const, text: nf }] : []),
      ...(proofs.length ? [{ kind: "cards" as const, title: "Hersteld deze maand", items: proofs }] : []),
      ...(moreProofs > 0 ? [{ kind: "p" as const, text: `En nog ${moreProofs} hersteld.` }] : []),
      ...(open.length ? [{ kind: "cards" as const, title: "Nog open, de belangrijkste", items: open }] : []),
      ...(moreOpen > 0 ? [{ kind: "p" as const, text: `En nog ${moreOpen} open. Bij elk staat in je overzicht wat we doen en wanneer we opnieuw kijken.` }] : []),
      ...(!proofs.length && !open.length ? [{ kind: "p" as const, text: "Er is niets te herstellen. Fijn." }] : []),
      { kind: "cta", label: "Bekijk alles in je overzicht", url: d.links.dashboardUrl },
      {
        kind: "steps",
        title: "De komende weken",
        items: [
          { when: "Tussendoor", what: "Een mail zodra een antwoord weer klopt, met het antwoord van voor en na." },
          { when: `Rond ${plus(d.checkedAt, 30)}`, what: "Je volgende maandcontrole." },
        ],
      },
    ],
  });
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
  const example = d.example ? exampleCards([d.example], 1) : [];
  const cta = { kind: "cta" as const, label: "Bekijk je volledige resultaat", url: d.links.resultUrl, note: offerNote(d.priceSetupEur, d.priceMonitorEur) };
  if (day === 7) {
    const subject = `${d.wrongAnswers} ${d.wrongAnswers === 1 ? "antwoord" : "antwoorden"} over ${d.business.name} ${d.wrongAnswers === 1 ? "klopt" : "kloppen"} niet`;
    return renderMail({
      subject,
      preheader: w ? `${engine} zegt "${w.wrong}" over ${w.what}. Het is ${w.correct}.` : `De bron van elke fout staat in je resultaat.`,
      headline: `${d.wrongAnswers} van de ${d.totalAnswers} antwoorden over ${d.business.name} kloppen niet`,
      blocks: [
        { kind: "p", text: `Een week geleden controleerden we wat AI over ${d.business.name} zegt. Een klant die het vraagt, krijgt dit antwoord. Niet één keer, elke keer, tot de bron verandert.` },
        ...(example.length ? [{ kind: "cards" as const, title: "Bijvoorbeeld", items: example }] : []),
        { kind: "p", text: "Zelf oplossen kan: de bronnen staan in je resultaat." },
        cta,
        { kind: "steps", ...HOW_WE_FIX },
      ],
      unsubscribeUrl: d.links.unsubscribeUrl,
    });
  }
  const subject = w ? `Nog steeds "${w.wrong}"` : `Nog steeds ${d.wrongAnswers} ${d.wrongAnswers === 1 ? "fout" : "fouten"} over ${d.business.name}`;
  return renderMail({
    subject,
    preheader: `We hebben het vandaag opnieuw gecontroleerd. Dit is de laatste mail hierover.`,
    headline: w ? `${engine} zegt nog steeds "${w.wrong}"` : `Nog steeds ${d.wrongAnswers} fouten over ${d.business.name}`,
    blocks: [
      { kind: "p", text: `Drie weken geleden zagen we dat ${w ? `${engine} "${w.wrong}" zegt over ${w.what} van ${d.business.name}` : `${d.wrongAnswers} antwoorden over ${d.business.name} niet klopten`}. We hebben het vandaag opnieuw gecontroleerd. Het staat er nog.` },
      ...(example.length ? [{ kind: "cards" as const, items: example }] : []),
      cta,
      { kind: "note", text: "Dit is de laatste mail hierover. Wil je dat wij de bronnen herstellen, dan regel je dat via je resultaat. Zo niet, dan laten we je met rust." },
    ],
    unsubscribeUrl: d.links.unsubscribeUrl,
  });
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
