import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared";
import { canDeleteMyData, exportMyData, ownAddressesOnly } from "../src/shared/my-data";
import { REPORT_EMAIL_EVENT, sendFollowUp } from "../src/reporter";

describe("deleting my data", () => {
  it("only once no subscription runs", () => {
    expect(canDeleteMyData("scanned")).toBe(true);
    expect(canDeleteMyData("churned")).toBe(true);
    for (const s of ["trial", "active", "paused"] as const) expect(canDeleteMyData(s)).toBe(false);
  });
});

// Review CMP-03 / SEC-03: anyone can ask for a business's free report, so the
// owner's download must not hand them the addresses of the people who asked.
describe("downloading my data", () => {
  it("keeps the owner's address and drops the addresses of two requesters", async () => {
    const db = new MemDb();
    setDb(db);
    process.env.VIDALO_OUT_DIR = await mkdtemp(path.join(tmpdir(), "vidalo-mydata-"));
    process.env.UNSUBSCRIBE_SECRET ??= "test-secret";
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status: "scanned", ownerEmail: null });
    const run = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 3 });
    await db.upsertFindings([{ businessId: b.id, scanRunId: run.id, factKey: "phone", subject: null, engine: "chatgpt", wrongValue: "023-1111111", correctValue: "023-2222222", frequency: 2, sampleCount: 3, sourceUrl: null, sourceType: "none", evidenceBefore: null }]);
    await db.logEvent(b.id, REPORT_EMAIL_EVENT, { scanRunId: run.id, email: "eerste@example.nl", lang: "nl" });
    await db.logEvent(b.id, REPORT_EMAIL_EVENT, { scanRunId: run.id, email: "Tweede@Example.nl", lang: "en" });
    await sendFollowUp(b.id, 7);
    await db.upsertBusiness({ id: b.id, name: b.name, place: b.place, ownerEmail: "Eigenaar@Example.nl" });
    await db.logEvent(b.id, "checkout.completed", { plan: "scan", email: "eigenaar@example.nl" });
    await sendFollowUp(b.id, 14);
    await db.logEvent(b.id, "email.directory_correction", { to: "info@openingstijden.nl", directory: "openingstijden.nl" });

    const types = (await db.listEvents(b.id, 100)).filter((e) => e.type.startsWith("email.followup_"));
    expect(types.map((e) => e.payload.to).sort()).toEqual(["owner", "requester"]);

    const json = JSON.stringify(await exportMyData(db, b.id));
    expect(json).not.toMatch(/eerste@example\.nl/i);
    expect(json).not.toMatch(/tweede@example\.nl/i);
    expect(json).toMatch(/eigenaar@example\.nl/i);
    expect(json).toContain("info@openingstijden.nl");
    const checkout = (await exportMyData(db, b.id))!.events.find((e) => e.type === "checkout.completed");
    expect(checkout?.payload.email).toBe("eigenaar@example.nl");
  });

  it("leaves words and other fields alone", () => {
    expect(ownAddressesOnly({ to: "owner", email: "x@y.nl", lang: "en" }, null)).toEqual({ to: "owner", lang: "en" });
  });

  it("drops an earlier claimant's address nested in owner.verified, keeps the owner's", () => {
    const p = { via: "phone_code", email: "Nieuw@x.nl", previous: { ownerEmail: "oud@x.nl", verifiedAt: "2026-11-01" }, cc: ["oud@x.nl", "nieuw@x.nl"] };
    expect(ownAddressesOnly(p, "nieuw@x.nl")).toEqual({ via: "phone_code", email: "Nieuw@x.nl", previous: { verifiedAt: "2026-11-01" }, cc: ["nieuw@x.nl"] });
  });
});
