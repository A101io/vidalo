/**
 * The confirmations for cancel and pause (core/billing/lifecycle.ts), in the
 * owner's language. Each change to the subscription is confirmed in writing,
 * on a durable medium, right away: what changed, from when, what stops, what
 * stays, and how to change it back. These are service mails: they go out
 * whatever the owner's mail preferences say.
 */
import type { BusinessRecord } from "../db/types.js";
import { getDb } from "../shared/db.js";
import { textToHtml, type Mail } from "./templates.js";
import { baseUrl } from "./links.js";
import { sendMail, type MailResult } from "./mail.js";

export type SubscriptionMailKind = "cancel_confirmed" | "cancel_undone" | "pause_confirmed" | "pause_ending" | "pause_ended";
type Lang = "nl" | "en";

export function longDate(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "nl-NL", { timeZone: "Europe/Amsterdam", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso));
}

function billingUrl(lang: Lang): string {
  return `${baseUrl()}${lang === "en" ? "/en" : ""}/app/abonnement`;
}

export interface SubscriptionMailData {
  name: string;
  lang: Lang;
  /** cancel_confirmed: the end date; pause_*: the pause end date */
  at?: string;
}

export function subscriptionEmail(kind: SubscriptionMailKind, d: SubscriptionMailData): Mail {
  const url = billingUrl(d.lang);
  const date = d.at ? longDate(d.at, d.lang) : "";
  const t = d.lang === "en" ? EN : NL;
  const { subject, body } = t[kind](d.name, date, url);
  const text = `${t.hi}\n\n${body}\n\n${t.questions}\n\n${t.bye}\n`;
  return { subject, text, html: textToHtml(text, d.lang) };
}

type Builder = (name: string, date: string, url: string) => { subject: string; body: string };
type Words = Record<SubscriptionMailKind, Builder> & { hi: string; questions: string; bye: string };

const NL: Words = {
  hi: "Hoi,",
  questions: "Vragen? Antwoord op deze mail of mail support@vidalo.io.",
  bye: "Groet,\nVidalo",
  cancel_confirmed: (name, date, url) => ({
    subject: `Je abonnement voor ${name} is opgezegd`,
    body: `We hebben je opzegging ontvangen. Je abonnement op Goed houden voor ${name} stopt op ${date}. Tot die dag loopt alles door en betaal je niets extra. Daarna schrijven we niets meer af.

Wat er op ${date} gebeurt
Ons werk stopt: we controleren niet meer wat AI over je bedrijf zegt en we werken je gegevens niet meer bij.
Je feitenpagina verwijst vanaf dan door naar je eigen website.
Wat al is aangepast bij Google, gidsen en andere websites, blijft daar staan.
Je facturen blijven te downloaden in je account.
90 dagen later doen we nog één gratis controle. Daarna bewaren we alleen wat de wet voor facturen vraagt.

Toch doorgaan? Dat kan tot ${date}, met één klik op ${url}`,
  }),
  cancel_undone: (name, _date, url) => ({
    subject: `Je abonnement voor ${name} loopt door`,
    body: `Je hebt je opzegging ingetrokken. Je abonnement op Goed houden voor ${name} loopt gewoon door, met dezelfde prijs en dezelfde datum van betalen.

Je abonnement: ${url}`,
  }),
  pause_confirmed: (name, date, url) => ({
    subject: `Je abonnement voor ${name} staat stil tot ${date}`,
    body: `Je abonnement op Goed houden voor ${name} staat stil tot ${date}. In die tijd betaal je niets.

Wat stilstaat: de maandelijkse controle, het herstellen van fouten en het bijwerken van gidsen.
Wat blijft: je feitenpagina blijft online en je gegevens blijven bewaard.

Op ${date} gaat alles vanzelf weer verder en betaal je weer per maand. Een week vooraf sturen we je een herinnering. Eerder verder, of toch opzeggen? Dat kan op ${url}`,
  }),
  pause_ending: (name, date, url) => ({
    subject: `Op ${date} gaat je abonnement voor ${name} weer verder`,
    body: `Je abonnement op Goed houden voor ${name} staat nog stil tot ${date}. Vanaf die dag controleren we weer elke maand en betaal je weer per maand.

Wil je niet verder? Zeg dan voor ${date} op via ${url}`,
  }),
  pause_ended: (name, _date, url) => ({
    subject: `Je abonnement voor ${name} loopt weer`,
    body: `De pauze is voorbij. We controleren ${name} weer elke maand, herstellen fouten en werken je gegevens bij. Je betaalt weer per maand.

Je abonnement: ${url}`,
  }),
};

const EN: Words = {
  hi: "Hi,",
  questions: "Questions? Reply to this email or write to support@vidalo.io.",
  bye: "Best,\nVidalo",
  cancel_confirmed: (name, date, url) => ({
    subject: `Your subscription for ${name} is cancelled`,
    body: `We have received your cancellation. Your Keep it right subscription for ${name} ends on ${date}. Until then everything carries on and you pay nothing extra. After that we charge nothing more.

What happens on ${date}
Our work stops: we no longer check what AI says about your business and no longer update your details.
Your facts page then redirects to your own website.
What was already corrected at Google, directories and other websites stays there.
Your invoices stay available to download in your account.
90 days later we run one more free check. After that we keep only what the law requires for invoices.

Changed your mind? Until ${date} it takes one click at ${url}`,
  }),
  cancel_undone: (name, _date, url) => ({
    subject: `Your subscription for ${name} continues`,
    body: `You have withdrawn your cancellation. Your Keep it right subscription for ${name} simply continues, at the same price and on the same payment date.

Your subscription: ${url}`,
  }),
  pause_confirmed: (name, date, url) => ({
    subject: `Your subscription for ${name} is paused until ${date}`,
    body: `Your Keep it right subscription for ${name} is paused until ${date}. You pay nothing in that time.

What stops: the monthly check, fixing errors and updating directories.
What stays: your facts page stays online and your details are kept.

On ${date} everything starts again by itself and you pay monthly again. We send you a reminder a week before. Resume earlier, or cancel after all? You can at ${url}`,
  }),
  pause_ending: (name, date, url) => ({
    subject: `Your subscription for ${name} starts again on ${date}`,
    body: `Your Keep it right subscription for ${name} is paused until ${date}. From that day we check every month again and you pay monthly again.

Don't want to continue? Cancel before ${date} at ${url}`,
  }),
  pause_ended: (name, _date, url) => ({
    subject: `Your subscription for ${name} is running again`,
    body: `The pause is over. We check ${name} every month again, fix errors and update your details. You pay monthly again.

Your subscription: ${url}`,
  }),
};

/** Sends one confirmation to the owner and logs it as `mail.<kind>` with the date it is about (lifecycle.duePauseMail reads that). */
export async function sendSubscriptionMail(b: BusinessRecord, kind: SubscriptionMailKind, at?: string | null): Promise<MailResult | null> {
  if (!b.ownerEmail) return null;
  const m = subscriptionEmail(kind, { name: b.name, lang: b.language, at: at ?? undefined });
  const r = await sendMail({ to: b.ownerEmail, subject: m.subject, text: m.text, html: m.html, replyTo: "support@vidalo.io", tags: { kind } });
  await getDb().logEvent(b.id, `mail.${kind}`, { until: at ?? null, mode: r.mode, id: r.id });
  return r;
}
