import { describe, expect, it } from "vitest";
import { FREE_REPORT_DAYS, reportVisible } from "../src/shared";

const NOW = new Date("2026-11-11T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const MINE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

describe("reportVisible (AC-1)", () => {
  it("a free report older than 30 days opens for a member of its business only", () => {
    const r = { kind: "free" as const, checkedAt: daysAgo(31), businessId: MINE };
    expect(reportVisible(r, [MINE], NOW)).toBe(true);
    expect(reportVisible(r, [OTHER, MINE], NOW)).toBe(true); // a login with two businesses
    expect(reportVisible(r, [OTHER], NOW)).toBe(false); // another login's businesses
    expect(reportVisible(r, [], NOW)).toBe(false); // signed out
  });

  it("a free report of 29 days opens for everyone with the link", () => {
    const r = { kind: "free" as const, checkedAt: daysAgo(29), businessId: MINE };
    for (const viewer of [[MINE], [OTHER], []]) expect(reportVisible(r, viewer, NOW)).toBe(true);
  });

  it("the 30-day boundary is the promised number", () => {
    expect(FREE_REPORT_DAYS).toBe(30);
    expect(reportVisible({ kind: "free", checkedAt: daysAgo(30), businessId: MINE }, [], NOW)).toBe(true);
    expect(reportVisible({ kind: "free", checkedAt: new Date(NOW.getTime() - 30 * 86_400_000 - 1).toISOString(), businessId: MINE }, [], NOW)).toBe(false);
  });

  it("a paid report stays open for everyone who holds the link, however old", () => {
    for (const kind of ["baseline", "monthly", "ondemand", "recheck"] as const) {
      expect(reportVisible({ kind, checkedAt: daysAgo(400), businessId: MINE }, [], NOW), kind).toBe(true);
      expect(reportVisible({ kind, checkedAt: daysAgo(400), businessId: MINE }, [OTHER], NOW), kind).toBe(true);
    }
  });

  it("a date that does not parse is never a reason to hide", () => {
    expect(reportVisible({ kind: "free", checkedAt: "not a date", businessId: MINE }, [], NOW)).toBe(true);
  });
});
