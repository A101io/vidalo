/**
 * The mails about the domain add-on (core/billing/domain.ts, core/registrar),
 * in the owner's language, words in copy.mails.domain. Service mails: they
 * go whatever the owner's mail preferences say, like the subscription mails.
 */
import type { BusinessRecord } from "../db/types.js";
import { copyFor } from "../copy/index.js";
import { DOMAIN_PRICE_EUR_PER_YEAR } from "../billing/domain.js";
import { factsHostOn } from "../registrar/names.js";
import { getDb } from "../shared/db.js";
import { textToHtml, type Mail } from "./templates.js";
import { baseUrl, mailPath } from "./links.js";
import { sendMail, type MailResult } from "./mail.js";
import { longDate } from "./subscription-mails.js";

export type DomainMailKind = "domain_registered" | "domain_failed" | "domain_renewal" | "domain_payment_failed" | "domain_cancelled" | "domain_ended" | "domain_authcode";
export const DOMAIN_MAIL_KINDS: DomainMailKind[] = ["domain_registered", "domain_failed", "domain_renewal", "domain_payment_failed", "domain_cancelled", "domain_ended", "domain_authcode"];

type Lang = "nl" | "en";

export interface DomainMailData {
  domain: string;
  lang: Lang;
  /** expiry (registered, renewal, payment_failed, ended) or end date (cancelled) */
  at?: string | null;
  /** domain_authcode only */
  code?: string;
}

export function domainEmail(kind: DomainMailKind, d: DomainMailData): Mail {
  const c = copyFor(d.lang).mails;
  const M = c.domain;
  const url = `${baseUrl()}${mailPath("/app/domein", d.lang)}`;
  const date = d.at ? longDate(d.at, d.lang) : "";
  const price = String(DOMAIN_PRICE_EUR_PER_YEAR);
  const { subject, body } =
    kind === "domain_registered"
      ? M.registered({ domain: d.domain, host: factsHostOn(d.domain), date, url })
      : kind === "domain_failed"
        ? M.failed({ domain: d.domain })
        : kind === "domain_renewal"
          ? M.renewal({ domain: d.domain, date, price, url })
          : kind === "domain_payment_failed"
            ? M.paymentFailed({ domain: d.domain, date, url })
            : kind === "domain_cancelled"
              ? M.cancelled({ domain: d.domain, date, url })
              : kind === "domain_ended"
                ? M.ended({ domain: d.domain, date, url })
                : M.authCode({ domain: d.domain, code: d.code ?? "" });
  const questions = d.lang === "en" ? "Questions? Reply to this email or write to support@vidalo.io." : "Vragen? Antwoord op deze mail of mail support@vidalo.io.";
  const text = `${c.hi}\n\n${body}\n\n${questions}\n\n${c.regards}\n`;
  return { subject, text, html: textToHtml(text, d.lang) };
}

/** Sends one domain mail to the owner and logs it as `mail.<kind>` with the date it is about (dueDomainReminder reads that). */
export async function sendDomainMail(b: BusinessRecord, kind: DomainMailKind, extra: { code?: string } = {}): Promise<MailResult | null> {
  const reg = b.domainRegistration;
  if (!b.ownerEmail || !reg) return null;
  const at = kind === "domain_cancelled" ? reg.cancelAt : reg.expiresAt;
  const m = domainEmail(kind, { domain: reg.name, lang: b.language, at, code: extra.code });
  const r = await sendMail({ to: b.ownerEmail, subject: m.subject, text: m.text, html: m.html, replyTo: "support@vidalo.io", tags: { kind, lang: b.language } });
  // The transfer code itself never goes into the event log.
  await getDb().logEvent(b.id, `mail.${kind}`, { domain: reg.name, until: at ?? null, mode: r.mode, id: r.id });
  return r;
}
