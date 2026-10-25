/**
 * The launch mail: one mail, once, to everyone on the coming-soon list
 * (go-live P8). The privacy text promises exactly this: we mail you when
 * Vidalo opens, then delete the list. Pure, so scripts/launch-mail.mts stays
 * thin and every gate has a test.
 *
 * The gates:
 *  - a dry run is the default; it writes the plan and both mails to read.
 *  - sending needs RESEND_API_KEY and an APPROVED file whose content is the
 *    plan's digest. The digest covers every recipient and both mails, so a
 *    new sign-up or an edited text after approval refuses the send.
 *  - the list is never deleted by the tool; it prints the statement.
 */
import { createHash } from "node:crypto";
import { textToHtml, type Mail } from "./templates.js";

export type LaunchLang = "nl" | "en";
export interface LaunchRecipient {
  email: string;
  language: LaunchLang;
}

/** Run by hand after every mail went out, never by the tool. */
export const LAUNCH_DELETE_SQL = "delete from waitlist;";

export function launchEmail(lang: LaunchLang, siteUrl: string): Mail {
  const site = siteUrl.replace(/\/+$/, "");
  if (lang === "en") {
    const text = `Hi,

You joined the Vidalo coming-soon list. As of today, Vidalo is open.

Your customers ask ChatGPT. We make sure the answer is right. Vidalo checks what AI assistants say about your business, shows which answers are wrong and where they come from, and fixes them at the source.

Run the free check: ${site}/en

This is the only email you get from this list. After this email we delete the list, and your address with it.

Best,
Vidalo
`;
    return { subject: "Vidalo is open", text, html: textToHtml(text, "en") };
  }
  const text = `Hoi,

Je zette je op de lijst ‘Binnenkort’ van Vidalo. Vanaf vandaag is Vidalo open.

Je klanten vragen het aan ChatGPT. Wij zorgen dat het antwoord klopt. Vidalo controleert wat AI-assistenten over je bedrijf zeggen, laat zien welke antwoorden niet kloppen en waar ze vandaan komen, en herstelt de fouten bij de bron.

Doe de gratis controle: ${site}

Dit is de enige mail die je via deze lijst krijgt. Na deze mail verwijderen we de lijst, en je adres dus ook.

Groet,
Vidalo
`;
  return { subject: "Vidalo is open", text, html: textToHtml(text, "nl") };
}

export interface LaunchPlan {
  recipients: LaunchRecipient[];
  mails: Record<LaunchLang, Mail>;
  digest: string;
}

/** One mail per address (lower-cased, first row wins), in the order given; the digest is what Julian approves. */
export function planLaunchMail(rows: LaunchRecipient[], siteUrl: string): LaunchPlan {
  const seen = new Set<string>();
  const recipients: LaunchRecipient[] = [];
  for (const r of rows) {
    const email = r.email.trim().toLowerCase();
    if (!email.includes("@") || seen.has(email)) continue;
    seen.add(email);
    recipients.push({ email, language: r.language === "en" ? "en" : "nl" });
  }
  const mails = { nl: launchEmail("nl", siteUrl), en: launchEmail("en", siteUrl) };
  const h = createHash("sha256");
  for (const r of [...recipients].sort((a, b) => a.email.localeCompare(b.email))) h.update(`${r.email}\t${r.language}\n`);
  for (const lang of ["nl", "en"] as const) h.update(`${mails[lang].subject}\n${mails[lang].text}\n${mails[lang].html}\n`);
  return { recipients, mails, digest: h.digest("hex") };
}

export type SendGate = { ok: true } | { ok: false; reason: string };

/** Whether --send may go ahead: a key, a non-empty list, and an approval that matches this exact plan. */
export function launchSendGate(plan: LaunchPlan, opts: { resendKey?: string; approved?: string | null }): SendGate {
  if (!opts.resendKey) return { ok: false, reason: "RESEND_API_KEY is not set." };
  if (!plan.recipients.length) return { ok: false, reason: "The list is empty." };
  if (opts.approved == null) return { ok: false, reason: "No APPROVED file. Run the dry run, read the mails, then write the digest into APPROVED." };
  if (opts.approved.trim() !== plan.digest) return { ok: false, reason: "APPROVED does not match this plan: the list or a mail changed since it was approved. Run the dry run again." };
  return { ok: true };
}
