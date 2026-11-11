/**
 * Who may open a report (feature 002, AC-1). A free report is reachable by anyone with its link for
 * FREE_REPORT_DAYS, as the footer and the privacy text say; after that only a member of the business it
 * belongs to can still open it. Paid reports are unchanged: anyone holding the link.
 */
import type { ScanKind } from "../types";

/** copy.landing.footer.reportNote and the privacy text promise this number. */
export const FREE_REPORT_DAYS = 30;

/**
 * `viewerBusinessIds` comes only from listMyBusinesses(session) (empty when signed out), never from the request.
 */
export function reportVisible(r: { kind: ScanKind; checkedAt: string; businessId: string }, viewerBusinessIds: readonly string[], now: Date): boolean {
  if (r.kind !== "free") return true;
  const age = now.getTime() - new Date(r.checkedAt).getTime();
  if (!(age > FREE_REPORT_DAYS * 86_400_000)) return true; // also true for a date that does not parse: never hide on a guess
  return viewerBusinessIds.includes(r.businessId);
}
