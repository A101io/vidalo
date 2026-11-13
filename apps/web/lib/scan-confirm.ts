import { env } from "@/lib/env";
import { ready, type BusinessRecord } from "@/lib/db";
import { localizeHref } from "@/lib/lang-paths";
import { scanConfirmEmail, sendMail } from "@vidalo/core/reporter";
import {
  CONFIRM_MAILS_PER_ADDRESS,
  CONFIRM_MAILS_PER_CAP,
  CONFIRM_MAILS_PER_IP,
  FREE_CHECK_LOCK,
  SCAN_CONFIRM_EVENT,
  clientIp,
  confirmAddressEvent,
  confirmIpEvent,
  dayStart,
  newConfirmToken,
  pendingPayload,
} from "@vidalo/core/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Stores a pending free check and queues the mail with its link (core/shared/scan-confirm.ts).
 * Returns the route to show next: "check your inbox", or /scan/druk?mail=1 when this address
 * or connection already got enough confirmation mails today, or the site sent its share.
 */
export async function requestConfirmation(req: Request, business: BusinessRecord, requester: { email: string; marketing: boolean }, lang: "nl" | "en"): Promise<string> {
  const db = await ready();
  const addrEvent = confirmAddressEvent(requester.email);
  const ipEvent = confirmIpEvent(clientIp(req));
  const siteCap = Math.max(1, env.freeScansPerDay) * CONFIRM_MAILS_PER_CAP;
  // Count and record under one lock, so parallel posts cannot overrun a cap (SEC-01).
  const token = await db.withLock(FREE_CHECK_LOCK, async () => {
    // Like the free-check caps, only while the engines are real (mock runs send no mail and cost nothing).
    if (
      env.realEngines &&
      ((await db.countEventsSince(addrEvent, dayStart())) >= CONFIRM_MAILS_PER_ADDRESS ||
        (await db.countEventsSince(ipEvent, dayStart())) >= CONFIRM_MAILS_PER_IP ||
        (await db.countEventsSince(SCAN_CONFIRM_EVENT, new Date(Date.now() - DAY_MS))) >= siteCap)
    ) {
      await db.logEvent(null, "scan.refused", { reason: "confirm_mail_cap" });
      return null;
    }
    const { token, hash } = newConfirmToken(business.id);
    await db.logEvent(business.id, SCAN_CONFIRM_EVENT, pendingPayload(requester, lang, hash));
    await db.logEvent(null, addrEvent, {});
    await db.logEvent(null, ipEvent, {});
    return token;
  });
  if (!token) return "/scan/druk?mail=1";
  const confirmUrl = `${env.baseUrl}${localizeHref(`/scan/bevestigen?t=${encodeURIComponent(token)}`, lang)}`;
  const mail = scanConfirmEmail({ business, confirmUrl, lang });
  // Sent from here, not through the job queue: a job row would keep the link secret in the database (QA-02).
  // Mock engines (the preview Worker has no disk for the .eml file): a failed mock write must not stop the flow.
  const sent = await sendMail({ to: requester.email, subject: mail.subject, text: mail.text, html: mail.html, tags: { kind: "scan_confirm", lang } }).catch((err: unknown) => {
    if (env.realEngines) throw err;
    return { mode: "mock" as const, id: null };
  });
  await db.logEvent(business.id, "email.scan_confirm", { mode: sent.mode, id: sent.id });
  // Mock engines only (nothing costs money, no worker sends the mail in tests): the page shows the link.
  return env.realEngines ? "/scan/mail" : `/scan/mail?link=${encodeURIComponent(token)}`;
}
