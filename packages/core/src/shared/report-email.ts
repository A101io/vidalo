import type { EventRow } from "../db/types.js";
import type { ScanRun } from "../types.js";

/** Report-mail requests per IP in REPORT_EMAIL_WINDOW_MS; the form is public, so this is the abuse cap. */
export const REPORT_EMAIL_PER_IP = 5;
export const REPORT_EMAIL_WINDOW_MS = 10 * 60 * 1000;
export const REPORT_EMAIL_EVENT = "report_email.requested";

/**
 * Whether a POST to /api/report-email may enqueue a mail. The scan run must
 * belong to the business the form names, and each scan run mails once: a
 * repeated post answers "ok" without sending, so the form cannot be used to
 * fill an owner's inbox.
 */
export function reportEmailCheck(
  run: Pick<ScanRun, "businessId"> | null,
  businessId: string,
  scanRunId: string,
  events: Pick<EventRow, "type" | "payload">[],
): "send" | "mismatch" | "duplicate" {
  if (!run || run.businessId !== businessId) return "mismatch";
  if (events.some((e) => e.type === REPORT_EMAIL_EVENT && e.payload.scanRunId === scanRunId)) return "duplicate";
  return "send";
}
