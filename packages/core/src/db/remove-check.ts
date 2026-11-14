/**
 * Removing a check (Julian, 13 Nov 2026): a signed-in person deletes a check they asked for or own, from "Je controles"
 * or the owner area's report archive. Everything is decided here, from who is asking, never from what the page sent:
 *
 *  - a MEMBER of the business (isMember: the owner's login) may remove any finished check of it except the newest
 *    finished one, which the overview stands on. The business keeps its findings: they move to the newest remaining run.
 *  - a REQUESTER (the address that asked for the report, proven by the sign-in link) may remove a free check of an
 *    unowned business. The report, samples, claims, findings and the run's events go, unless someone else asked for the
 *    same run or the business has an owner: then only this address's request goes, and the report stays for them.
 *  - anyone else gets "not_yours", the same answer as for a run that does not exist.
 *
 * `dryRun` answers what would happen and changes nothing (the confirm page).
 *
 * A free-check business that is left with no run, no request and no owner is removed with it (public business data only).
 */
import { REPORT_EMAIL_EVENT, requestMatchesRun } from "../shared/free-check.js";
import type { Db, EventRow } from "./types.js";
import type { ScanRun } from "../types.js";
import { isMember } from "./owner-area.js";

export type RemoveCheckResult = { ok: true; outcome: "removed" | "unlinked"; businessRemoved: boolean } | { ok: false; reason: "not_yours" | "not_finished" | "latest" };

export async function removeCheck(db: Db, who: { userId: string | null; email: string }, runId: string, opts: { dryRun?: boolean } = {}): Promise<RemoveCheckResult> {
  const refused = (reason: "not_yours" | "not_finished" | "latest"): RemoveCheckResult => ({ ok: false, reason });
  const run = await db.getScanRun(runId);
  if (!run) return refused("not_yours");
  const business = await db.getBusiness(run.businessId);
  if (!business) return refused("not_yours");
  const email = who.email.trim().toLowerCase();
  const member = Boolean(who.userId) && (await isMember(db, who.userId!, business.id));
  const asked = (await db.listEventsByEmail(REPORT_EMAIL_EVENT, email, 500)).filter((e) => e.businessId === business.id && requestMatchesRun(e, run));
  if (!member && asked.length === 0) return refused("not_yours");
  if (run.status !== "done" && run.status !== "failed") return refused("not_finished");

  const runs = await db.listScanRuns(business.id, 200);
  const others = runs.filter((r) => r.id !== run.id && r.status === "done");
  const newest = (list: ScanRun[]) => [...list].sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt))[0] ?? null;
  const takeover = newest(others);

  const allRequests = (await db.listEvents(business.id, 500)).filter((e) => e.type === REPORT_EMAIL_EVENT && requestMatchesRun(e, run));
  const owned = Boolean(business.ownerUserId || business.ownerEmail);

  if (member) {
    // The newest finished check is what the overview and the progress view stand on.
    if (run.status === "done" && (!takeover || (takeover.finishedAt ?? takeover.startedAt) < (run.finishedAt ?? run.startedAt))) return refused("latest");
    if (!opts.dryRun) await removeRun(db, run, takeover, allRequests);
    return { ok: true, outcome: "removed", businessRemoved: false };
  }

  const others2 = allRequests.some((e) => String(e.payload.email ?? "").toLowerCase() !== email);
  if (owned || others2) {
    if (opts.dryRun) return { ok: true, outcome: "unlinked", businessRemoved: false };
    await db.deleteEvents(asked.map((e) => e.id));
    return { ok: true, outcome: "unlinked", businessRemoved: false };
  }
  if (opts.dryRun) return { ok: true, outcome: "removed", businessRemoved: false };
  await removeRun(db, run, takeover, allRequests);
  // Nothing of this business is left that anyone asked for: its public data goes too.
  const left = (await db.listScanRuns(business.id, 1)).length;
  const requests = (await db.listEvents(business.id, 500)).filter((e) => e.type === REPORT_EMAIL_EVENT).length;
  let businessRemoved = false;
  if (left === 0 && requests === 0 && !business.ownerUserId && !business.ownerEmail && !business.stripeCustomerId) {
    await db.deleteBusiness(business.id);
    businessRemoved = true;
  }
  return { ok: true, outcome: "removed", businessRemoved };
}

async function removeRun(db: Db, run: ScanRun, takeover: ScanRun | null, requests: EventRow[]): Promise<void> {
  // Requests without a run id (made before 11 Nov 2026) are matched by time: they go with the run they asked for.
  await db.deleteEvents(requests.map((e) => e.id));
  await db.deleteScanRun(run.id, { moveFindingsTo: takeover?.id ?? null });
}
