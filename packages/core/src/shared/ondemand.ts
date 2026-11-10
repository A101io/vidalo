import type { BusinessRecord } from "../db/types.js";

/**
 * "Controleer nu" (review R-02): an extra full check asks every AI system
 * again, which costs real money per click. It is part of the monthly plan
 * only, for a business that pays and is not paused, and at most once per
 * ONDEMAND_COOLDOWN_DAYS. The web action and the worker both ask this.
 */
export const ONDEMAND_COOLDOWN_DAYS = 7;
export const ONDEMAND_EVENT = "scan.ondemand_requested";

export type OndemandRefusal = "not_monthly" | "paused" | "too_soon";

export function ondemandRefusal(
  business: Pick<BusinessRecord, "status" | "plan" | "pauseUntil">,
  lastRequestedAt: string | null,
  now: Date = new Date(),
): OndemandRefusal | null {
  if (business.plan !== "monitor" || (business.status !== "trial" && business.status !== "active")) return "not_monthly";
  if (business.pauseUntil && new Date(business.pauseUntil) > now) return "paused";
  if (lastRequestedAt && now.getTime() - new Date(lastRequestedAt).getTime() < ONDEMAND_COOLDOWN_DAYS * 86_400_000) return "too_soon";
  return null;
}
