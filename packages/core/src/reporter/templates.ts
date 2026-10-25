/**
 * Customer e-mails (docs/MESSAGING.md), in the owner's language: the wording
 * lives in copy.mails (copy/index.ts, Dutch, the source; copy/en.ts), the
 * structure here. Every data object takes `lang` (business.language), Dutch
 * when it is left out.
 *
 * Rules: informal "je", calm verbs (controleren, vinden, herstellen, laten
 * zien), one number per claim, no exclamation marks, no countdowns, no jargon
 * (no GEO/AEO/LLM/prompt/credits/garantie). Every mail is pure data in → text out.
 */
import type { Business, Engine, EngineStip, Finding, InstableFinding, RecommendationSummary, Severity, Stip, Visibility } from "../types.js";
import { ENGINE_LABEL } from "../types.js";
import { copy, copyFor, type Lang } from "../copy/index.js";
import { criteriumFor, severityOf } from "../criteria.js";
import { findingWordsNl, hostOfUrl } from "../shared/facts-nl.js";
import { findingWords } from "../shared/facts-en.js";
import { FIX_PATHS, NOT_FOUND_PATH, RECOMMENDATION_PATH, fixPathForFinding, type FixPath } from "../fixer/paths.js";
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
export function textToHtml(text: string, lang: Lang = "nl"): string {
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
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${BRAND.font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;font-family:${BRAND.font}">
<tr><td data-brand="vidalo" style="padding:0 0 20px;border-bottom:1.5px solid ${BRAND.line}"><span style="font-size:22px;line-height:1;font-weight:800;letter-spacing:-0.02em;color:${BRAND.ink}">${mark}vidalo</span></td></tr>
<tr><td style="padding:24px 0 8px">${body}</td></tr>
<tr><td style="padding:16px 0 0;border-top:1.5px solid ${BRAND.line};font-size:13px;line-height:1.5;color:${BRAND.muted}">${esc(copyFor(lang).landing.footer.legal)}</td></tr>
</table></td></tr></table></body></html>`;
}

function mail(subject: string, text: string, lang: Lang = "nl"): Mail {
  return { subject, text, html: textToHtml(text, lang) };
}

/** "2 oktober 2026" / "2 October 2026", in Europe/Amsterdam. */
export function formatMailDate(iso: string | Date, lang: Lang = "nl"): string {
  if (lang === "nl") return formatDateNl(iso);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(typeof iso === "string" ? new Date(iso) : iso);
}

/** "oktober 2026" / "October 2026": the month a monthly report covers. */
export function monthLabel(d: Date = new Date(), lang: Lang = "nl"): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "nl-NL", { month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(d);
}

/** What a fix path does, in the owner's language. */
export function fixLabel(path: FixPath, lang: Lang = "nl"): string {
  return lang === "en" ? path.labelEn : path.labelNl;
}

/** Why a fix stopped, in the owner's language. The fixer stores a path's own Dutch note; a note written by hand stays as written. */
export function unfixableNote(note: string, lang: Lang = "nl"): string {
  if (lang === "nl") return note;
  if (note === UNFIXABLE_DEFAULT_NL) return "The source was not changed.";
  return [...Object.values(FIX_PATHS), NOT_FOUND_PATH, RECOMMENDATION_PATH].find((p) => p.unfixableNoteNl === note)?.unfixableNoteEn ?? note;
}

/** The note the fixer sends when a path has none of its own (fixer/index.ts). */
export const UNFIXABLE_DEFAULT_NL = "De bron is niet aangepast.";

export function engineName(engine: Engine): string {
  return ENGINE_LABEL[engine] ?? engine;
}

/**
 * "12 van 12 antwoorden kloppen" / "2 fouten gevonden, 1 hersteld, 1 in behandeling".
 * Not-found answers are reported next to the wrong ones, never as wrong:
 * "2 fouten gevonden, 3 vragen: AI vindt niets over je".
 */
export function statusLine(stats: { totalAnswers: number; wrongAnswers: number; resolved: number; inProgress: number; unfixable?: number; notFound?: number }, lang: Lang = "nl"): string {
  const M = copyFor(lang).mails;
  const notFound = stats.notFound ?? 0;
  if (stats.wrongAnswers === 0 && stats.resolved === 0 && notFound === 0) return M.status.allRight(stats.totalAnswers);
  const parts: string[] = [];
  const found = stats.wrongAnswers + stats.resolved;
  if (found || !notFound) parts.push(M.status.found(found));
  if (stats.resolved) parts.push(M.status.resolved(stats.resolved));
  if (stats.inProgress) parts.push(M.status.inProgress(stats.inProgress));
  if (stats.unfixable) parts.push(M.status.unfixable(stats.unfixable));
  if (notFound) parts.push(M.notFoundCount(notFound));
  return parts.join(", ");
}

function sourceLine(f: Finding, lang: Lang = "nl"): string {
  const S = copyFor(lang).mails.source;
  const host = hostOfUrl(f.sourceUrl);
  switch (f.sourceType) {
    case "none":
      return S.none;
    case "other_entity":
      return S.otherEntity(host);
    case "owned_website":
      return S.ownedWebsite(host);
    case "owned_facts_page":
      return S.factsPage;
    default:
      return host ?? S.unknown;
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

/** One finding as lines: Vraag / Engine zei / Klopt niet / Bron, without "Wat we doen". */
function findingLines(f: Finding, opts: { promptText?: string | null; lang?: Lang } = {}): string[] {
  const lang = opts.lang ?? "nl";
  const C = copyFor(lang);
  const F = C.mails.finding;
  const w = findingWords(f, lang);
  const engine = engineName(f.engine);
  if (w.recommendation) {
    // The business was not named where its facts say it belongs; the fact itself is the evidence.
    return [
      opts.promptText ? F.question(opts.promptText) : F.recommendationAbout(w.what),
      F.notNamed(engine, w.frequency),
      `${C.recommendation.line} ${F.yourValue(w.correct)}`,
      f.sourceType === "none" ? C.recommendation.noSource : F.from(sourceLine(f, lang)),
    ];
  }
  if (w.notFound) {
    // No wrong value and no source: the engine knows nothing about the business.
    return [opts.promptText ? F.question(opts.promptText) : F.about(w.what), `${engine} ${w.notFoundLine} (${w.frequency})`, F.notFound(w.correct)];
  }
  const other = f.sourceType === "other_entity";
  return [
    opts.promptText ? F.question(opts.promptText) : F.about(w.what),
    other ? F.otherEntity(engine, w.frequency) : F.said(engine, w.wrong, w.frequency),
    other ? F.wrongYours(w.correct) : F.wrongIs(w.correct),
    F.from(sourceLine(f, lang)),
  ];
}

/** One finding as a short block: Vraag / Engine zei / Klopt niet / Bron / Wat we doen. */
export function findingBlock(f: Finding, opts: { promptText?: string | null; nextStep?: string; lang?: Lang } = {}): string {
  const lang = opts.lang ?? "nl";
  const next = opts.nextStep ?? fixLabel(fixPathForFinding(f), lang);
  return [...findingLines(f, opts), copyFor(lang).mails.finding.whatWeDo(next)].join("\n");
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
export function notFoundParagraph(d: { business: Pick<Business, "name">; notFoundAnswers?: number; visibility?: Visibility; notFoundFindings?: number; lang?: Lang }): string {
  const M = copyFor(d.lang ?? "nl").mails;
  const n = d.notFoundAnswers ?? 0;
  const v = d.visibility ?? "found";
  if (!n && v === "found") return "";
  const parts: string[] = [];
  if (d.notFoundFindings) parts.push(`${M.notFoundCount(d.notFoundFindings)}.`);
  if (n) parts.push(M.emptyAnswers(n));
  if (v !== "found") parts.push(M.visibility[v](d.business.name));
  if (v !== "found") parts.push(M.notCounted);
  return parts.join(" ");
}


// ---------------------------------------------------------------------------
// shared pieces of the customer mails (layout.ts renders them)
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const plus = (iso: string, days: number, lang: Lang) => formatMailDate(new Date(Date.parse(iso) + days * DAY_MS).toISOString(), lang);
const SEVERITY_ORDER: Record<Severity, number> = { afhaker: 0, misleider: 1, verwarring: 2 };
const SEVERITY_TONE: Record<Severity, Stip> = { afhaker: "rood", misleider: "oranje", verwarring: "grijs" };

/** The most serious findings first (afhakers, then how often the answer came), at most `max`, as cards in the wording of findingBlock. */
export function exampleCards(findings: Finding[], max = 3, lang: Lang = "nl"): { title: string; lines: string[]; tone: Stip }[] {
  return [...findings]
    .sort((a, b) => SEVERITY_ORDER[severityFor(a)] - SEVERITY_ORDER[severityFor(b)] || b.frequency / (b.sampleCount || 1) - a.frequency / (a.sampleCount || 1))
    .slice(0, max)
    .map((f) => {
      const [title, ...lines] = findingLines(f, { lang });
      return { title: title!, lines, tone: SEVERITY_TONE[severityFor(f)] };
    });
}

/** "Wie AI wel noemt" for the first recommendation question where the business was left out: one card that shows what is at stake. */
function namedCard(recs: RecommendationSummary[] | undefined, lang: Lang): { title: string; lines: string[] } | null {
  const C = copyFor(lang);
  const N = C.result.named;
  const r = (recs ?? []).find((x) => x.pool === "core" && x.named < x.answers && x.others.length > 0);
  if (!r) return null;
  // The question as it was asked: the scanner asks in Dutch (prompts/sectors.ts), like the report page shows it.
  return { title: C.mails.finding.question(r.prompt), lines: [N.you(r.named, r.answers), `${N.others}: ${r.others.slice(0, 3).map((o) => `${o.name} (${N.times(o.answers)})`).join(", ")}`] };
}

/** What happens once Vidalo works on it (copy.mails.howWeFix), as a steps block. */
const howWeFix = (lang: Lang) => {
  const H = copyFor(lang).mails.howWeFix;
  return { kind: "steps" as const, title: H.title, items: H.items.map((i) => ({ ...i })) };
};


// ---------------------------------------------------------------------------
// 1. Welcome after checkout (4 steps)
// ---------------------------------------------------------------------------

export interface WelcomeData {
  business: Pick<Business, "name" | "place" | "domain">;
  links: Links & { confirmFactsUrl: string; googleConnectUrl: string };
  /** CNAME instruction when the owner has a domain */
  cname?: { host: string; target: string } | null;
  lang?: Lang;
}

export function welcomeEmail(d: WelcomeData): Mail {
  const lang = d.lang ?? "nl";
  const W = copyFor(lang).mails.welcome;
  const dns = d.cname
    ? { title: W.dns.title, lines: [W.dns.lead, `${d.cname.host}  →  ${d.cname.target}`, W.dns.check] }
    : { title: W.noDomain.title, lines: [W.noDomain.line(d.links.factsPageUrl ?? W.noDomain.ourAddress)] };
  return renderMail({
    lang,
    subject: W.subject(d.business.name),
    preheader: W.preheader,
    headline: W.headline(d.business.name),
    blocks: [
      { kind: "p", text: W.intro(d.business.name) },
      {
        kind: "cards",
        items: [
          { title: W.facts.title, lines: [W.facts.line] },
          dns,
          { title: W.google.title, lines: [W.google.line, d.links.googleConnectUrl] },
          { title: W.rest.title, lines: [W.rest.line] },
        ],
      },
      { kind: "cta", label: W.cta, url: d.links.confirmFactsUrl, note: W.ctaNote(d.links.dashboardUrl) },
      { kind: "steps", title: W.after.title, items: W.after.items.map((i) => ({ ...i })) },
      { kind: "note", text: W.questions },
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
  lang?: Lang;
}

export function baselineSummaryEmail(d: BaselineData): Mail {
  const lang = d.lang ?? "nl";
  const C = copyFor(lang);
  const M = C.mails;
  const B = M.baseline;
  const engines = d.engines.map(engineName).join(", ");
  const notFoundFindings = d.findings.filter((f) => f.verdict === "not_found").length;
  const visibility = d.visibility ?? "found";
  const name = d.business.name;
  const subject =
    visibility === "unknown"
      ? B.subject.unknown(name)
      : d.wrongAnswers === 0 && !(d.notFoundAnswers ?? 0)
        ? B.subject.clean(name, d.totalAnswers)
        : d.wrongAnswers === 0
          ? B.subject.notFound(name, M.notFoundCount(notFoundFindings || d.notFoundAnswers || 0))
          : B.subject.wrong(name, d.wrongAnswers);
  const nf = notFoundParagraph({ business: d.business, notFoundAnswers: d.notFoundAnswers, visibility, notFoundFindings, lang });
  // Paying: the full picture is the account. Before that: the report page, which needs no account.
  const full = d.paying ? { ...M.full.paying, url: d.links.dashboardUrl } : { ...M.full.free, url: d.links.resultUrl ?? d.links.dashboardUrl };
  const cards = exampleCards(d.findings, 3, lang);
  const more = d.findings.length - cards.length;
  const named = namedCard(d.recommendations, lang);
  const per = (d.engineStips ?? []).map((e) => `${engineName(e.engine)}: ${C.stip[e.stip].toLowerCase()}`);
  const recheck = d.findings.map((f) => fixPathForFinding(f).recheckDays).filter((n) => n > 0);
  const headline =
    d.wrongAnswers > 0
      ? B.headline.wrong(d.wrongAnswers, d.totalAnswers, name)
      : visibility === "unknown"
        ? B.headline.unknown(name)
        : nf
          ? B.headline.partial(name)
          : B.headline.clean(d.totalAnswers, name);
  return renderMail({
    lang,
    subject,
    preheader: d.wrongAnswers > 0 ? B.preheader.wrong(full.where) : B.preheader.clean,
    headline,
    stip: d.stip,
    stipText: d.stip ? `${C.stipMeaning[d.stip]}. ${C.stipLine[d.stip]}` : undefined,
    blocks: [
      { kind: "p", text: B.intro(formatMailDate(d.checkedAt, lang), d.totalAnswers, name, engines) },
      ...(per.length ? [{ kind: "note" as const, text: M.perAi(per.join(", ")) }] : []),
      {
        kind: "stats",
        items: [
          { value: String(d.totalAnswers), label: B.stats.checked },
          { value: String(d.wrongAnswers), label: B.stats.wrong(d.wrongAnswers) },
          ...(d.notFoundAnswers ? [{ value: String(d.notFoundAnswers), label: B.stats.empty }] : []),
        ],
      },
      ...(nf ? [{ kind: "p" as const, text: nf }] : []),
      ...(cards.length ? [{ kind: "cards" as const, title: B.cardsTitle(cards.length), items: cards }] : []),
      ...(more > 0 ? [{ kind: "p" as const, text: B.more(more, full.where) }] : []),
      ...(named ? [{ kind: "cards" as const, title: C.result.named.h2, items: [named] }] : []),
      { kind: "cta", label: full.label, url: full.url, note: d.paying ? undefined : d.offer ? M.offer(d.offer.setupEur, d.offer.monitorEur) : undefined },
      d.paying
        ? {
            kind: "steps",
            title: B.next.title,
            items: [
              { ...B.next.today, done: true },
              ...(recheck.length ? [{ when: M.around(plus(d.checkedAt, Math.min(...recheck), lang)), what: B.next.firstRechecks }] : []),
              // The last rechecks only get their own line when they fall before the monthly check.
              ...(recheck.length && Math.max(...recheck) > Math.min(...recheck) && Math.max(...recheck) < 30 ? [{ when: M.around(plus(d.checkedAt, Math.max(...recheck), lang)), what: B.next.lastRechecks }] : []),
              { when: M.around(plus(d.checkedAt, 30, lang)), what: M.nextMonthly },
            ],
          }
        : howWeFix(lang),
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
  lang?: Lang;
}

export function resolutionNoticeEmail(d: ResolutionData): Mail {
  const lang = d.lang ?? "nl";
  const M = copyFor(lang).mails;
  const R = M.resolution;
  const w = findingWords(d.finding, lang);
  const engine = engineName(d.finding.engine);
  return renderMail({
    lang,
    subject: R.subject(engine, w.correct, d.business.name),
    preheader: R.preheader(d.before.quote.slice(0, 60), M.days(d.days)),
    headline: R.headline(engine, w.what),
    blocks: [
      { kind: "p", text: R.intro(engine, w.what, d.business.name) },
      {
        kind: "cards",
        items: [
          { title: R.before(formatMailDate(d.before.at, lang)), lines: [`"${d.before.quote}"`], tone: "rood" },
          { title: R.after(formatMailDate(d.after.at, lang)), lines: [`"${d.after.quote}"`], tone: "groen" },
        ],
      },
      { kind: "p", text: R.source(sourceLine(d.finding, lang), M.days(d.days)) },
      { kind: "cta", label: R.cta, url: d.links.dashboardUrl },
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
  lang?: Lang;
}

export function monthlyReportEmail(d: MonthlyReportData): Mail {
  const lang = d.lang ?? "nl";
  const C = copyFor(lang);
  const M = C.mails;
  const R = M.monthly;
  const line = statusLine(d, lang);
  const subject = d.stip ? R.subjectStip(d.business.name, d.month, C.stip[d.stip].toLowerCase(), line) : R.subject(d.business.name, d.month, line);
  const nf = notFoundParagraph({ business: d.business, notFoundAnswers: d.notFoundAnswers, visibility: d.visibility, notFoundFindings: d.notFound, lang });
  const proofs = d.proofCards.slice(0, 3).map((p) => ({ title: R.proofTitle(engineName(p.engine), p.what), lines: [R.was(p.before), R.now(p.after), R.proofSource(p.source, M.days(p.days))], tone: "groen" as Stip }));
  const open = exampleCards(d.openFindings.map((o) => o.finding), 3, lang);
  const moreOpen = d.openFindings.length - open.length;
  const moreProofs = d.proofCards.length - proofs.length;
  return renderMail({
    lang,
    subject,
    preheader: R.preheader(line),
    headline: `${d.month[0]!.toUpperCase()}${d.month.slice(1)}: ${line}`,
    stip: d.stip,
    stipText: d.stip ? `${C.stipMeaning[d.stip]}. ${C.stipLine[d.stip]}` : undefined,
    blocks: [
      { kind: "p", text: R.intro(formatMailDate(d.checkedAt, lang), d.totalAnswers, d.business.name, d.engines.map(engineName).join(", ")) },
      {
        kind: "stats",
        items: [
          { value: String(d.resolved), label: R.stats.resolved },
          { value: String(d.inProgress), label: R.stats.inProgress },
          ...(d.unfixable ? [{ value: String(d.unfixable), label: R.stats.unfixable }] : []),
        ],
      },
      ...(nf ? [{ kind: "p" as const, text: nf }] : []),
      ...(proofs.length ? [{ kind: "cards" as const, title: R.fixedTitle, items: proofs }] : []),
      ...(moreProofs > 0 ? [{ kind: "p" as const, text: R.moreFixed(moreProofs) }] : []),
      ...(open.length ? [{ kind: "cards" as const, title: R.openTitle, items: open }] : []),
      ...(moreOpen > 0 ? [{ kind: "p" as const, text: R.moreOpen(moreOpen) }] : []),
      ...(!proofs.length && !open.length ? [{ kind: "p" as const, text: R.nothing }] : []),
      { kind: "cta", label: R.cta, url: d.links.dashboardUrl },
      {
        kind: "steps",
        title: R.weeks.title,
        items: [{ ...R.weeks.meanwhile }, { when: M.around(plus(d.checkedAt, 30, lang)), what: M.nextMonthly }],
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
  lang?: Lang;
}

export function followUpEmail(d: FollowUpData, day: 7 | 21): Mail {
  const lang = d.lang ?? "nl";
  const M = copyFor(lang).mails;
  const w = d.example ? findingWords(d.example, lang) : null;
  const engine = d.example ? engineName(d.example.engine) : "ChatGPT";
  const example = d.example ? exampleCards([d.example], 1, lang) : [];
  const name = d.business.name;
  const cta = { kind: "cta" as const, label: M.full.free.label, url: d.links.resultUrl, note: M.offer(d.priceSetupEur, d.priceMonitorEur) };
  if (day === 7) {
    const F = M.followUp.day7;
    return renderMail({
      lang,
      subject: F.subject(d.wrongAnswers, name),
      preheader: w ? F.preheader(engine, w.wrong, w.what, w.correct) : F.preheaderPlain,
      headline: F.headline(d.wrongAnswers, d.totalAnswers, name),
      blocks: [
        { kind: "p", text: F.intro(name) },
        ...(example.length ? [{ kind: "cards" as const, title: F.example, items: example }] : []),
        { kind: "p", text: F.selfFix },
        cta,
        howWeFix(lang),
      ],
      unsubscribeUrl: d.links.unsubscribeUrl,
    });
  }
  const F = M.followUp.day21;
  return renderMail({
    lang,
    subject: w ? F.subject(w.wrong) : F.subjectPlain(d.wrongAnswers, name),
    preheader: F.preheader,
    headline: w ? F.headline(engine, w.wrong) : F.headlinePlain(d.wrongAnswers, name),
    blocks: [
      { kind: "p", text: F.intro(w ? F.seen(engine, w.wrong, w.what, name) : F.seenPlain(d.wrongAnswers, name)) },
      ...(example.length ? [{ kind: "cards" as const, items: example }] : []),
      cta,
      { kind: "note", text: F.last },
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
  lang?: Lang;
}

export function unfixableNoticeEmail(d: UnfixableData): Mail {
  const lang = d.lang ?? "nl";
  const M = copyFor(lang).mails;
  const U = M.unfixable;
  const w = findingWords(d.finding, lang);
  const engine = engineName(d.finding.engine);
  const name = d.business.name;
  const path = fixPathForFinding(d.finding);
  const tail = w.notFound ? U.tail.notFound : d.finding.sourceType === "none" ? U.tail.memory : U.tail.source;
  const text = `${M.hi}

${w.notFound ? U.notFound(engine, w.what, name, w.correct, d.triedDays) : U.wrong(engine, w.wrong, w.what, name, w.correct, d.triedDays)}

${U.why(unfixableNote(d.note, lang))}

${U.did(fixLabel(path, lang))}

${U.next(tail)}

${M.overview(d.links.dashboardUrl)}

${M.regards}
`;
  return mail(U.subject(engine, w.what, name), text, lang);
}
