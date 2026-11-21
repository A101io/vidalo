import { expectedLineRuns } from "../lines.js";
import { getDb, runScan } from "../compat.js";
import { log } from "../log.js";
import type { Handler } from "./types.js";

/**
 * Run a scan. Afterwards:
 *   baseline → fixes + baseline summary mail
 *   monthly  → fixes + monthly report
 *   free / ondemand / recheck → nothing (recheck logic lives in the fixer)
 */
export const scan: Handler<"scan"> = async (p) => {
  const db = getDb();
  const line = p.productLineId && p.market ? { productLineId: p.productLineId, market: p.market } : {};
  const report = await runScan({ businessId: p.businessId, kind: p.kind, engines: p.engines, samplesPerPrompt: p.samplesPerPrompt, promptIds: p.promptIds, db, ...line });
  log.info("scan.done", { businessId: p.businessId, kind: p.kind, scanRunId: report.scanRunId, total: report.totalAnswers, wrong: report.wrongAnswers, ...line });

  // A line run opens fixes and nothing else: the one monthly mail belongs to the business's own run.
  const then = p.then ?? (p.productLineId ? ["fixes"] : p.kind === "baseline" ? ["fixes", "baseline_summary"] : p.kind === "monthly" ? ["fixes", "report"] : []);
  for (const step of then) {
    if (step === "fixes") await db.enqueueJob("fixes", { scanRunId: report.scanRunId, businessId: p.businessId });
    if (step === "baseline_summary") await db.enqueueJob("email", { template: "baseline", scanRunId: report.scanRunId, businessId: p.businessId });
    if (step === "report") {
      // Report after the fix round has had a moment to open fixes (so "wat we doen" is filled).
      // It waits for the month's line runs: the ones the cron enqueued next to this run (lines the owner may have).
      const lines = p.kind === "monthly" ? await expectedLineRuns(p.businessId) : [];
      await db.enqueueJob("report", { businessId: p.businessId, scanRunId: report.scanRunId, ...(lines.length ? { lines } : {}) }, new Date(Date.now() + 5 * 60 * 1000));
    }
  }
  await db.logEvent(p.businessId, "scan.done", { kind: p.kind, scanRunId: report.scanRunId, total: report.totalAnswers, wrong: report.wrongAnswers, then, ...line });
  return { scanRunId: report.scanRunId, wrong: report.wrongAnswers, total: report.totalAnswers };
};
