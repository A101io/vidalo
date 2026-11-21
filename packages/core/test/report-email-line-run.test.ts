import { describe, expect, it, vi } from "vitest";
import { withMockDb } from "../src/db";

// SEC-V05 (feature 006): /api/report-email refuses a product-line run's id, before it queues or logs anything.
const state: { db: ReturnType<typeof withMockDb> } = { db: withMockDb() };
vi.mock("next/server", () => ({ NextResponse: { redirect: (url: string, status: number) => ({ url, status }) } }));
vi.mock("@/lib/db", () => ({ ready: async () => state.db }));
vi.mock("@/lib/env", () => ({ env: { baseUrl: "http://localhost:3000" } }));
vi.mock("@/lib/format", () => ({ isEmail: () => true }));
vi.mock("@/lib/request-lang", () => ({ langFromReferer: () => "nl" }));

describe("report-email and a line run (SEC-V05)", () => {
  it("queues nothing for a line run, and still does for a business run", async () => {
    state.db = withMockDb();
    const db = state.db;
    const b = await db.upsertBusiness({ slug: "b", name: "B", place: "Haarlem", status: "scanned" });
    const base = { businessId: b.id, kind: "monthly" as const, engines: ["chatgpt" as const], samplesPerPrompt: 1, status: "done" as const };
    const plain = await db.createScanRun({ ...base, kind: "free" });
    const line = await db.saveProductLine({ businessId: b.id, productLineId: null, maxActive: 2, data: { name: "L", category: "c", useCases: [], markets: ["NL"], specs: [], certificates: [], outlets: [], replaces: [], replacedBy: null } });
    if (!line.ok) throw new Error("setup");
    const lr = await db.createScanRun({ ...base, productLineId: line.line.id, productLineVersion: 1, market: "NL" });
    const { POST } = await import("../../../apps/web/app/api/report-email/route");
    const post = (scan: string) => POST(new Request("http://localhost:3000/api/report-email", { method: "POST", body: new URLSearchParams({ email: "x@example.nl", scan, business: b.id }) }));
    await post(lr.id);
    expect((await db.listEvents(b.id, 50)).filter((e) => e.type === "report_email.requested")).toHaveLength(0);
    await post(plain.id);
    expect((await db.listEvents(b.id, 50)).filter((e) => e.type === "report_email.requested")).toHaveLength(1);
  });
});
