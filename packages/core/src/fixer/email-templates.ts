/**
 * Dutch e-mails the fixer sends.
 *
 * 1. Correction request to a third party (directory, news site, wiki) in the
 *    owner's name: factual, polite, the exact wrong value, the correct value,
 *    the facts page as reference, one sentence why. No marketing.
 * 2. Owner instruction for owned_website: "Op pagina X staat Y; dit moet Z zijn."
 * 3. Follow-up to a third party after 14 days without change.
 *
 * Tone: calm, "u" towards third parties (business-to-business, unknown person),
 * "je" towards the owner. No exclamation marks.
 *
 * Letters to third parties stay Dutch: they go to Dutch organisations, signed
 * by the owner. Mails to the owner follow business.language (copy.mails.ownWebsite).
 */
import type { Business, Finding } from "../types.js";
import { findingWordsNl, hostOfUrl } from "../shared/facts-nl.js";
import { findingWords } from "../shared/facts-en.js";
import { copyFor, type Lang } from "../copy/index.js";
import type { ChannelDiffEntry } from "../publisher/channels/types.js";

export interface Mail {
  subject: string;
  text: string;
  html?: string;
}

export interface CorrectionContext {
  business: Pick<Business, "name" | "place" | "ownerEmail"> & { kvk?: string | null };
  factsPageUrl: string;
  /** the person signing; defaults to "de eigenaar van {name}" */
  signer?: string;
}

function signature(ctx: CorrectionContext): string {
  const who = ctx.signer ?? `de eigenaar van ${ctx.business.name}`;
  const lines = [who, `${ctx.business.name}, ${ctx.business.place}`];
  if (ctx.business.ownerEmail) lines.push(ctx.business.ownerEmail);
  if (ctx.business.kvk) lines.push(`KvK ${ctx.business.kvk}`);
  return lines.join("\n");
}

/** Correction request for one finding, to the site that carries the wrong value. */
export function correctionRequestEmail(finding: Finding, ctx: CorrectionContext): Mail {
  const w = findingWordsNl(finding);
  const site = hostOfUrl(finding.sourceUrl) ?? "uw website";
  const subject = `Correctie gegevens ${ctx.business.name}, ${ctx.business.place}`;
  const text = `Geachte heer/mevrouw,

Op ${site} staat een onjuist gegeven over ${ctx.business.name} in ${ctx.business.place}.${finding.sourceUrl ? `

Pagina: ${finding.sourceUrl}` : ""}

Wat er staat (${w.what}): ${w.wrong}
Wat het moet zijn: ${w.correct}

Wilt u dit aanpassen? AI-assistenten zoals ChatGPT nemen dit gegeven van uw pagina over, waardoor klanten nu een verkeerd antwoord krijgen.

De actuele gegevens staan op onze feitenpagina, bevestigd door de eigenaar:
${ctx.factsPageUrl}

Alvast bedankt.

Met vriendelijke groet,
${signature(ctx)}
`;
  return { subject, text };
}

/** Follow-up when the third party has not changed the value after the first request. */
export function correctionFollowUpEmail(finding: Finding, ctx: CorrectionContext, firstSentAt: string): Mail {
  const w = findingWordsNl(finding);
  const site = hostOfUrl(finding.sourceUrl) ?? "uw website";
  const date = new Date(firstSentAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", timeZone: "Europe/Amsterdam" });
  const subject = `Herinnering: correctie gegevens ${ctx.business.name}, ${ctx.business.place}`;
  const text = `Geachte heer/mevrouw,

Op ${date} vroegen wij u een gegeven over ${ctx.business.name} op ${site} aan te passen. Het staat er nog steeds.${finding.sourceUrl ? `

Pagina: ${finding.sourceUrl}` : ""}

Wat er staat (${w.what}): ${w.wrong}
Wat het moet zijn: ${w.correct}

Bron: ${ctx.factsPageUrl}

Kunt u dit alsnog corrigeren, of ons laten weten als dat niet kan?

Met vriendelijke groet,
${signature(ctx)}
`;
  return { subject, text };
}

/** Correction request built from a channel diff (directory sync, no single finding). `reminderOf`: the one reminder, 30 days after the first mail (publisher CORRECTION_REMINDER_DAYS). */
export function directoryCorrectionEmail(directoryName: string, listingUrl: string | null, diff: ChannelDiffEntry[], ctx: CorrectionContext, opts: { reminderOf?: string | null } = {}): Mail {
  const rows = diff
    .map((d) => `- ${fieldNl(d.field)}: ${d.current ? `staat nu "${d.current}", ` : ""}moet zijn "${d.expected}"`)
    .join("\n");
  const reminder = "reminderOf" in opts;
  const subject = `${reminder ? "Herinnering: c" : "C"}orrectie vermelding ${ctx.business.name}, ${ctx.business.place}`;
  const first = opts.reminderOf ? new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Amsterdam" }).format(new Date(opts.reminderOf)) : null;
  const intro = reminder
    ? `${first ? `Op ${first}` : "Eerder"} vroegen we u de vermelding van ${ctx.business.name} in ${ctx.business.place} op ${directoryName} aan te passen. De gegevens hieronder kloppen nog steeds niet.`
    : `De vermelding van ${ctx.business.name} in ${ctx.business.place} op ${directoryName} bevat gegevens die niet meer kloppen.`;
  const text = `Geachte heer/mevrouw,

${intro}${listingUrl ? `

Vermelding: ${listingUrl}` : ""}

${rows || "- Zie de feitenpagina voor de actuele gegevens."}

Wilt u de vermelding aanpassen? AI-assistenten nemen deze gegevens over, waardoor klanten een verkeerd antwoord krijgen.

Actuele gegevens, bevestigd door de eigenaar: ${ctx.factsPageUrl}

Met vriendelijke groet,
${signature(ctx)}
`;
  return { subject, text };
}

function fieldNl(field: string): string {
  const days = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"];
  if (field.startsWith("hours.")) return `Openingstijden ${days[Number(field.slice(6))] ?? ""}`.trim();
  return { phone: "Telefoon", website: "Website", address: "Adres" }[field] ?? field;
}

/** To the owner: what to change on their own website. */
export function ownerWebsiteInstructionEmail(finding: Finding, business: Pick<Business, "name">, dashboardUrl: string, lang: Lang = "nl"): Mail {
  const M = copyFor(lang).mails;
  const O = M.ownWebsite;
  const w = findingWords(finding, lang);
  const page = finding.sourceUrl ?? O.yourWebsite;
  const text = `${M.hi}

${O.intro(w.what, business.name)}

${O.onPage(page, w.wrong)}
${O.shouldBe(w.correct)}

${O.change}

${O.forward}

${M.overview(dashboardUrl)}

${M.regards}
`;
  return { subject: O.subject(business.name), text };
}

/** Reminder to the owner after 14 / 28 days when the website text is still wrong. */
export function ownerWebsiteReminderEmail(finding: Finding, business: Pick<Business, "name">, dashboardUrl: string, daysAgo: number, lang: Lang = "nl"): Mail {
  const M = copyFor(lang).mails;
  const O = M.ownWebsite;
  const w = findingWords(finding, lang);
  const page = finding.sourceUrl ?? O.yourWebsite;
  const text = `${M.hi}

${O.reminderIntro(daysAgo, w.what, page)}

${O.onPage(page, w.wrong)}
${O.shouldBe(w.correct)}

${O.reminderWhy}

${M.overview(dashboardUrl)}

${M.regards}
`;
  return { subject: O.reminderSubject(w.wrong), text };
}
