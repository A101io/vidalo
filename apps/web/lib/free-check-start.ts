import { after } from "next/server";
import { cloudflareBindings } from "@/lib/cloudflare";
import { env } from "@/lib/env";
import { ready } from "@/lib/db";
import { createScanState, startFreeScan, FREE_SCAN_ENGINES } from "@/lib/core";
import { FREE_SCANS_PER_IP, REPORT_EMAIL_EVENT, clientIp, dayStart, freeCheckEvents, scanIpEvent } from "@vidalo/core/shared";
import type { BusinessRecord } from "@vidalo/core/db";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a new free check may start now, without counting anything: the
 * site-wide daily cap and this visitor's allowance. /api/scan asks this before
 * the Places lookup (nothing is spent on a visitor who cannot start one), and
 * startFreeCheck asks it again when the check really starts.
 */
export async function freeCheckRefusal(req: Request): Promise<"daily_cap" | "ip_cap" | null> {
  if (!env.realEngines) return null;
  const db = await ready();
  if ((await db.countEventsSince("scan.requested", new Date(Date.now() - DAY_MS))) >= env.freeScansPerDay) return "daily_cap";
  if ((await db.countEventsSince(scanIpEvent(clientIp(req)), dayStart())) >= FREE_SCANS_PER_IP) return "ip_cap";
  return null;
}

/**
 * Starts the free check for a requester whose address is proven (a confirmed
 * mail link, or a signed-in session) and returns the route to send them to:
 * the report when one from the last day exists, the waiting room, or /scan/druk.
 */
export async function startFreeCheck(req: Request, business: BusinessRecord, requester: { email: string; marketing: boolean }, lang: "nl" | "en", via: string): Promise<string> {
  const db = await ready();
  const dayAgo = new Date(Date.now() - DAY_MS);
  const alreadyAsked = (await db.listEvents(business.id, 500)).some((e) => e.type === REPORT_EMAIL_EVENT && e.payload.email === requester.email);
  for (const ev of freeCheckEvents(requester, lang)) await db.logEvent(business.id, ev.type, ev.payload);

  // Asked again within a day: show the report we already paid for, and mail it to a new asker.
  const recent = (await db.listScanRuns(business.id, 5)).find((r) => r.kind === "free" && r.status === "done" && r.finishedAt && new Date(r.finishedAt) >= dayAgo);
  if (recent) {
    await db.logEvent(business.id, "scan.reused", { scanRunId: recent.id, via });
    if (!business.ownerEmail && !alreadyAsked) await db.enqueueJob("email", { template: "baseline", scanRunId: recent.id, businessId: business.id, to: requester.email, lang });
    // The reused report is this address's too (the signed-in page lists it).
    await db.logEvent(business.id, REPORT_EMAIL_EVENT, { email: requester.email, lang, scanRunId: recent.id, via: "linked" });
    return `/r/${recent.id}`;
  }

  const refusal = await freeCheckRefusal(req);
  if (refusal) {
    await db.logEvent(null, "scan.refused", { reason: refusal, cap: refusal === "daily_cap" ? env.freeScansPerDay : FREE_SCANS_PER_IP });
    return "/scan/druk";
  }
  if (env.realEngines) await db.logEvent(null, scanIpEvent(clientIp(req)), {});
  await db.logEvent(business.id, "scan.requested", { via });

  const state = await createScanState(business.id);
  // On Cloudflare a scan outlives a request (several minutes with live
  // engines; waitUntil allows 30 s), so it goes on the queue and the
  // background worker runs it. Elsewhere (local, mock) it runs right after
  // the response. Either way the waiting room polls /api/scan/[token]/status.
  const queue = cloudflareBindings()?.SCAN_QUEUE;
  if (queue) {
    await queue.send({ token: state.token, kind: "free", engines: FREE_SCAN_ENGINES });
  } else {
    after(async () => {
      await startFreeScan(state, { kind: "free", engines: FREE_SCAN_ENGINES });
    });
  }
  return `/scan/${state.token}`;
}
