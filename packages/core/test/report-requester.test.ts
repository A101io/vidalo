import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { setDb } from "../src/shared";
import { REPORT_EMAIL_EVENT, reportRequester, sendBaselineSummary, sendFollowUp } from "../src/reporter";

// Review R-03: the report page's mail form is open to anyone, so the address
// it takes gets the free-check mails but never becomes the business's owner.
describe("an address from the report page's mail form", () => {
  let db: MemDb;
  beforeEach(async () => {
    db = new MemDb();
    setDb(db);
    process.env.VIDALO_OUT_DIR = await mkdtemp(path.join(tmpdir(), "vidalo-asker-"));
    process.env.UNSUBSCRIBE_SECRET ??= "test-secret";
  });

  async function scanned(ownerEmail: string | null) {
    const b = await db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status: "scanned", ownerEmail });
    const run = await db.createScanRun({ businessId: b.id, kind: "free", engines: ["chatgpt"], samplesPerPrompt: 3 });
    await db.upsertFindings([{ businessId: b.id, scanRunId: run.id, factKey: "phone", subject: null, engine: "chatgpt", wrongValue: "023-1111111", correctValue: "023-2222222", frequency: 2, sampleCount: 3, sourceUrl: null, sourceType: "none", evidenceBefore: null }]);
    await db.logEvent(b.id, REPORT_EMAIL_EVENT, { scanRunId: run.id, email: "vraagt@example.nl", lang: "en" });
    return b;
  }

  it("gets the follow-up in the report page's language, and the business keeps no owner", async () => {
    const b = await scanned(null);
    expect(await reportRequester(b.id)).toEqual({ email: "vraagt@example.nl", lang: "en" });
    const res = await sendFollowUp(b.id, 7);
    const eml = await readFile(res!.file!, "utf8");
    expect(eml).toMatch(/^To: vraagt@example\.nl/m);
    expect((await db.getBusiness(b.id))?.ownerEmail).toBeNull();
    expect((await db.getBusiness(b.id))?.language ?? null).not.toBe("en");
  });

  it("does not take over the mails of a business that has an owner", async () => {
    const b = await scanned("eigenaar@example.nl");
    const res = await sendFollowUp(b.id, 7);
    const eml = await readFile(res!.file!, "utf8");
    expect(eml).toMatch(/^To: eigenaar@example\.nl/m);
  });

  it("gets the baseline mail at the address the job was asked for, in that language", async () => {
    const b = await scanned(null);
    const run = (await db.listScanRuns(b.id, 1))[0]!;
    const res = await sendBaselineSummary(run.id, { email: "tweede@example.nl", lang: "nl" });
    const eml = await readFile(res!.file!, "utf8");
    expect(eml).toMatch(/^To: tweede@example\.nl/m);
    expect((await db.getBusiness(b.id))?.ownerEmail).toBeNull();
    const ev = (await db.listEvents(b.id, 50)).find((e) => e.type === "email.baseline");
    expect(ev?.payload.to).toBe("requester");
  });
});
