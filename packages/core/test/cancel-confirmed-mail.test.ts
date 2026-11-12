import { describe, expect, it } from "vitest";

/** Feature 002, V-COMP-12 (lane A owns reporter/subscription-mails.ts since verify round 1). */
describe("V-COMP-12: the cancel confirmation says what happens to Google and when the data goes", () => {
  it("names the Google end on the end date, the deletion 120 days later with a reminder, and invoices until then (NL, EN)", async () => {
    const { subscriptionEmail, longDate } = await import("../src/reporter/subscription-mails");
    const at = "2026-12-01T10:00:00.000Z";
    const del = new Date(Date.parse(at) + 120 * 86_400_000).toISOString();
    const nl = subscriptionEmail("cancel_confirmed", { name: "Bakkerij", lang: "nl", at }).text;
    expect(nl).toContain("koppeling met Google");
    expect(nl).toContain(`Op ${longDate(del, "nl")} verwijderen we je gegevens`);
    expect(nl).toContain("14 dagen vooraf krijg je een herinnering");
    expect(nl).toContain(`tot ${longDate(del, "nl")} te downloaden`);
    const en = subscriptionEmail("cancel_confirmed", { name: "Bakkerij", lang: "en", at }).text;
    expect(en).toContain("connection with Google");
    expect(en).toContain(`On ${longDate(del, "en")} we delete your data`);
    expect(en).toContain("reminder 14 days before");
    expect(en).toContain(`until ${longDate(del, "en")}`);
  });
});
