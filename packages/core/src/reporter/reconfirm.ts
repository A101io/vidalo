/**
 * The yearly "Klopt dit nog?" mail: one year after the owner last confirmed
 * their facts, one button to the facts form. Queued once per year by the
 * worker cron (apps/worker/src/cron.ts, enqueueReconfirmations). Its own file
 * so the template stays apart from templates.ts.
 */
import { getDb } from "../shared/db.js";
import { lastConfirmed, reconfirmation } from "../facts-history.js";
import { formatDateNl } from "../publisher/render.js";
import { log } from "../shared/log.js";
import { confirmFactsUrl } from "./links.js";
import { sendMail, type MailResult } from "./mail.js";
import { textToHtml, type Mail } from "./templates.js";

export interface ReconfirmData {
  business: { name: string };
  /** When the owner last confirmed. */
  confirmedAt: string;
  /** Whole years since then (1 or more). */
  years: number;
  confirmFactsUrl: string;
}

const BUTTON = "Bekijk je gegevens";

export function reconfirmEmail(d: ReconfirmData): Mail {
  const subject = `Klopt dit nog? De gegevens van ${d.business.name}`;
  const text = `Hoi,

Op ${formatDateNl(d.confirmedAt)} heb je de gegevens van ${d.business.name} bevestigd. Dat is ${d.years === 1 ? "een jaar" : `${d.years} jaar`} geleden. Adres, telefoon, openingstijden en wat je wel en niet doet veranderen soms zonder dat je eraan denkt.

Wil je ze even nalopen? Klopt alles nog, dan is het één klik op "Alles klopt nog" in je overzicht. Is er iets veranderd, pas het dan aan. Wij werken daarna je feitenpagina en de bronnen bij.

${BUTTON}:
${d.confirmFactsUrl}

Groet,
Vidalo
`;
  // The link paragraph becomes one button in the HTML; the plain text keeps the address.
  const html = textToHtml(text).replace(
    /<p style="[^"]*">(?:<strong[^>]*>)?[^<]*:(?:<\/strong>)?<br><a href="([^"]+)"[^>]*>[^<]*<\/a><\/p>/,
    (_m, href: string) =>
      `<p style="margin:8px 0 24px"><a href="${href}" style="display:inline-block;background:#2563eb;color:#ffffff;font-weight:700;font-size:16px;line-height:1;text-decoration:none;padding:16px 24px;border-radius:10px">${BUTTON}</a></p>`,
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
  const m = reconfirmEmail({ business, confirmedAt: r.confirmedAt, years: r.cycle, confirmFactsUrl: confirmFactsUrl(business) });
  const res = await sendMail({ to: business.ownerEmail, subject: m.subject, text: m.text, html: m.html, tags: { type: "reconfirm", business: business.slug } });
  await db.logEvent(business.id, "email.reconfirm", { to: business.ownerEmail, subject: m.subject, mode: res.mode, id: res.id, version: r.version, cycle: r.cycle });
  return res;
}
