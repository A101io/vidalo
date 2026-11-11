/**
 * Mails about deleting an account (feature 002, A-05/A-06), in the owner's language. Service mails:
 * they go out whatever the owner's mail preferences say, carry the company footer (textToHtml) and
 * hold no offer. Wording in copy.mails.
 */
import type { BusinessRecord } from "../db/types.js";
import { copyFor } from "../copy/index.js";
import { getDb } from "../shared/db.js";
import { textToHtml, type Mail } from "./templates.js";
import { baseUrl } from "./links.js";
import { sendMail } from "./mail.js";
import { longDate } from "./subscription-mails.js";

type Lang = "nl" | "en";

function wrap(lang: Lang, subject: string, body: string): Mail {
  const m = copyFor(lang).mails;
  const text = `${m.hi}\n\n${body}\n\n${lang === "en" ? "Questions? Reply to this mail or write to support@vidalo.io." : "Vragen? Antwoord op deze mail of mail support@vidalo.io."}\n\n${m.regards}\n`;
  return { subject, text, html: textToHtml(text, lang) };
}

const accountUrl = (lang: Lang) => `${baseUrl()}${lang === "en" ? "/en" : ""}/app/account#gegevens`;

export function deletedEmail(lang: Lang, businessName: string): Mail {
  const t = copyFor(lang).mails.accountDeleted(businessName);
  return wrap(lang, t.subject, t.body);
}

export function deletionScheduledEmail(lang: Lang, businessName: string, at: string): Mail {
  const t = copyFor(lang).mails.deletionScheduled(businessName, longDate(at, lang), accountUrl(lang));
  return wrap(lang, t.subject, t.body);
}

/** After a purge: the business is gone, so nothing is logged on it; the address is never logged. */
export async function sendDeletedMail(to: { email: string; language: Lang; businessName: string }): Promise<void> {
  const m = deletedEmail(to.language, to.businessName);
  await sendMail({ to: to.email, subject: m.subject, text: m.text, html: m.html, replyTo: "support@vidalo.io", tags: { kind: "account_deleted" } });
}

/** At once when "Verwijder alles" cancels a running Vidalo Monthly (F-013); logged as mail.deletion_scheduled. */
export async function sendDeletionScheduledMail(b: BusinessRecord, at: string, to: string | null = b.ownerEmail): Promise<boolean> {
  if (!to) return false;
  const m = deletionScheduledEmail(b.language, b.name, at);
  const r = await sendMail({ to, subject: m.subject, text: m.text, html: m.html, replyTo: "support@vidalo.io", tags: { kind: "deletion_scheduled" } });
  await getDb().logEvent(b.id, "mail.deletion_scheduled", { until: at, mode: r.mode, id: r.id });
  return true;
}

export function deletionReminderEmail(lang: Lang, businessName: string, at: string, scan: boolean): Mail {
  const t = copyFor(lang).mails.deletionReminder(businessName, longDate(at, lang), accountUrl(lang), scan);
  return wrap(lang, t.subject, t.body);
}

/** 14 days before a retention deletion (A-06). A service mail: sent whatever the mail preferences say. */
export async function sendDeletionReminder(b: BusinessRecord): Promise<boolean> {
  if (!b.ownerEmail || !b.deleteAt) return false;
  const m = deletionReminderEmail(b.language, b.name, b.deleteAt, b.plan === "setup" && b.status === "trial");
  const r = await sendMail({ to: b.ownerEmail, subject: m.subject, text: m.text, html: m.html, replyTo: "support@vidalo.io", tags: { kind: "deletion_reminder" } });
  await getDb().logEvent(b.id, "mail.deletion_reminder", { until: b.deleteAt, mode: r.mode, id: r.id });
  return true;
}
