import { describe, expect, it } from "vitest";
import { ondemandRefusal, ONDEMAND_COOLDOWN_DAYS } from "../src/shared/ondemand";

const NOW = new Date("2026-11-06T12:00:00Z");
const monthly = { status: "active" as const, plan: "monitor" as const, pauseUntil: null };
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

describe("Controleer nu", () => {
  it("is part of the monthly plan only", () => {
    expect(ondemandRefusal({ ...monthly, plan: "setup" }, null, NOW)).toBe("not_monthly");
    expect(ondemandRefusal({ ...monthly, status: "scanned" }, null, NOW)).toBe("not_monthly");
    expect(ondemandRefusal({ ...monthly, status: "churned" }, null, NOW)).toBe("not_monthly");
    expect(ondemandRefusal(monthly, null, NOW)).toBeNull();
    expect(ondemandRefusal({ ...monthly, status: "trial" }, null, NOW)).toBeNull();
  });

  it("waits while the owner paused", () => {
    expect(ondemandRefusal({ ...monthly, pauseUntil: daysAgo(-3) }, null, NOW)).toBe("paused");
    expect(ondemandRefusal({ ...monthly, pauseUntil: daysAgo(1) }, null, NOW)).toBeNull();
  });

  it(`allows one request per ${ONDEMAND_COOLDOWN_DAYS} days`, () => {
    expect(ondemandRefusal(monthly, daysAgo(1), NOW)).toBe("too_soon");
    expect(ondemandRefusal(monthly, daysAgo(ONDEMAND_COOLDOWN_DAYS - 0.01), NOW)).toBe("too_soon");
    expect(ondemandRefusal(monthly, daysAgo(ONDEMAND_COOLDOWN_DAYS), NOW)).toBeNull();
  });
});
