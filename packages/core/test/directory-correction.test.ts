import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db/mem";
import { setDb } from "../src/shared/db";
import { CORRECTION_REMINDER_DAYS, correctionDecision, correctionKey, syncAllChannels } from "../src/publisher";
import { directoryCorrectionEmail } from "../src/fixer/email-templates";
import { facts as baseFacts } from "./worker-fixtures";

/**
 * A directory gets one correction per set of corrected details, one reminder
 * after 30 days, then nothing until the details change (23 Oct 2026). The
 * mail lab found the identical mail sent 14-46 times to one directory.
 */
const DAY = 24 * 60 * 60 * 1000;

describe("correctionDecision", () => {
  const key = correctionKey("info@opendi.nl", [{ field: "phone", expected: "+31235551234" }]);
  const t0 = new Date("2026-10-01T10:00:00Z");

  it("sends the first time and when the details change", () => {
    expect(correctionDecision(null, key, t0)).toBe("send");
    const other = correctionKey("info@opendi.nl", [{ field: "phone", expected: "+31235550000" }]);
    expect(correctionDecision({ key, sentAt: t0.toISOString(), remindedAt: null }, other, t0)).toBe("send");
  });

  it("skips the same correction, reminds once after 30 days, then stays quiet", () => {
    const sent = { key, sentAt: t0.toISOString(), remindedAt: null };
    expect(correctionDecision(sent, key, new Date(t0.getTime() + (CORRECTION_REMINDER_DAYS - 1) * DAY))).toBe("skip");
    expect(correctionDecision(sent, key, new Date(t0.getTime() + CORRECTION_REMINDER_DAYS * DAY))).toBe("remind");
    const reminded = { ...sent, remindedAt: new Date(t0.getTime() + 30 * DAY).toISOString() };
    expect(correctionDecision(reminded, key, new Date(t0.getTime() + 365 * DAY))).toBe("skip");
  });

  it("does not depend on the order of the fields or the case of the address", () => {
    const a = correctionKey("Info@Opendi.nl", [{ field: "phone", expected: "1" }, { field: "website", expected: "2" }]);
    const b = correctionKey("info@opendi.nl", [{ field: "website", expected: "2" }, { field: "phone", expected: "1" }]);
    expect(a).toBe(b);
  });
});

describe("syncAllChannels and directory corrections", () => {
  let db: MemDb;
  beforeEach(() => {
    db = new MemDb();
    setDb(db);
    process.env.VIDALO_MOCK = "1";
  });

  async function seed() {
    const business = await db.upsertBusiness({ name: "Bakkerij Jansen", place: "Haarlem", ownerEmail: "eigenaar@bakkerijjansen.nl", status: "active", plan: "monitor" });
    await db.insertFacts(business.id, { ...baseFacts, businessId: business.id }, { provisional: false, verifiedAt: new Date().toISOString() });
    await db.upsertChannel({ businessId: business.id, type: "directory", name: "Opendi", externalId: null, url: "https://www.opendi.nl/bakkerij-jansen", status: "pending" });
    return business;
  }
  const corrections = () => [...db.jobs.values()].filter((j) => j.kind === "email" && j.payload.template === "directory_correction");

  it("mails a directory once, however often it syncs", async () => {
    const b = await seed();
    const t0 = new Date("2026-10-01T10:00:00Z");
    for (const days of [0, 0, 1, 7, 29]) await syncAllChannels(b.id, { now: new Date(t0.getTime() + days * DAY) });
    expect(corrections()).toHaveLength(1);
    expect(corrections()[0]!.payload.reminder).toBeUndefined();
  });

  it("sends one reminder after 30 days, then nothing more", async () => {
    const b = await seed();
    const t0 = new Date("2026-10-01T10:00:00Z");
    for (const days of [0, 30, 31, 60, 120]) await syncAllChannels(b.id, { now: new Date(t0.getTime() + days * DAY) });
    const mails = corrections();
    expect(mails).toHaveLength(2);
    expect(mails[1]!.payload).toMatchObject({ reminder: true, firstSentAt: t0.toISOString() });
  });

  it("mails again when the owner's details change", async () => {
    const b = await seed();
    await syncAllChannels(b.id, { now: new Date("2026-10-01T10:00:00Z") });
    const latest = (await db.latestFacts(b.id))!;
    const { businessId: _b, version: _v, provisional: _p, verifiedAt: _va, ...data } = latest;
    await db.insertFacts(b.id, { ...data, phone: "+31235550000" }, { provisional: false, verifiedAt: new Date().toISOString() });
    await syncAllChannels(b.id, { now: new Date("2026-10-02T10:00:00Z") });
    expect(corrections()).toHaveLength(2);
  });
});

describe("directoryCorrectionEmail reminder", () => {
  it("says it is a reminder and when the first request went out", () => {
    const ctx = { business: { name: "Bakkerij Jansen", place: "Haarlem", ownerEmail: "eigenaar@bakkerijjansen.nl", kvk: null }, factsPageUrl: "https://feiten.bakkerijjansen.nl/" };
    const diff = [{ field: "phone", current: null, expected: "+31235551234" }];
    const first = directoryCorrectionEmail("opendi.nl", null, diff, ctx);
    const reminder = directoryCorrectionEmail("opendi.nl", null, diff, ctx, { reminderOf: "2026-10-01T10:00:00Z" });
    expect(first.subject).toBe("Correctie vermelding Bakkerij Jansen, Haarlem");
    expect(reminder.subject).toBe("Herinnering: correctie vermelding Bakkerij Jansen, Haarlem");
    expect(reminder.text).toContain("Op 1 oktober 2026 vroegen we u");
    expect(reminder.text).toContain('moet zijn "+31235551234"');
  });
});
