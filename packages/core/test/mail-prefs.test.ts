import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { MemDb } from "../src/db";
import { MAIL_PREF_KEYS, OPTIONAL_MAIL_KINDS, REQUIRED_MAIL_KINDS, allOptionalOff, isUnsubscribed, mailAllowed, recordUnsubscribe, setDb, setMailPrefs } from "../src/shared";
import { sendMonthlyReport, sendOwnerText, sendWelcome } from "../src/reporter";

const text = { subject: "Onderwerp", text: "Tekst", html: "<p>Tekst</p>" };

describe("mailAllowed", () => {
  it("never skips a required kind, whatever is stored", () => {
    for (const kind of [...REQUIRED_MAIL_KINDS, "some_new_service_mail"]) expect(mailAllowed(allOptionalOff(), kind)).toBe(true);
  });
  it("skips an optional kind only when its group is off", () => {
    for (const [kind, key] of Object.entries(OPTIONAL_MAIL_KINDS)) {
      expect(mailAllowed({}, kind)).toBe(true);
      expect(mailAllowed({ [key]: true }, kind)).toBe(true);
      expect(mailAllowed({ [key]: false }, kind)).toBe(false);
    }
  });
});

describe("the choke point (reporter deliver)", () => {
  let db: MemDb;
  beforeEach(async () => {
    db = new MemDb();
    setDb(db);
    process.env.VIDALO_OUT_DIR = await mkdtemp(path.join(tmpdir(), "vidalo-prefs-"));
  });

  const owned = () => db.upsertBusiness({ name: "Bakkerij De Vries", place: "Haarlem", status: "active", ownerEmail: "eigenaar@example.nl" });

  it("skips a disabled kind and logs that, without sending", async () => {
    const b = await owned();
    await setMailPrefs(db, b.id, { report: false, reminder: false });
    expect(await sendMonthlyReport(b.id)).toBeNull();
    expect(await sendOwnerText(b.id, "owner_reminder", text)).toBeNull();
    const events = await db.listEvents(b.id);
    expect(events.filter((e) => e.type === "email.skipped").map((e) => e.payload.type).sort()).toEqual(["owner_reminder", "report"]);
    expect(events.some((e) => e.type === "email.report" || e.type === "email.owner_reminder")).toBe(false);
    // Groups left on still go.
    expect(await sendOwnerText(b.id, "resolution", text)).not.toBeNull();
  });

  it("never skips a required kind, also after unsubscribing", async () => {
    const b = await owned();
    await recordUnsubscribe(db, b.id, "link");
    expect((await db.getBusiness(b.id))?.mailPrefs).toEqual(allOptionalOff());
    expect(await sendWelcome(b.id)).not.toBeNull();
    for (const kind of ["owner_instruction", "site_instruction"]) expect(await sendOwnerText(b.id, kind, text)).not.toBeNull();
    expect(await sendMonthlyReport(b.id)).toBeNull();
  });

  it("unsubscribe = every optional group off; switching follow-ups back on ends it", async () => {
    const b = await owned();
    expect(await isUnsubscribed(db, b.id)).toBe(false);
    await recordUnsubscribe(db, b.id, "one-click");
    expect(await isUnsubscribed(db, b.id)).toBe(true);
    for (const k of MAIL_PREF_KEYS) expect((await db.getBusiness(b.id))?.mailPrefs[k]).toBe(false);
    await setMailPrefs(db, b.id, { followup: true });
    expect(await isUnsubscribed(db, b.id)).toBe(false);
  });
});
