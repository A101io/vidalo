import { describe, expect, it } from "vitest";
import { LAUNCH_DELETE_SQL, launchEmail, launchSendGate, planLaunchMail } from "../src/reporter/launch";

const SITE = "https://vidalo.io";
const rows = [
  { email: "eigenaar@bakkerij.nl", language: "nl" as const },
  { email: "owner@shop.com", language: "en" as const },
];

describe("launch mail", () => {
  it("says it is the only mail and that the list is deleted, in both languages", () => {
    const nl = launchEmail("nl", SITE);
    expect(nl.text).toContain("enige mail");
    expect(nl.text).toContain("verwijderen we de lijst");
    expect(nl.text).toContain("https://vidalo.io\n");
    expect(nl.html).toContain('<html lang="nl">');
    const en = launchEmail("en", `${SITE}/`);
    expect(en.text).toContain("only email");
    expect(en.text).toContain("https://vidalo.io/en\n");
    expect(en.html).toContain('<html lang="en">');
    for (const m of [nl, en]) expect(m.text).not.toMatch(/!|localhost|zichtbaarheid|platform/i);
  });

  it("one mail per address, lower-cased, first language wins", () => {
    const plan = planLaunchMail([...rows, { email: " Eigenaar@Bakkerij.NL ", language: "en" }, { email: "no-at", language: "nl" }], SITE);
    expect(plan.recipients).toEqual(rows);
  });

  it("the digest changes with the list and with the text, not with the order", () => {
    const a = planLaunchMail(rows, SITE).digest;
    expect(planLaunchMail([...rows].reverse(), SITE).digest).toBe(a);
    expect(planLaunchMail([...rows, { email: "new@x.nl", language: "nl" }], SITE).digest).not.toBe(a);
    expect(planLaunchMail(rows, "https://other.example").digest).not.toBe(a);
  });

  it("sends only with a key, a list and an approval of this exact plan", () => {
    const plan = planLaunchMail(rows, SITE);
    expect(launchSendGate(plan, { approved: plan.digest })).toMatchObject({ ok: false, reason: expect.stringContaining("RESEND_API_KEY") });
    expect(launchSendGate(plan, { resendKey: "re_x", approved: null })).toMatchObject({ ok: false, reason: expect.stringContaining("No APPROVED") });
    expect(launchSendGate(plan, { resendKey: "re_x", approved: "yes" })).toMatchObject({ ok: false, reason: expect.stringContaining("does not match") });
    expect(launchSendGate(planLaunchMail([], SITE), { resendKey: "re_x", approved: planLaunchMail([], SITE).digest })).toMatchObject({ ok: false, reason: "The list is empty." });
    expect(launchSendGate(plan, { resendKey: "re_x", approved: `${plan.digest}\n` })).toEqual({ ok: true });
  });

  it("the delete is a printed statement", () => {
    expect(LAUNCH_DELETE_SQL).toBe("delete from waitlist;");
  });
});
