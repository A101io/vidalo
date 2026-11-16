import { describe, expect, it } from "vitest";
import { withMockDb } from "../src/db";
import { prepareBusiness } from "../src/scanner/onboard";
import { createMockEngine } from "../src/scanner/engines";
import { runScan } from "../src/scanner";

/**
 * Security review (14 Nov 2026): a scan that failed after paid calls stored no cost, so the daily
 * ceilings (paid R-11, free FREE_AI_CAP_CENTS) never saw that spend.
 */
describe("a failed scan still records what it spent", () => {
  it("the calls made before the failure are on the failed run", async () => {
    const db = withMockDb();
    const { business } = await prepareBusiness({ name: "Bakkerij Kapot", place: "Haarlem", db });
    const mock = createMockEngine("chatgpt");
    const paid = { ...mock, ask: async (...a: Parameters<typeof mock.ask>) => ({ ...(await mock.ask(...a)), costCents: 7 }) };
    // The answers were bought; storing them fails.
    db.insertSamples = async () => {
      throw new Error("disk full");
    };
    await expect(runScan({ businessId: business.id, kind: "free", engines: ["chatgpt"], db, clients: [paid] })).rejects.toThrow("disk full");
    const [run] = await db.listScanRuns(business.id, 1);
    expect(run!.status).toBe("failed");
    expect(run!.costCents).toBeGreaterThan(0);
    expect(await db.freeScanCentsSince(new Date(Date.now() - 60_000))).toBe(run!.costCents);
  });
});
