/**
 * The yearly "Klopt dit nog?" mail: one year after the owner last confirmed
 * their facts, one button to the facts form, in the owner's language
 * (business.language, wording in copy.mails.reconfirm). Queued once per year
 * by the worker cron (apps/worker/src/cron.ts, enqueueReconfirmations). Its
 * own file so the template stays apart from templates.ts.
 */
import { getDb } from "../shared/db.js";
import { lastConfirmed, reconfirmation } from "../facts-history.js";
import { copyFor, type Lang } from "../copy/index.js";
import { log } from "../shared/log.js";
import { confirmFactsUrl } from "./links.js";
import { sendMail, type MailResult } from "./mail.js";
import { formatMailDate, textToHtml, type Mail } from "./templates.js";

export interface ReconfirmData {
  business: { name: string };
  /** When the owner last confirmed. */
  confirmedAt: string;
  /** Whole years since then (1 or more). */
  years: number;
  confirmFactsUrl: string;
  /** the owner's language; Dutch when absent */
  lang?: Lang;
}

export function reconfirmEmail(d: ReconfirmData): Mail {
  const lang = d.lang ?? "nl";
  const M = copyFor(lang).mails;
  const R = M.reconfirm;
  const subject = R.subject(d.business.name);
  const text = `${M.hi}

${R.intro(formatMailDate(d.confirmedAt, lang), d.business.name, R.years(d.years))}

${R.ask}

${R.button}:
${d.confirmFactsUrl}

${M.regards}
`;
  // The link paragraph becomes one button in the HTML; the plain text keeps the address.
  const html = textToHtml(text, lang).replace(
    /<p style="[^"]*">(?:<strong[^>]*>)?[^<]*:(?:<\/strong>)?<br><a href="([^"]+)"[^>]*>[^<]*<\/a><\/p>/,
    (_m, href: string) =>
      `<p style="margin:8px 0 24px"><a href="${href}" style="display:inline-block;background:#2563eb;color:#ffffff;font-weight:700;font-size:16px;line-height:1;text-decoration:none;padding:16px 24px;border-radius:10px">${R.button}</a></p>`,
  );
  return { subject, text, html };
}

/** Sends the mail for the business's last confirmed facts; null when there is no owner address or nothing is due. */
export async function sendFactsReconfirm(businessId: string, now: Date = new Date()): Promise<MailResult | null> {
  const db = getDb();
  const business = await db.getBusiness(businessId);
  if (!business) throw new Error(`business ${businessId} not found`);
  const confirmed = lastConfirmed(await db.listFacts(businessId));
  const r = reconfirmation(confirmed, now);
  if (!r?.due || !business.ownerEmail) {
    log.warn("reporter.reconfirm.skipped", { businessId, due: r?.due ?? false, ownerEmail: Boolean(business.ownerEmail) });
    return null;
  }
  const lang: Lang = business.language === "en" ? "en" : "nl";
  const m = reconfirmEmail({ business, confirmedAt: r.confirmedAt, years: r.cycle, confirmFactsUrl: confirmFactsUrl(business), lang });
  const res = await sendMail({ to: business.ownerEmail, subject: m.subject, text: m.text, html: m.html, tags: { type: "reconfirm", business: business.slug, lang } });
  await db.logEvent(business.id, "email.reconfirm", { to: business.ownerEmail, subject: m.subject, mode: res.mode, id: res.id, version: r.version, cycle: r.cycle });
  return res;
}
