/**
 * What a plan promises (review CMP-01). Only Vidalo Monthly ("monitor") with a
 * running subscription gets a monthly check and "Controleer nu"; Vidalo Scan
 * ("setup") gets one full check and rechecks of the fixed errors.
 */
import type { Business } from "../types.js";

/** Which block the dashboard rail shows. */
export type PlanRail = "monthly" | "paused" | "scan" | "none";

export function planRail(b: Pick<Business, "plan" | "status">): PlanRail {
  if (b.plan === "monitor" && (b.status === "trial" || b.status === "active")) return "monthly";
  if (b.plan === "monitor" && b.status === "paused") return "paused";
  if (b.plan === "setup" && b.status !== "churned") return "scan";
  return "none";
}

/** The welcome steps for the plan bought: the last step only promises a monthly report with Vidalo Monthly. */
export function welcomeStepsFor<T>(steps: readonly T[], lastStepScan: T, monthly: boolean): T[] {
  return monthly ? [...steps] : [...steps.slice(0, -1), lastStepScan];
}
