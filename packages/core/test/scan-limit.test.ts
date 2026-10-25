import { describe, expect, it } from "vitest";
import { MemDb } from "../src/db/mem";
import { FREE_SCANS_PER_IP, clientIp, dayStart, scanIpEvent } from "../src/shared/scan-limit";

const req = (h: Record<string, string>) => ({ headers: new Headers(h) });

describe("free check limit per address", () => {
  it("reads Cloudflare's address first, then the first forwarded one", () => {
    expect(clientIp(req({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }))).toBe("203.0.113.7");
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" }))).toBe("198.51.100.1");
    expect(clientIp(req({}))).toBe("local");
  });

  it("never stores the address: the event type is a hash, the same all day, different the next", () => {
    const morning = new Date("2026-10-24T06:00:00Z");
    const evening = new Date("2026-10-24T23:59:00Z");
    const next = new Date("2026-10-25T00:01:00Z");
    const a = scanIpEvent("203.0.113.7", morning);
    expect(a).toMatch(/^scan\.ip\.[0-9a-f]{24}$/);
    expect(a).not.toContain("203");
    expect(scanIpEvent("203.0.113.7", evening)).toBe(a);
    expect(scanIpEvent("203.0.113.7", next)).not.toBe(a);
    expect(scanIpEvent("203.0.113.8", morning)).not.toBe(a);
  });

  it("counts per address per day through the event table", async () => {
    const db = new MemDb();
    const now = new Date();
    const type = scanIpEvent("203.0.113.7", now);
    for (let i = 0; i < FREE_SCANS_PER_IP; i++) await db.logEvent(null, type, {});
    expect(await db.countEventsSince(type, dayStart(now))).toBe(FREE_SCANS_PER_IP);
    expect(await db.countEventsSince(scanIpEvent("203.0.113.8", now), dayStart(now))).toBe(0);
  });
});
